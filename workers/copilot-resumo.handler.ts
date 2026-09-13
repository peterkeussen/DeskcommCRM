/**
 * Resumo da conversa quando ela passa para uma pessoa.
 *
 * Duas famílias de passagem existem, e cada uma avisa de um jeito:
 *  - `ai.handoff_triggered` — o orquestrador do CRM (`lib/ai/handoff/orchestrator.ts`)
 *    e a tool MCP de handoff. É FATO, e já tem outro consumidor (follow-up).
 *  - `copilot.summary_requested` — o motor de agentes (`performHumanHandoff`),
 *    que não emitia evento nenhum na passagem. É COMANDO: existe só para este
 *    handler, e `tests/unit/evento-comando-tem-consumidor.test.ts` cobra isso.
 *
 * Só age se a organização ligou "Resumo ao assumir". Desligado é `skipped` com
 * motivo — o drain registra, e ninguém paga chamada de modelo à toa.
 *
 * Falha do provedor é `error` (o drain tenta de novo no ritmo dele); o
 * resumo é idempotente por ponto da conversa, então tentar de novo não duplica.
 */
import type { EventHandler, HandlerResult } from "@/lib/event-log/dispatcher";
import { getRequestPool } from "@/lib/agent-engine/db/request-pool";
import { requestTurnDeps } from "@/lib/agent-engine/agent/request-deps";
import { configuracaoDoCopiloto } from "@/lib/ai/copilot/configuracao";
import { resumirConversa } from "@/lib/ai/copilot/resumir-conversa";

export const COPILOT_RESUMO_HANDLER_KEY = "copilot-resumo.v1";

export const EVENTO_RESUMO_SOLICITADO = "copilot.summary_requested";

export const copilotResumoHandler: EventHandler = {
  key: COPILOT_RESUMO_HANDLER_KEY,
  events: ["ai.handoff_triggered", EVENTO_RESUMO_SOLICITADO],
  async handle(row): Promise<HandlerResult> {
    const resultado = (status: HandlerResult["status"], detail?: string): HandlerResult => ({
      consumer_key: COPILOT_RESUMO_HANDLER_KEY,
      status,
      ...(detail === undefined ? {} : { detail }),
    });

    // A organização vem da LINHA do event_log (fonte confiável), nunca do payload.
    const conversationId =
      (row.payload?.["conversation_id"] as string | undefined) ??
      (row.entity_kind === "conversation" ? (row.entity_id ?? undefined) : undefined);
    if (!conversationId) return resultado("skipped", "sem_conversation_id");

    const pool = getRequestPool();
    const { rows } = await pool.query<{ settings: unknown }>(
      `select settings from organizations where id = $1`,
      [row.organization_id],
    );
    if (!configuracaoDoCopiloto(rows[0]?.settings).resumo_ao_assumir) {
      return resultado("skipped", "resumo_ao_assumir_desligado");
    }

    try {
      const r = await resumirConversa(pool, requestTurnDeps(), {
        organizationId: row.organization_id,
        conversationId,
        gatilho: "handoff",
      });
      if (!r.ok) return resultado("skipped", r.motivo);
      return resultado("ok", r.reaproveitado ? "reaproveitado" : r.resumo.id);
    } catch (erro) {
      return resultado("error", erro instanceof Error ? erro.name : "erro_desconhecido");
    }
  },
};
