/**
 * O BOTÃO TESTAR DIZ POR QUE FALHOU — medido numa instalação real (2026-09-13).
 *
 * A chave do Google estava no plano gratuito (5 pedidos por minuto por modelo);
 * um teste do agente faz cinco ou mais chamadas; o provedor recusava com
 * `generate_content_free_tier_requests`. A rota descartava o erro e a tela dizia
 * "Confira modelo, credencial e materiais do agente" — que estavam certos.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG = "11111111-1111-4111-8111-111111111111";
const AGENTE = "22222222-2222-4222-8222-222222222222";
const VERSAO = "33333333-3333-4333-8333-333333333333";

const atualizacoes: Array<Record<string, unknown>> = [];

vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn(async () => null) }));
vi.mock("@/lib/auth/require-role", () => ({
  requireRole: vi.fn(async () => ({ ok: true, user: { id: "u1", idioma: "pt-BR" }, org: { orgId: ORG } })),
}));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/agent-engine/agent/request-deps", () => ({ requestTurnDeps: () => ({}) }));
vi.mock("@/lib/agent-engine/db/request-pool", () => ({ getRequestPool: () => ({}) }));
vi.mock("@/lib/agent-engine/agent/sandbox", () => ({ testAgentVersion: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (tabela: string) => {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      Object.assign(chain, {
        select: self,
        eq: self,
        insert: self,
        update: (valores: Record<string, unknown>) => {
          atualizacoes.push({ tabela, ...valores });
          return chain;
        },
        maybeSingle: async () => ({ data: { id: VERSAO, channel_session_id: null } }),
        single: async () => ({ data: { id: "run-1" }, error: null }),
        then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok),
      });
      return chain;
    },
  }),
}));

import { testAgentVersion } from "@/lib/agent-engine/agent/sandbox";
import { POST } from "@/app/api/v1/ai/agents/[id]/versions/[vid]/test/route";

async function testar() {
  const req = new Request("http://x/test", {
    method: "POST",
    body: JSON.stringify({ sample_message: "Oi, qual o horário?" }),
  });
  const res = await POST(req as never, { params: Promise.resolve({ id: AGENTE, vid: VERSAO }) });
  return { status: res.status, corpo: (await res.json()) as { error: { code: string; message: string; details?: { motivo?: string } } } };
}

beforeEach(() => {
  atualizacoes.length = 0;
  vi.mocked(testAgentVersion).mockReset();
});

describe("POST …/versions/:vid/test — o motivo da falha chega à tela", () => {
  it("cota do plano gratuito do Google vira instrução, e o motivo fica na execução", async () => {
    vi.mocked(testAgentVersion).mockRejectedValue(
      new Error(
        "Failed after 3 attempts. Last error: AI_APICallError: You exceeded your current quota, please check your plan and billing details. " +
          "* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 5, model: gemini-3.5-flash",
      ),
    );
    const { status, corpo } = await testar();
    expect(status).toBe(422);
    expect(corpo.error.code).toBe("preview_failed");
    expect(corpo.error.message).toMatch(/plano gratuito/);
    expect(corpo.error.details?.motivo).toBe("limite_ou_saldo");
    expect(atualizacoes).toContainEqual(expect.objectContaining({ tabela: "ai_agent_runs", status: "error", error_code: "limite_ou_saldo" }));
  });

  it("erro que não é do provedor mantém a frase e o código de antes", async () => {
    vi.mocked(testAgentVersion).mockRejectedValue(new Error("algo interno quebrou"));
    const { corpo } = await testar();
    expect(corpo.error.message).toBe("Não foi possível executar o teste. Confira modelo, credencial e materiais do agente.");
    expect(atualizacoes).toContainEqual(expect.objectContaining({ error_code: "preview_failed" }));
  });
});
