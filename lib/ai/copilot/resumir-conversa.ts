/**
 * RESUMO DA CONVERSA PARA QUEM VAI ASSUMIR.
 *
 * Duas portas chamam isto: o handler de `ai.handoff_triggered` (a IA passou a
 * conversa para uma pessoa) e o botão "Gerar resumo" do painel da conversa.
 * As duas convergem aqui para que o resumo seja UM só — mesmo prompt, mesma
 * janela de histórico, mesma máscara, mesma linha na tabela.
 *
 * ## Idempotência
 *
 * O resumo é por PONTO DA CONVERSA (`last_message_id`). Se já existe um para a
 * última mensagem, ele é devolvido sem chamar modelo nenhum — reabrir a
 * conversa não custa nada. Duas chamadas simultâneas (o handoff e o clique)
 * podem gerar juntas; a segunda toma 23505 no INSERT e devolve a linha da
 * primeira. Pagou-se uma chamada a mais, e nenhum resumo duplicado existe.
 *
 * ## O que ele NUNCA faz
 *
 * - Resumir contato bloqueado ou anonimizado: é decisão de conformidade, a
 *   mesma de `draft-reply.ts`.
 * - Lançar por falha do provedor sem deixar rastro: a falha vira linha em
 *   `llm_calls` pelo seam, e quem chama recebe `{ ok: false, motivo }` para a
 *   tela dizer o que houve.
 */
import type pg from "pg";

import { getLeadContext } from "@/lib/agent-engine/edge/crm/get-lead-context";
import type { CrmEdgeConfig } from "@/lib/agent-engine/edge/crm/mcp-client";
import { runModelCall, type LlmEdgeConfig } from "@/lib/agent-engine/edge/llm/run-model-call";
import type { ProviderRegistry } from "@/lib/agent-engine/edge/llm/providers";
import { fusoDaOrganizacao } from "@/lib/agent-engine/agent/fuso-da-org";
import type { Logger } from "@/lib/agent-engine/obs/logger";
import { RESUMO_ATENDENTE_SYSTEM_PROMPT, transcricaoParaResumo } from "@/lib/ai/prompts/resumo-atendente";

import { configuracaoDoCopiloto } from "./configuracao";

/** O vocabulário do CHECK `conversation_ai_summaries.gatilho` (migration 0240). */
export const GATILHOS_DO_RESUMO = ["handoff", "manual"] as const;
export type GatilhoDoResumo = (typeof GATILHOS_DO_RESUMO)[number];

/** O id do ponto em `lib/ai/pontos/registro.ts`. */
export const PONTO_RESUMO = "resumo_para_atendente";

/**
 * Janela de leitura. Maior que a do turno do agente (que precisa de pouco
 * contexto e paga por turno): o resumo é pedido UMA vez por ponto da conversa,
 * e resumir só as últimas 20 mensagens de uma conversa de 80 é esconder do
 * atendente justamente o começo, onde costuma estar o motivo.
 */
export const JANELA_DO_RESUMO = { historyLimit: 80, maxTokens: 12_000 } as const;

/** Quem espera na tela tem teto; o SDK tenta de novo em 429/5xx dentro dele. */
export const TEMPO_DO_RESUMO = { timeoutMs: 25_000, maxRetries: 3 } as const;

export interface ResumoDaConversa {
  id: string;
  body: string;
  last_message_id: string | null;
  gatilho: GatilhoDoResumo;
  model: string | null;
  created_at: string;
}

export type ResultadoDoResumo =
  | { ok: true; resumo: ResumoDaConversa; reaproveitado: boolean }
  | { ok: false; motivo: "conversa_inexistente" | "sem_mensagens" | "bloqueado" | "vazio" | "erro_de_leitura" };

export interface DepsDoResumo {
  llmCfg: LlmEdgeConfig;
  crmCfg: CrmEdgeConfig;
  log?: Logger;
  registry?: ProviderRegistry;
}

const COLUNAS = "id, body, last_message_id, gatilho, model, created_at";

