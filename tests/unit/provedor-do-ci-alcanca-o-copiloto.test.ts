/**
 * O PROVEDOR CONTROLADO DO CI SABE RESPONDER AOS PONTOS DO ASSISTENTE.
 *
 * `tests/e2e/copiloto-atendente.spec.ts` roda com `INTERNAL_AGENT_RUN_STUB` e
 * espera: um resumo com "Motivo:" e DUAS versões aceitas da resposta. Se o
 * fixture devolver JSON no lugar do resumo, ou versões que a checagem de fato
 * novo descarta, a spec falharia no CI com uma tela "sem opções" — e a causa
 * estaria num arquivo que a spec não menciona. Este teste amarra os dois lados
 * sem browser.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agent-engine/edge/crm/get-lead-context", () => ({
  getLeadContext: vi.fn(async () => ({
    ok: true,
    tokenCount: 1,
    lgpd: { isAnonymized: false },
    context: {
      contact: { is_blocked: false },
      messages: [{ direction: "inbound", body: "Quero informações do atendimento", sent_at: "2026-09-13T10:00:00-03:00" }],
    },
  })),
}));
vi.mock("@/lib/agent-engine/agent/fuso-da-org", () => ({ fusoDaOrganizacao: vi.fn(async () => "America/Sao_Paulo") }));

import { previewFixtureRegistry } from "@/lib/agent-engine/agent/preview-fixture";
import { gerarAlternativas } from "@/lib/ai/copilot/alternativas-de-resposta";
import { resumirConversa } from "@/lib/ai/copilot/resumir-conversa";

/** O corpo que o fixture põe no `send_message` do preview — é o rascunho base da spec. */
const RASCUNHO_DO_FIXTURE = "Olá! Posso ajudar com as informações do atendimento. O que você gostaria de saber?";

function pool() {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("from conversations c")) return { rows: [{ contact_id: "c1", settings: {} }] };
      if (sql.includes("select id from messages")) return { rows: [{ id: "m1" }] };
      if (sql.includes("insert into conversation_ai_summaries")) {
        return { rows: [{ id: "r1", body: params[2], last_message_id: "m1", gatilho: "manual", model: params[5], created_at: "t" }] };
      }
      if (sql.includes("settings->'llm'")) {
        return { rows: [{ llm: { provider: "anthropic", default_model: "claude-sonnet-4-6", params: {}, enabled_models: [] } }] };
      }
      if (sql.includes("insert into llm_calls")) return { rows: [{ id: "x" }] };
      return { rows: [] };
    }),
  } as never;
}

const deps = () => ({
  llmCfg: { anthropicApiKey: "local-controlled-provider", cacheTtl: "1h" as const },
  crmCfg: {} as never,
  registry: previewFixtureRegistry(),
});

describe("provedor controlado do CI × assistente do atendente", () => {
  it("o resumo sai em texto, com as quatro linhas que a tela mostra", async () => {
    const r = await resumirConversa(pool(), deps(), { organizationId: "o1", conversationId: "v1", gatilho: "manual" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.resumo.body).toMatch(/^Motivo: .+\nJá feito: .+\nPendente: .+\nClima: .+/);
  });

  it("as duas versões do fixture passam na checagem de fato novo contra o rascunho do fixture", async () => {
    const alternativas = await gerarAlternativas(pool(), deps(), {
      organizationId: "o1",
      contactId: "c1",
      rascunhoBase: RASCUNHO_DO_FIXTURE,
      ultimaMensagemDoCliente: "Quero informações do atendimento",
      herdarDe: { model: "claude-sonnet-4-6", provider: "anthropic", credentialId: null },
    });
    expect(alternativas).toEqual([
      "Olá! Posso ajudar com as informações do atendimento.",
      "Oi, que bom falar com você! Posso ajudar com as informações do atendimento. O que você gostaria de saber?",
    ]);
  });
});
