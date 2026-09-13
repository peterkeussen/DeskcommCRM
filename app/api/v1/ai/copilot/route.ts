import { requireSupportWrite } from "@/lib/impersonate/support";
/**
 * GET/PATCH /api/v1/ai/copilot — o liga/desliga do assistente do atendente.
 *
 * GET é `agent+`: quem vive na Caixa de entrada precisa saber se um recurso
 * está ligado para a tela não oferecer botão morto. Devolve só booleanos — nada
 * de modelo, prompt ou credencial.
 *
 * PATCH é `manager+` e passa por `fn_ai_copilot_settings`, que confere papel e
 * suporte de novo DENTRO do banco (a rota não é a única porta para a função).
 * A lista de chaves é validada aqui; a forma, lá.
 */
import { randomUUID } from "node:crypto";

import { configuracaoDoCopiloto } from "@/lib/ai/copilot/configuracao";
import { ok, fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth/require-role";
import { traduzir } from "@/lib/i18n/dicionario";
import { copilotSettingsWriteSchema } from "@/lib/schemas/settings";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const auth = await requireRole("agent", { requestId, resource: "ai_copilot" });
  if (!auth.ok) return auth.response;
  const t = (texto: string) => traduzir(texto, auth.user.idioma);

  const { data, error } = await (await createClient())
    .from("organizations")
    .select("settings")
    .eq("id", auth.org.orgId)
    .maybeSingle();
  if (error) {
    return fail("internal_error", t("Não foi possível carregar o assistente do atendente."), 500, { requestId });
  }
  return ok(configuracaoDoCopiloto(data?.settings), { requestId });
}

export async function PATCH(req: Request): Promise<Response> {
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const requestId = randomUUID();
  const auth = await requireRole("manager", { requestId, resource: "ai_copilot" });
  if (!auth.ok) return auth.response;
  const t = (texto: string) => traduzir(texto, auth.user.idioma);

  const parsed = copilotSettingsWriteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return fail("validation_failed", t("Configuração do assistente inválida."), 422, {
      requestId,
      details: parsed.error.flatten(),
    });
  }

  const { data, error } = await (await createClient()).rpc("fn_ai_copilot_settings", {
    p_org: auth.org.orgId,
    p_config: parsed.data,
  });
  if (error) {
    const proibido = error.code === "42501";
    return fail(
      proibido ? "forbidden" : "internal_error",
      t("Não foi possível alterar o assistente do atendente."),
      proibido ? 403 : 500,
      { requestId },
    );
  }

  void audit({
    action: "ai.copilot_settings_changed",
    organizationId: auth.org.orgId,
    actorUserId: auth.user.id,
    requestId,
    resourceType: "organization",
    resourceId: auth.org.orgId,
    metadata: parsed.data,
  });
  return ok(configuracaoDoCopiloto({ ai_copilot: data }), { requestId });
}
