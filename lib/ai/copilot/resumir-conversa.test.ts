import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agent-engine/edge/crm/get-lead-context", () => ({ getLeadContext: vi.fn() }));
vi.mock("@/lib/agent-engine/agent/fuso-da-org", () => ({ fusoDaOrganizacao: vi.fn(async () => "America/Sao_Paulo") }));

import { getLeadContext } from "@/lib/agent-engine/edge/crm/get-lead-context";

import { resumirConversa } from "./resumir-conversa";

const ORG = "11111111-1111-4111-8111-111111111111";
const CONV = "22222222-2222-4222-8222-222222222222";
const CONTATO = "33333333-3333-4333-8333-333333333333";
const MSG = "44444444-4444-4444-8444-444444444444";

interface Estado {
  settings?: unknown;
  semMensagem?: boolean;
  resumoExistente?: boolean;
  corrida?: boolean;
}

function poolFalso(e: Estado) {
  const inserts: unknown[][] = [];
  let resumoGravado: Record<string, unknown> | null = e.resumoExistente
    ? { id: "r-antigo", body: "Motivo: antigo", last_message_id: MSG, gatilho: "manual", model: "x", created_at: "t" }
    : null;
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("from conversations c")) {
      return { rows: [{ contact_id: CONTATO, settings: e.settings ?? {} }] };
    }
    if (sql.includes("select id from messages")) {
      return { rows: e.semMensagem ? [] : [{ id: MSG }] };
    }
    if (sql.includes("from conversation_ai_summaries") && sql.includes("last_message_id = $3")) {
      return { rows: resumoGravado ? [resumoGravado] : [] };
    }
    if (sql.includes("insert into conversation_ai_summaries")) {
      inserts.push(params);
      if (e.corrida) {
        resumoGravado = { id: "r-vencedor", body: "Motivo: do outro", last_message_id: MSG, gatilho: "handoff", model: "x", created_at: "t" };
        throw Object.assign(new Error("duplicate key"), { code: "23505" });
      }
      return { rows: [{ id: "r-novo", body: params[2], last_message_id: params[3], gatilho: params[4], model: params[5], created_at: "t" }] };
    }
    if (sql.includes("settings->'llm'")) {
      return { rows: [{ llm: { provider: "google", default_model: "gemini-2.5-flash", params: {}, enabled_models: [] } }] };
    }
    if (sql.includes("insert into llm_calls")) return { rows: [{ id: "call-1" }] };
    return { rows: [] };
  });
  return { pool: { query } as never, inserts, query };
}

function registry(onPrompt: (texto: string) => void, resposta = "Motivo: troca\nJá feito: nada\nPendente: prazo\nClima: com pressa — quer hoje") {
  const fabrica = (_k: string, modelId: string) =>
    ({
      specificationVersion: "v3",
      provider: "google",
      modelId,
      doGenerate: async ({ prompt }: { prompt: unknown }) => {
        onPrompt(JSON.stringify(prompt));
        return {
          content: [{ type: "text", text: resposta }],
          finishReason: { unified: "stop", raw: undefined },
          usage: { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } },
          warnings: [],
        };
      },
    }) as never;
  return { google: fabrica, anthropic: fabrica, openai: fabrica, openrouter: fabrica };
}

const deps = (onPrompt: (t: string) => void = () => {}) => ({
  llmCfg: { geminiApiKey: "AIza-teste", cacheTtl: "1h" as const },
  crmCfg: {} as never,
  registry: registry(onPrompt),
});

