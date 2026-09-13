"use client";
import { useQuery } from "@tanstack/react-query";

import { usePermission } from "@/hooks/auth/AuthProvider";
import { apiClient } from "@/lib/api/client";
import type { CopilotSettings } from "@/lib/schemas/settings";

/**
 * O que o assistente do atendente tem ligado nesta organização.
 *
 * Uma leitura por sessão de Inbox, compartilhada (react-query dedupa). Falha ou
 * carregamento devolvem `undefined`, e quem consome trata como DESLIGADO: a
 * tela não reordena a fila nem mostra selo com base numa leitura que não voltou.
 */
export function useConfiguracaoDoCopiloto() {
  const podeConsultar = usePermission("ai.copilot.view");
  return useQuery({
    enabled: podeConsultar,
    queryKey: ["ai", "copilot"],
    queryFn: async () => (await apiClient.get<{ data: CopilotSettings }>("/api/v1/ai/copilot")).data,
    staleTime: 60_000,
    retry: 1,
  });
}
