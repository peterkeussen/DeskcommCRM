/**
 * O SEAM MASCARA, CORTA POR TEMPO E TENTA DE NOVO — provado no que chega ao
 * provedor, não no retorno de `runModelCall`.
 *
 * O ponto de verdade é o `doGenerate` do modelo: é o último objeto que vê o
 * prompt antes da rede. Asserção sobre o retorno passaria com um seam que
 * mascarasse depois de enviar.
 */
import { describe, expect, it, vi } from "vitest";

import { normalizarErro, runModelCall } from "@/lib/agent-engine/edge/llm/run-model-call";

const ORG = "33333333-3333-4333-8333-333333333333";

function poolFalso() {
  const inserts: Array<{ sql: string; params: unknown[] }> = [];
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("settings->'llm'")) {
      return {
        rows: [{ llm: { provider: "anthropic", default_model: "claude-x", params: {}, enabled_models: [] } }],
      };
    }
    if (sql.includes("insert into llm_calls")) {
      inserts.push({ sql, params });
      return { rows: [{ id: "call-1" }] };
    }
    return { rows: [] };
  });
  return { pool: { query } as never, inserts };
}

type Prompt = Array<{ role: string; content: unknown }>;

function registry(doGenerate: (opts: { prompt: Prompt; abortSignal?: AbortSignal }) => Promise<unknown>) {
  const fabrica = (_apiKey: string, modelId: string) =>
    ({ specificationVersion: "v3", provider: "google", modelId, doGenerate }) as never;
  return { google: fabrica, anthropic: fabrica, openai: fabrica, openrouter: fabrica };
}

const respostaOk = {
  content: [{ type: "text", text: "ok" }],
  finishReason: { unified: "stop", raw: undefined },
  usage: {
    inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 1, text: 1, reasoning: 0 },
  },
  warnings: [],
};

const cfg = { cacheTtl: "1h" as const };

const textoDoPrompt = (prompt: Prompt) => JSON.stringify(prompt);

describe("mascararPii", () => {
  it("o provedor não recebe CPF, e-mail nem telefone quando a máscara está ligada", async () => {
    let visto = "";
    const { pool } = poolFalso();
    await runModelCall(
      pool,
      { ...cfg, anthropicApiKey: "x" },
      {
        tenantId: ORG,
        purpose: "resumo_para_atendente",
        llmOverride: { provider: "anthropic" },
        model: "claude-x",
        system: "Cliente: maria@exemplo.com",
        messages: [
          { role: "user", content: "meu cpf 123.456.789-09" },
          { role: "user", content: [{ type: "text", text: "liga 11 98765-4321" }] },
        ],
        mascararPii: true,
      },
      {
        registry: registry(async ({ prompt }) => {
          visto = textoDoPrompt(prompt);
          return respostaOk;
        }),
      },
    );
    expect(visto).not.toContain("123.456.789-09");
    expect(visto).not.toContain("maria@exemplo.com");
    expect(visto).not.toContain("98765-4321");
    expect(visto).toContain("[CPF]");
    expect(visto).toContain("[EMAIL]");
    expect(visto).toContain("[TELEFONE]");
  });

  it("sem a opção, o texto chega intacto — pontos que escrevem ao cliente não são tocados", async () => {
    let visto = "";
    const { pool } = poolFalso();
    await runModelCall(
      pool,
      { ...cfg, anthropicApiKey: "x" },
      {
        tenantId: ORG,
        purpose: "draft_suggestion",
        llmOverride: { provider: "anthropic" },
        model: "claude-x",
        messages: [{ role: "user", content: "meu cpf 123.456.789-09" }],
      },
      {
        registry: registry(async ({ prompt }) => {
          visto = textoDoPrompt(prompt);
          return respostaOk;
        }),
      },
    );
    expect(visto).toContain("123.456.789-09");
  });
});

