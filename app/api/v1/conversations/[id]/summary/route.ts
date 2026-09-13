import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * GET/POST /api/v1/conversations/:id/summary — o resumo para quem vai assumir.
 *
 * GET devolve o último resumo e se ele ainda cobre a conversa
 * (`desatualizado` é calculado: chegou mensagem depois dele).
 *
 * POST gera sob demanda ("Gerar resumo" / "Atualizar"). Se já existe resumo
 * para a última mensagem, devolve o mesmo sem chamar modelo — clicar duas vezes
 * não paga duas vezes.
 *
 * A conversa é lida pelo cliente do USUÁRIO antes de tudo: é a RLS de
 * `conversations` (escopo de visibilidade do atendente) que decide se ele pode
 * ver esta conversa. Só depois o pool do agent-engine entra, sempre com a
 * organização da sessão — nunca do corpo.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { getRequestPool } from "@/lib/agent-engine/db/request-pool";
import { requestTurnDeps } from "@/lib/agent-engine/agent/request-deps";
import { normalizarErro } from "@/lib/agent-engine/edge/llm/run-model-call";
import { checkRateLimit } from "@/lib/ai/dispatcher/rate-limit";
import { resumirConversa, ultimoResumo } from "@/lib/ai/copilot/resumir-conversa";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Um atendente clicando "Atualizar" sem parar não pode virar uma conta de IA. */
const TETO_POR_USUARIO = 10;
const JANELA_SEGUNDOS = 60;

async function contexto(ctx: Ctx, requestId: string) {
  const auth = await requireRole("agent", { requestId, resource: "conversation_ai_summaries" });
  if (!auth.ok) return { response: auth.response } as const;
  const t = (texto: string) => traduzir(texto, auth.user.idioma);
  const { id } = await ctx.params;
  const { data: conversa } = await (await createClient())
    .from("conversations")
    .select("id")
    .eq("organization_id", auth.org.orgId)
    .eq("id", id)
    .maybeSingle();
  if (!conversa) return { response: fail("not_found", t("Conversa não encontrada."), 404, { requestId }) } as const;
  return { auth, conversationId: conversa.id as string, t } as const;
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const requestId = randomUUID();
  const c = await contexto(ctx, requestId);
  if ("response" in c) return c.response;
  const { resumo, desatualizado } = await ultimoResumo(getRequestPool(), c.auth.org.orgId, c.conversationId);
  return ok({ resumo, desatualizado }, { requestId });
}

const MENSAGEM_DO_MOTIVO: Record<string, string> = {
  sem_mensagens: "Esta conversa ainda não tem mensagens para resumir.",
  bloqueado: "Contato bloqueado ou anonimizado: o resumo não é gerado.",
  vazio: "A IA não devolveu resumo. Tente de novo em instantes.",
  erro_de_leitura: "Não foi possível ler o histórico desta conversa.",
  conversa_inexistente: "Conversa não encontrada.",
};

const MENSAGEM_DO_PROVEDOR: Record<string, string> = {
  credencial_recusada: "O provedor de IA recusou a chave. Confira em IA › Credenciais.",
  modelo_inexistente: "O modelo escolhido não existe no provedor. Confira em IA › Provedores.",
  limite_ou_saldo: "O provedor de IA recusou por limite de uso ou saldo. Tente mais tarde.",
  provedor_indisponivel: "O provedor de IA não respondeu a tempo. Tente de novo em instantes.",
  orcamento_esgotado: "O teto mensal de gasto com IA foi atingido. Ajuste em Uso de IA › Orçamento.",
};

export async function POST(_req: NextRequest, ctx: Ctx) {
  const denied = await requireSupportWrite();
  if (denied) return denied;
  const requestId = randomUUID();
  const c = await contexto(ctx, requestId);
  if ("response" in c) return c.response;

  const limite = await checkRateLimit(`copilot-resumo:${c.auth.user.id}`, TETO_POR_USUARIO, JANELA_SEGUNDOS);
  if (!limite.allowed) {
    return fail("rate_limited", c.t("Muitos resumos seguidos. Tente em um minuto."), 429, {
      requestId,
      headers: { "Retry-After": String(JANELA_SEGUNDOS) },
    });
  }

  try {
    const r = await resumirConversa(getRequestPool(), requestTurnDeps(), {
      organizationId: c.auth.org.orgId,
      conversationId: c.conversationId,
      gatilho: "manual",
      criadoPor: c.auth.user.id,
    });
    if (!r.ok) {
      return fail("summary_unavailable", c.t(MENSAGEM_DO_MOTIVO[r.motivo] ?? "Não foi possível gerar o resumo."), 422, {
        requestId,
        details: { motivo: r.motivo },
      });
    }
    if (!r.reaproveitado) {
      void audit({
        action: "ai.summary_generated",
        actorUserId: c.auth.user.id,
        organizationId: c.auth.org.orgId,
        resourceType: "conversation",
        resourceId: c.conversationId,
        requestId,
        metadata: { summary_id: r.resumo.id, model: r.resumo.model },
      });
    }
    return ok({ resumo: r.resumo, desatualizado: false }, { requestId });
  } catch (erro) {
    // A falha já está em `llm_calls` (o seam grava antes de relançar). Aqui só
    // se traduz a CLASSE para o atendente — nunca a mensagem crua do provedor.
    const { error_code } = normalizarErro(erro);
    return fail(
      "summary_unavailable",
      c.t(MENSAGEM_DO_PROVEDOR[error_code] ?? "Não foi possível gerar o resumo."),
      502,
      { requestId, details: { motivo: error_code } },
    );
  }
}