export async function resumirConversa(
  pool: pg.Pool,
  deps: DepsDoResumo,
  input: {
    organizationId: string;
    conversationId: string;
    gatilho: GatilhoDoResumo;
    criadoPor?: string | null;
  },
): Promise<ResultadoDoResumo> {
  const org = input.organizationId;

  // Toda consulta filtra `organization_id` — o pool ignora RLS.
  const { rows: conversas } = await pool.query<{ contact_id: string | null; settings: unknown }>(
    `select c.contact_id, o.settings
       from conversations c
       join organizations o on o.id = c.organization_id
      where c.organization_id = $1 and c.id = $2`,
    [org, input.conversationId],
  );
  const conversa = conversas[0];
  if (!conversa) return { ok: false, motivo: "conversa_inexistente" };
  if (!conversa.contact_id) return { ok: false, motivo: "bloqueado" };

  const { rows: ultimas } = await pool.query<{ id: string }>(
    `select id from messages
      where organization_id = $1 and conversation_id = $2
      order by created_at desc, id desc
      limit 1`,
    [org, input.conversationId],
  );
  const ultimaMensagem = ultimas[0]?.id ?? null;
  if (ultimaMensagem === null) return { ok: false, motivo: "sem_mensagens" };

  const existente = await resumoNoPonto(pool, org, input.conversationId, ultimaMensagem);
  if (existente) return { ok: true, resumo: existente, reaproveitado: true };

  const ctx = await getLeadContext(
    pool,
    deps.crmCfg,
    {
      tenantId: org,
      leadId: conversa.contact_id,
      conversationId: input.conversationId,
      fuso: await fusoDaOrganizacao(pool, org),
    },
    { ...JANELA_DO_RESUMO },
  );
  if (!ctx.ok) return { ok: false, motivo: "erro_de_leitura" };
  if (ctx.context.contact.is_blocked || ctx.lgpd.isAnonymized) return { ok: false, motivo: "bloqueado" };

  const transcricao = transcricaoParaResumo(ctx.context.messages);
  if (transcricao === "") return { ok: false, motivo: "sem_mensagens" };

  const { mascarar_pii } = configuracaoDoCopiloto(conversa.settings);
  const chamada = await runModelCall(
    pool,
    deps.llmCfg,
    {
      tenantId: org,
      leadId: conversa.contact_id,
      // Literal, e não `PONTO_RESUMO`: `pontos-de-ia-completude.test.ts` lê o
      // `purpose` do AST, e só literal prova um ponto de chamada.
      purpose: "resumo_para_atendente",
      system: RESUMO_ATENDENTE_SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Conversa:\n${transcricao}` }],
      mascararPii: mascarar_pii,
      semRaciocinio: true,
      ...TEMPO_DO_RESUMO,
    },
    {
      ...(deps.registry ? { registry: deps.registry } : {}),
      ...(deps.log ? { log: deps.log } : {}),
    },
  );

  const body = (chamada.result.text ?? "").trim();
  if (body === "") return { ok: false, motivo: "vazio" };

  try {
    const { rows } = await pool.query<ResumoDaConversa>(
      `insert into conversation_ai_summaries
         (organization_id, conversation_id, body, last_message_id, gatilho, model, llm_call_id, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       returning ${COLUNAS}`,
      [org, input.conversationId, body, ultimaMensagem, input.gatilho, chamada.model, chamada.callId, input.criadoPor ?? null],
    );
    return { ok: true, resumo: rows[0]!, reaproveitado: false };
  } catch (erro) {
    if ((erro as { code?: string }).code !== "23505") throw erro;
    const vencedor = await resumoNoPonto(pool, org, input.conversationId, ultimaMensagem);
    if (!vencedor) throw erro;
    return { ok: true, resumo: vencedor, reaproveitado: true };
  }
}

async function resumoNoPonto(
  pool: pg.Pool,
  organizationId: string,
  conversationId: string,
  lastMessageId: string,
): Promise<ResumoDaConversa | null> {
  const { rows } = await pool.query<ResumoDaConversa>(
    `select ${COLUNAS} from conversation_ai_summaries
      where organization_id = $1 and conversation_id = $2 and last_message_id = $3
      limit 1`,
    [organizationId, conversationId, lastMessageId],
  );
  return rows[0] ?? null;
}

/**
 * O resumo mais recente e se ele ainda cobre a conversa. "Desatualizado" é
 * CALCULADO (a última mensagem mudou), nunca coluna — DIRC.
 */
export async function ultimoResumo(
  pool: pg.Pool,
  organizationId: string,
  conversationId: string,
): Promise<{ resumo: ResumoDaConversa | null; desatualizado: boolean }> {
  const { rows } = await pool.query<ResumoDaConversa & { ultima_mensagem: string | null }>(
    `select ${COLUNAS.split(", ").map((c) => `s.${c}`).join(", ")},
            (select m.id from messages m
              where m.organization_id = $1 and m.conversation_id = $2
              order by m.created_at desc, m.id desc limit 1) as ultima_mensagem
       from conversation_ai_summaries s
      where s.organization_id = $1 and s.conversation_id = $2
      order by s.created_at desc
      limit 1`,
    [organizationId, conversationId],
  );
  const linha = rows[0];
  if (!linha) return { resumo: null, desatualizado: false };
  const { ultima_mensagem, ...resumo } = linha;
  return { resumo, desatualizado: ultima_mensagem !== resumo.last_message_id };
}