describe("timeoutMs e maxRetries", () => {
  it("o teto de tempo chega ao provedor como abortSignal", async () => {
    let sinal: AbortSignal | undefined;
    const { pool } = poolFalso();
    await runModelCall(
      pool,
      { ...cfg, anthropicApiKey: "x" },
      {
        tenantId: ORG,
        purpose: "resumo_para_atendente",
        llmOverride: { provider: "anthropic" },
        model: "claude-x",
        messages: [{ role: "user", content: "oi" }],
        timeoutMs: 20_000,
      },
      {
        registry: registry(async ({ abortSignal }) => {
          sinal = abortSignal;
          return respostaOk;
        }),
      },
    );
    expect(sinal).toBeDefined();
    expect(sinal!.aborted).toBe(false);
  });

  it("erro retentável é tentado maxRetries vezes além da primeira", async () => {
    let tentativas = 0;
    const { pool } = poolFalso();
    const erro = Object.assign(new Error("503 Service Unavailable"), {
      statusCode: 503,
      isRetryable: true,
    });
    // O AI SDK só retenta `APICallError` com `isRetryable`; o marcador é o
    // `Symbol.for` que o próprio SDK usa em `APICallError.isInstance`.
    Object.defineProperty(erro, Symbol.for("vercel.ai.error"), { value: true });
    Object.defineProperty(erro, Symbol.for("vercel.ai.error.AI_APICallError"), { value: true });
    await expect(
      runModelCall(
        pool,
        { ...cfg, anthropicApiKey: "x" },
        {
          tenantId: ORG,
          purpose: "resumo_para_atendente",
          llmOverride: { provider: "anthropic" },
          model: "claude-x",
          messages: [{ role: "user", content: "oi" }],
          maxRetries: 1,
        },
        {
          registry: registry(async () => {
            tentativas += 1;
            throw erro;
          }),
        },
      ),
    ).rejects.toThrow();
    expect(tentativas).toBe(2);
  });

  it("estouro do teto é classificado como provedor indisponível, não erro desconhecido", () => {
    const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
    expect(normalizarErro(timeout).error_code).toBe("provedor_indisponivel");
    const abort = Object.assign(new Error("This operation was aborted"), { name: "AbortError" });
    expect(normalizarErro(abort).error_code).toBe("provedor_indisponivel");
  });
});

describe("semRaciocinio e a chave no formato novo do Google", () => {
  it("modelo Gemini Flash recebe orçamento de raciocínio zero; o texto não muda", async () => {
    let opcoes: unknown;
    const { pool } = poolFalso();
    await runModelCall(
      pool,
      { ...cfg, geminiApiKey: "AIza-x" },
      {
        tenantId: ORG,
        purpose: "resumo_para_atendente",
        llmOverride: { provider: "google" },
        model: "gemini-2.5-flash",
        messages: [{ role: "user", content: "oi" }],
        semRaciocinio: true,
      },
      {
        registry: registry(async (o) => {
          opcoes = (o as { providerOptions?: unknown }).providerOptions;
          return respostaOk;
        }),
      },
    );
    expect(opcoes).toMatchObject({ google: { thinkingConfig: { thinkingBudget: 0 } } });
  });

  it("sem a opção, nenhuma configuração de raciocínio sai", async () => {
    let opcoes: unknown = "nao-chamado";
    const { pool } = poolFalso();
    await runModelCall(
      pool,
      { ...cfg, geminiApiKey: "AIza-x" },
      {
        tenantId: ORG,
        purpose: "agent_turn",
        llmOverride: { provider: "google" },
        model: "gemini-2.5-flash",
        messages: [{ role: "user", content: "oi" }],
      },
      {
        registry: registry(async (o) => {
          opcoes = (o as { providerOptions?: { google?: unknown } }).providerOptions?.google;
          return respostaOk;
        }),
      },
    );
    expect(opcoes).toBeUndefined();
  });

  it("a mensagem de erro do provedor não carrega a chave `AQ.…` para a tela", () => {
    const chave = "AQ." + "Ab8RN6" + "x".repeat(40);
    const { error_message } = normalizarErro(new Error(`400 API key not valid: ${chave}`));
    expect(error_message).not.toContain(chave);
    expect(error_message).toContain("[CHAVE]");
  });
});
