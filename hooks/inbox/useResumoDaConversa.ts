"use client";
/**
 * O resumo da conversa para quem vai assumir.
 *
 * Três fontes de atualização, cada uma cobrindo um buraco da outra:
 *  - a chave da query leva `ultimaMensagemEm`: chegou mensagem, a tela pergunta
 *    de novo e o selo "desatualizado" aparece sem ninguém recarregar;
 *  - Realtime em `conversation_ai_summaries`: o resumo gerado pelo HANDOFF (no
 *    servidor, sem clique) aparece na tela de quem já está com a conversa aberta;
 *  - a mutação do botão grava direto no cache — quem clicou não espera o eco.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { apiClient } from "@/lib/api/client";
import { useRealtimeChannel } from "@/hooks/realtime/useRealtimeChannel";

export interface ResumoDaConversa {
  id: string;
  body: string;
  last_message_id: string | null;
  gatilho: "handoff" | "manual";
  model: string | null;
  created_at: string;
}

export interface EstadoDoResumo {
  resumo: ResumoDaConversa | null;
  desatualizado: boolean;
}

const chave = (conversationId: string) => ["conversation-summary", conversationId] as const;

export function useResumoDaConversa(opts: {
  conversationId: string;
  organizationId: string;
  ultimaMensagemEm: string | null;
}) {
  const qc = useQueryClient();
  const { conversationId, organizationId, ultimaMensagemEm } = opts;

  const query = useQuery({
    queryKey: [...chave(conversationId), ultimaMensagemEm],
    queryFn: async () =>
      (await apiClient.get<{ data: EstadoDoResumo }>(`/api/v1/conversations/${conversationId}/summary`)).data,
  });

  const onChange = useCallback(() => {
    void qc.invalidateQueries({ queryKey: chave(conversationId) });
  }, [qc, conversationId]);

  useRealtimeChannel({
    name: `resumo-${conversationId}`,
    postgresChanges: {
      event: "INSERT",
      schema: "public",
      table: "conversation_ai_summaries",
      // O filtro é conveniência; quem garante o escopo é a RLS da tabela.
      filter: `conversation_id=eq.${conversationId}`,
    },
    onChange,
    enabled: Boolean(organizationId),
  });

  const gerar = useMutation({
    mutationFn: async () =>
      (await apiClient.post<{ data: EstadoDoResumo }>(`/api/v1/conversations/${conversationId}/summary`, {})).data,
    onSuccess: (dados) => {
      qc.setQueryData([...chave(conversationId), ultimaMensagemEm], dados);
    },
  });

  return { query, gerar };
}
