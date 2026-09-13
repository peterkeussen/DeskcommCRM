import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("@/lib/agent-engine/db/request-pool", () => ({ getRequestPool: () => ({ query }) }));
vi.mock("@/lib/agent-engine/agent/request-deps", () => ({ requestTurnDeps: () => ({}) }));
vi.mock("@/lib/ai/copilot/resumir-conversa", () => ({ resumirConversa: vi.fn() }));

import { resumirConversa } from "@/lib/ai/copilot/resumir-conversa";
import type { EventRow } from "@/lib/event-log/dispatcher";

import { copilotResumoHandler } from "./copilot-resumo.handler";

const ORG = "11111111-1111-4111-8111-111111111111";
const CONV = "22222222-2222-4222-8222-222222222222";

function evento(tipo: string, payload: Record<string, unknown> = { conversation_id: CONV }): EventRow {
  return {
    id: "e1",
    organization_id: ORG,
    event_type: tipo,
    entity_kind: "conversation",
    entity_id: CONV,
    payload,
    metadata: {},
    consumed_by: [],
    attempts: 0,
  };
}

function org(settings: unknown) {
  query.mockResolvedValue({ rows: [{ settings }] });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("copilot-resumo.handler", () => {
  it("escuta as duas famílias de passagem", () => {
    expect(copilotResumoHandler.events).toEqual(["ai.handoff_triggered", "copilot.summary_requested"]);
  });

  it("recurso desligado (o padrão): não chama modelo", async () => {
    org({});
    const r = await copilotResumoHandler.handle(evento("ai.handoff_triggered"));
    expect(r).toMatchObject({ status: "skipped", detail: "resumo_ao_assumir_desligado" });
    expect(resumirConversa).not.toHaveBeenCalled();
  });

  it("ligado: resume a conversa da linha, com a organização da LINHA e gatilho handoff", async () => {
    org({ ai_copilot: { resumo_ao_assumir: true } });
    vi.mocked(resumirConversa).mockResolvedValue({ ok: true, reaproveitado: false, resumo: { id: "r1" } } as never);
    const r = await copilotResumoHandler.handle(
      evento("copilot.summary_requested", { conversation_id: CONV, organization_id: "org-do-payload-nao-vale" }),
    );
    expect(r).toMatchObject({ status: "ok", detail: "r1" });
    expect(vi.mocked(resumirConversa).mock.calls[0]?.[2]).toEqual({
      organizationId: ORG,
      conversationId: CONV,
      gatilho: "handoff",
    });
    expect(query.mock.calls[0]?.[1]).toEqual([ORG]);
  });

  it("falha do provedor vira error (o drain tenta de novo), não some", async () => {
    org({ ai_copilot: { resumo_ao_assumir: true } });
    vi.mocked(resumirConversa).mockRejectedValue(Object.assign(new Error("503"), { name: "AI_APICallError" }));
    const r = await copilotResumoHandler.handle(evento("ai.handoff_triggered"));
    expect(r).toMatchObject({ status: "error", detail: "AI_APICallError" });
  });
});
