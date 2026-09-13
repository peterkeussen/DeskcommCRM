"use client";

/**
 * "Resumo para quem assume" — o bloco do topo do painel da conversa.
 *
 * Fica ANTES do contato de propósito: quem abre uma conversa que acabou de
 * passar para uma pessoa quer saber o que está acontecendo antes de saber quem
 * é. O resumo gerado no handoff aparece sozinho; o botão existe para qualquer
 * outra conversa e para atualizar depois de novas mensagens.
 *
 * Quatro estados, e nenhum deles mente: carregando, sem resumo (com o botão),
 * resumo em dia, e resumo DESATUALIZADO — que continua visível, porque um
 * resumo de dez minutos atrás ainda serve, mas diz com todas as letras que
 * chegou mensagem depois dele.
 */
import { format } from "date-fns";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocaleDeData } from "@/hooks/i18n/useLocaleDeData";
import { useT } from "@/hooks/i18n/useT";
import { useResumoDaConversa } from "@/hooks/inbox/useResumoDaConversa";

export function ResumoDaConversa({
  conversationId,
  organizationId,
  ultimaMensagemEm,
  somenteLeitura,
}: {
  conversationId: string;
  organizationId: string;
  ultimaMensagemEm: string | null;
  somenteLeitura: boolean;
}) {
  const t = useT();
  const locale = useLocaleDeData();
  const { query, gerar } = useResumoDaConversa({ conversationId, organizationId, ultimaMensagemEm });

  const resumo = query.data?.resumo ?? null;
  const desatualizado = query.data?.desatualizado ?? false;
  const erroDoBotao = gerar.error instanceof Error ? gerar.error.message : null;

  return (
    <section data-testid="inbox-resumo-da-conversa">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-text">{t("Resumo para quem assume")}</h3>
        {resumo && desatualizado && (
          <Badge variant="outline" className="h-4 px-1.5 text-[10px]" data-testid="resumo-desatualizado">
            {t("Desatualizado")}
          </Badge>
        )}
      </div>

      <Card className="mt-2 space-y-2 p-3 text-sm">
        {query.isLoading ? (
          <Skeleton className="h-14 w-full" />
        ) : query.isError ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{t("Não foi possível carregar o resumo.")}</span>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => void query.refetch()}>
              {t("Tentar de novo")}
            </Button>
          </div>
        ) : resumo ? (
          <>
            <p className="whitespace-pre-wrap text-sm leading-relaxed" data-testid="resumo-texto">
              {resumo.body}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {resumo.gatilho === "handoff" ? t("Gerado quando a conversa passou para uma pessoa") : t("Gerado a pedido")}{" "}
              · {format(new Date(resumo.created_at), "dd/MM HH:mm", { locale })}
              {desatualizado ? ` · ${t("chegaram mensagens depois dele")}` : ""}
            </p>
          </>
        ) : (
          <p className="text-xs text-muted-foreground" data-testid="resumo-vazio">
            {t("Nenhum resumo ainda. A IA lê a conversa e diz o motivo, o que já foi feito, o que falta e o clima.")}
          </p>
        )}

        {!somenteLeitura && !query.isLoading && !query.isError && (!resumo || desatualizado) && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            disabled={gerar.isPending}
            onClick={() => gerar.mutate()}
            data-testid="resumo-gerar"
          >
            {gerar.isPending ? t("Gerando…") : resumo ? t("Atualizar resumo") : t("Gerar resumo")}
          </Button>
        )}

        {erroDoBotao && !gerar.isPending && (
          <p className="text-xs text-destructive" role="alert" data-testid="resumo-erro">
            {t(erroDoBotao)}
          </p>
        )}
      </Card>
    </section>
  );
}