function contexto(opts: { bloqueado?: boolean; anonimizado?: boolean } = {}) {
  vi.mocked(getLeadContext).mockResolvedValue({
    ok: true,
    tokenCount: 10,
    lgpd: { isAnonymized: opts.anonimizado ?? false },
    context: {
      contact: { is_blocked: opts.bloqueado ?? false },
      messages: [
        { direction: "inbound", body: "quero trocar, meu cpf é 123.456.789-09", sent_at: "2026-09-13T10:00:00-03:00" },
        { direction: "outbound", body: "Claro! Qual o número do pedido?", sent_at: "2026-09-13T10:01:00-03:00" },
      ],
    },
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  contexto();
});

describe("resumirConversa", () => {
  it("gera, grava no ponto da última mensagem e devolve o resumo", async () => {
    const { pool, inserts } = poolFalso({});
    const r = await resumirConversa(pool, deps(), { organizationId: ORG, conversationId: CONV, gatilho: "handoff" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.reaproveitado).toBe(false);
    expect(r.resumo.body).toContain("Motivo: troca");
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.[0]).toBe(ORG);
    expect(inserts[0]?.[3]).toBe(MSG);
    expect(inserts[0]?.[4]).toBe("handoff");
  });

  it("já existe resumo para a última mensagem: devolve sem chamar modelo", async () => {
    let chamou = false;
    const { pool, inserts } = poolFalso({ resumoExistente: true });
    const r = await resumirConversa(pool, deps(() => (chamou = true)), { organizationId: ORG, conversationId: CONV, gatilho: "manual" });
    expect(r).toMatchObject({ ok: true, reaproveitado: true });
    expect(chamou).toBe(false);
    expect(inserts).toHaveLength(0);
  });

  it("corrida entre handoff e clique: o 23505 devolve o resumo do vencedor", async () => {
    const { pool } = poolFalso({ corrida: true });
    const r = await resumirConversa(pool, deps(), { organizationId: ORG, conversationId: CONV, gatilho: "manual" });
    expect(r).toMatchObject({ ok: true, reaproveitado: true, resumo: { id: "r-vencedor" } });
  });

  it("mascara CPF por padrão antes do provedor", async () => {
    let prompt = "";
    const { pool } = poolFalso({});
    await resumirConversa(pool, deps((t) => (prompt = t)), { organizationId: ORG, conversationId: CONV, gatilho: "manual" });
    expect(prompt).not.toContain("123.456.789-09");
    expect(prompt).toContain("[CPF]");
  });

  it("organização que desligou a máscara manda o texto como veio", async () => {
    let prompt = "";
    const { pool } = poolFalso({ settings: { ai_copilot: { mascarar_pii: false } } });
    await resumirConversa(pool, deps((t) => (prompt = t)), { organizationId: ORG, conversationId: CONV, gatilho: "manual" });
    expect(prompt).toContain("123.456.789-09");
  });

  it.each([
    [{ bloqueado: true }, "bloqueado"],
    [{ anonimizado: true }, "bloqueado"],
  ] as const)("contato %j não é resumido", async (opts, motivo) => {
    contexto(opts);
    let chamou = false;
    const { pool } = poolFalso({});
    const r = await resumirConversa(pool, deps(() => (chamou = true)), { organizationId: ORG, conversationId: CONV, gatilho: "handoff" });
    expect(r).toEqual({ ok: false, motivo });
    expect(chamou).toBe(false);
  });

  it("conversa sem mensagem não chama modelo", async () => {
    const { pool } = poolFalso({ semMensagem: true });
    const r = await resumirConversa(pool, deps(), { organizationId: ORG, conversationId: CONV, gatilho: "handoff" });
    expect(r).toEqual({ ok: false, motivo: "sem_mensagens" });
  });

  it("toda consulta ao banco leva a organização (o pool não tem RLS)", async () => {
    const { pool, query } = poolFalso({});
    await resumirConversa(pool, deps(), { organizationId: ORG, conversationId: CONV, gatilho: "manual" });
    for (const [sql, params] of query.mock.calls as Array<[string, unknown[]]>) {
      if (/conversation_ai_summaries|from messages|from conversations/.test(sql)) {
        expect(params[0], sql).toBe(ORG);
      }
    }
  });
});
