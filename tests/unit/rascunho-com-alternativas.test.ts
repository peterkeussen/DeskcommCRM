/**
 * AS OUTRAS VERSÕES DA RESPOSTA ENTRAM SÓ QUANDO PODEM — e nunca no lugar do
 * rascunho base.
 */
import { describe, expect, it, vi } from "vitest";

import { anexarAlternativas } from "@/lib/agent-engine/agent/reply-drafts";

const ORG = "11111111-1111-4111-8111-111111111111";
const BASE = "Oi! O frete fica R$ 19,90 e chega em 3 dias úteis.";

function cenario(opts: { ligado: boolean; resposta?: string; falhar?: boolean }) {
  const updates: unknown[][] = [];
  let chamouModelo = false;
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("select settings from organizations")) {
      return { rows: [{ settings: { ai_copilot: { sugestoes_multiplas: opts.ligado } } }] };
    }
    if (sql.includes("settings->'llm'")) {
      return { rows: [{ llm: { provider: "google", default_model: "gemini-3.5-flash", params: {}, enabled_models: [] } }] };
    }
    if (sql.includes("update ai_reply_drafts set alternatives")) {
      updates.push(params);
      return { rows: [] };
    }
    if (sql.includes("insert into llm_calls")) return { rows: [{ id: "c" }] };
    return { rows: [] };
  });
  const fabrica = (_k: string, modelId: string) =>
    ({
      specificationVersion: "v3",
      provider: "google",
      modelId,
      doGenerate: async () => {
        chamouModelo = true;
        if (opts.falhar) throw new Error("503 Service Unavailable");
        return {
          content: [{ type: "text", text: opts.resposta ?? "" }],
          finishReason: { unified: "stop", raw: undefined },
          usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
          warnings: [],
        };
      },
    }) as never;
  const deps = {
    llmCfg: { geminiApiKey: "AIza-x", cacheTtl: "1h" as const },
    crmCfg: {} as never,
    knobs: {} as never,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    registry: { google: fabrica, anthropic: fabrica, openai: fabrica, openrouter: fabrica },
  };
  return { pool: { query } as never, deps: deps as never, updates, chamouModelo: () => chamouModelo };
}

const draft = (status = "pending", original_body: string | null = BASE) =>
  ({ id: "d1", status, revision: "7", original_body, generation_token: "t", agent_version_id: "v", service_boundary: {} }) as never;

const entrada = (d = draft()) => ({ organizationId: ORG, contactId: "c1", draft: d, ultimaMensagemDoCliente: "quanto é o frete?" });

describe("anexarAlternativas", () => {
  it("recurso desligado (o padrão): não chama modelo nem escreve", async () => {
    const c = cenario({ ligado: false });
    await anexarAlternativas(c.pool, c.deps, entrada());
    expect(c.chamouModelo()).toBe(false);
    expect(c.updates).toHaveLength(0);
  });

  it("ligado: grava só as variações sem fato novo, pinado na revisão do rascunho", async () => {
    const c = cenario({
      ligado: true,
      resposta: JSON.stringify({ alternativas: ["Frete R$ 19,90, 3 dias úteis.", "Frete R$ 9,90, amanhã!"] }),
    });
    await anexarAlternativas(c.pool, c.deps, entrada());
    expect(c.updates).toHaveLength(1);
    expect(c.updates[0]).toEqual([ORG, "d1", "7", JSON.stringify(["Frete R$ 19,90, 3 dias úteis."])]);
  });

  it.each([
    ["obsoleto", draft("stale")],
    ["sem corpo", draft("pending", "")],
  ])("rascunho %s: nada a variar", async (_nome, d) => {
    const c = cenario({ ligado: true, resposta: JSON.stringify({ alternativas: ["x"] }) });
    await anexarAlternativas(c.pool, c.deps, entrada(d));
    expect(c.chamouModelo()).toBe(false);
  });

  it("falha do provedor não lança — o rascunho base segue", async () => {
    const c = cenario({ ligado: true, falhar: true });
    await expect(anexarAlternativas(c.pool, c.deps, entrada())).resolves.toBeUndefined();
    expect(c.updates).toHaveLength(0);
  });
});
