/**
 * PUBLICAR UMA VERSÃO REAVALIA AS RESPOSTAS QUE O HORÁRIO ANTIGO ADIOU.
 *
 * ## O defeito, medido numa instalação real (2026-09-13)
 *
 * 07:19 o cliente escreveu; a versão publicada atendia das 08:00 às 23:00, e o
 * turno foi adiado para 08:00:58. 07:31 o operador publicou uma versão das
 * 07:00 às 23:00. 07:32 o cliente escreveu de novo — e o drain juntou a
 * mensagem ao job já adiado ("rajada coalescida em job pendente"). Ninguém foi
 * respondido até 08:00:58, com a versão publicada dizendo que a loja estava
 * aberta. Mudar o horário não mudava nada para quem já estava esperando, e cada
 * mensagem nova só entrava na mesma fila parada.
 *
 * ## O que esta função faz — e o que não faz
 *
 * Antecipa para AGORA o `run_after` dos turnos que estão parados SÓ pelo
 * horário (`last_error = MOTIVO_ADIADO_PELO_HORARIO`). Não decide se a loja
 * abriu: quem decide é o turno, com a versão que estiver publicada quando ele
 * rodar. Se a versão nova ainda está fechada agora, o turno adia de novo pela
 * regra de sempre — o custo é uma leitura de config, não uma resposta errada.
 *
 * Não toca em job `running`, em follow-up, nem em turno adiado por outro motivo
 * (mídia sendo transcrita, anti-ban, debounce): esses não mudam com o horário.
 *
 * ## Escopo pelo canal
 *
 * Versão de agente é por número de WhatsApp. Liberar os adiados de OUTRO número
 * os faria passar pelo roteador de intenção à toa — e o roteador pode custar
 * uma chamada de IA. Versão sem canal alcança a organização inteira.
 *
 * ## Nunca lança
 *
 * A publicação já aconteceu quando isto roda. Falhar aqui não pode transformar
 * uma publicação bem-sucedida em erro na tela: devolve 0 e avisa no log.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { MOTIVO_ADIADO_PELO_HORARIO } from "@/lib/agent-engine/agent/janela-de-atendimento";
import { logger } from "@/lib/logger";

export async function reavaliarRespostasAdiadasPeloHorario(
  admin: SupabaseClient,
  params: { orgId: string; channelSessionId: string | null },
): Promise<number> {
  try {
    const agora = new Date().toISOString();
    // Admin client ignora RLS: o filtro por organização é MANUAL (CLAUDE.md,
    // anti-pattern 10), e vem de quem publicou — nunca do corpo da requisição.
    let consulta = admin
      .from("job_queue")
      .update({ run_after: agora })
      .eq("organization_id", params.orgId)
      .eq("kind", "inbound_turn")
      .eq("status", "pending")
      .gt("run_after", agora)
      .eq("last_error", MOTIVO_ADIADO_PELO_HORARIO);
    if (params.channelSessionId !== null) {
      consulta = consulta.eq("payload->>channel_session_id", params.channelSessionId);
    }
    const { data, error } = await consulta.select("id");
    if (error) throw error;
    const liberados = data?.length ?? 0;
    if (liberados > 0) {
      logger.info("[ai_agents/publish] respostas adiadas pelo horário reavaliadas", {
        organization_id: params.orgId,
        channel_session_id: params.channelSessionId,
        liberados,
      });
    }
    return liberados;
  } catch (erro) {
    logger.warn("[ai_agents/publish] não consegui reavaliar as respostas adiadas pelo horário", {
      organization_id: params.orgId,
      erro: erro instanceof Error ? erro.message.slice(0, 200) : String(erro),
    });
    return 0;
  }
}
