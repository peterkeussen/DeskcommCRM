/**
 * Lê a configuração do assistente do atendente de uma organização.
 *
 * NUNCA LANÇA. Quem pergunta é caminho quente (worker de sentimento, rota da
 * Caixa de entrada); uma leitura que falha, ou um clone sem a coluna, cai no
 * padrão do produto e segue — com o motivo no log, nunca em silêncio.
 */
import { logger } from "@/lib/logger";
import { copilotSettingsSchema, COPILOT_PADRAO, type CopilotSettings } from "@/lib/schemas/settings";

/** Pura: o jsonb inteiro de `organizations.settings` → configuração válida. */
export function configuracaoDoCopiloto(settings: unknown): CopilotSettings {
  const bloco = (settings as { ai_copilot?: unknown } | null | undefined)?.ai_copilot;
  return copilotSettingsSchema.parse(bloco ?? {});
}

type ClienteSupabase = {
  from: (tabela: "organizations") => {
    select: (colunas: "settings") => {
      eq: (coluna: "id", valor: string) => {
        maybeSingle: () => PromiseLike<{ data: { settings: unknown } | null; error: unknown }>;
      };
    };
  };
};

/**
 * Via cliente Supabase. O chamador passa o cliente: admin (worker, filtro por
 * organização programático aqui) ou o do usuário (RLS).
 */
export async function lerConfiguracaoDoCopiloto(
  cliente: unknown,
  organizationId: string,
): Promise<CopilotSettings> {
  try {
    const { data, error } = await (cliente as ClienteSupabase)
      .from("organizations")
      .select("settings")
      .eq("id", organizationId)
      .maybeSingle();
    if (error) throw error;
    return configuracaoDoCopiloto(data?.settings);
  } catch (erro) {
    logger.warn("[copiloto] configuração ilegível — usando o padrão do produto", {
      organization_id: organizationId,
      erro: erro instanceof Error ? erro.name : typeof erro,
    });
    return { ...COPILOT_PADRAO };
  }
}
