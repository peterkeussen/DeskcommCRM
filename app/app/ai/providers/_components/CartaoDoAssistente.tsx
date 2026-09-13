"use client";

/**
 * "Assistente do atendente" — os recursos de IA que trabalham para quem
 * atende, e não falam com o cliente.
 *
 * Mora dentro do painel de provedores (e não numa tela nova) porque a pergunta
 * que ele responde é a mesma do painel: qual IA faz isto, com qual chave, e o
 * que sai para ela. Tela nova seria mais uma porta para a mesma configuração.
 *
 * Dois controles:
 *  - a MÁSCARA de dado pessoal, que qualquer `manager` liga e desliga (é a
 *    mesma permissão da rota `/api/v1/ai/copilot`);
 *  - o ATALHO "Usar Gemini", que grava o binding de cada ponto do assistente
 *    pela rota de sempre (`PUT /api/v1/ai/providers`, `admin`). Ele não inventa
 *    caminho de escrita: é o mesmo PUT que o cartão de cada ponto faz, repetido.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/hooks/i18n/useT";
import { MODELO_GEMINI_SUGERIDO, PONTOS_DO_COPILOTO } from "@/lib/ai/copilot/modelos";

interface PontoResumo {
  id: string;
  rotulo: string;
  efetivo: { provider: string; modelId: string | null };
}

interface DadosDoPainel {
  pontos: PontoResumo[];
  credenciais: Array<{ id: string; provider: string; label: string }>;
  modelos: Array<{ provider: string; model_id: string; display_name: string }>;
  podeEditar: boolean;
}

interface Configuracao {
  mascarar_pii: boolean;
}

export function CartaoDoAssistente({
  dados,
  aoSalvar,
}: {
  dados: DadosDoPainel;
  aoSalvar: () => Promise<void>;
}) {
  const t = useT();
  const [config, setConfig] = useState<Configuracao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvandoMascara, setSalvandoMascara] = useState(false);
  const [aplicandoGemini, setAplicandoGemini] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/ai/copilot");
      const json = (await res.json().catch(() => null)) as
        | { data?: Configuracao; error?: { message?: string } }
        | null;
      if (!res.ok || !json?.data) {
        setErro(json?.error?.message ? t(json.error.message) : t("Não foi possível carregar o assistente do atendente."));
        return;
      }
      setErro(null);
      setConfig(json.data);
    } catch {
      setErro(t("Não foi possível carregar o assistente do atendente."));
    }
  }, [t]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const pontos = dados.pontos.filter((p) => (PONTOS_DO_COPILOTO as readonly string[]).includes(p.id));
  const credencialGoogle = dados.credenciais.find((c) => c.provider === MODELO_GEMINI_SUGERIDO.provider);
  const modeloNoCatalogo = dados.modelos.some(
    (m) => m.provider === MODELO_GEMINI_SUGERIDO.provider && m.model_id === MODELO_GEMINI_SUGERIDO.modelId,
  );
  const jaUsaGemini =
    pontos.length > 0 &&
    pontos.every(
      (p) =>
        p.efetivo.provider === MODELO_GEMINI_SUGERIDO.provider &&
        p.efetivo.modelId === MODELO_GEMINI_SUGERIDO.modelId,
    );

  async function alternarMascara(valor: boolean) {
    setSalvandoMascara(true);
    try {
      const res = await fetch("/api/v1/ai/copilot", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mascarar_pii: valor }),
      });
      const json = (await res.json().catch(() => null)) as
        | { data?: Configuracao; error?: { message?: string } }
        | null;
      if (!res.ok || !json?.data) {
        toast.error(json?.error?.message ? t(json.error.message) : t("não consegui salvar"));
        return;
      }
      setConfig(json.data);
      toast.success(
        json.data.mascarar_pii
          ? t("Dados pessoais serão mascarados antes de ir para a IA.")
          : t("Os textos vão para a IA como chegaram."),
      );
    } finally {
      setSalvandoMascara(false);
    }
  }

  async function usarGemini() {
    if (!credencialGoogle) return;
    setAplicandoGemini(true);
    try {
      // Um ponto por vez, e para no primeiro erro: um atalho que aplica metade
      // e diz "pronto" deixaria a tela afirmando o que não fez.
      for (const ponto of pontos) {
        const res = await fetch("/api/v1/ai/providers", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            purpose: ponto.id,
            provider: MODELO_GEMINI_SUGERIDO.provider,
            model_id: MODELO_GEMINI_SUGERIDO.modelId,
            credential_id: credencialGoogle.id,
            base_url: null,
          }),
        });
        if (!res.ok) {
          const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
          toast.error(
            `"${t(ponto.rotulo)}": ${json?.error?.message ? t(json.error.message) : t("não consegui salvar")}`,
          );
          return;
        }
      }
      toast.success(t("O assistente do atendente agora usa o Gemini 2.5 Flash."));
      await aoSalvar();
    } finally {
      setAplicandoGemini(false);
    }
  }

  return (
    <Card className="mb-6 p-4" data-testid="cartao-do-assistente">
      <h2 className="text-base font-semibold">{t("Assistente do atendente")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {t("Recursos de IA que trabalham para quem atende — não escrevem para o cliente.")}
      </p>

      <ul className="mt-3 space-y-1 text-sm">
        {pontos.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-2" data-testid={`assistente-ponto-${p.id}`}>
            <span>{t(p.rotulo)}</span>
            <Badge variant="secondary" className="font-mono text-xs">
              {p.efetivo.modelId ?? t("não definido")}
            </Badge>
          </li>
        ))}
      </ul>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {!credencialGoogle ? (
          <p className="text-sm text-muted-foreground" data-testid="assistente-sem-chave-google">
            {t("Para usar o Gemini, cadastre primeiro uma chave do Google.")}{" "}
            <Link className="underline underline-offset-4" href="/app/ai/credentials">
              {t("Cadastrar chave do Google")}
            </Link>
          </p>
        ) : jaUsaGemini ? (
          <p className="text-sm text-muted-foreground" data-testid="assistente-ja-usa-gemini">
            {t("Estes recursos já usam o Gemini 2.5 Flash.")}
          </p>
        ) : dados.podeEditar && modeloNoCatalogo ? (
          <Button
            size="sm"
            variant="outline"
            disabled={aplicandoGemini}
            onClick={() => void usarGemini()}
            data-testid="assistente-usar-gemini"
          >
            {aplicandoGemini ? t("Aplicando…") : t("Usar Gemini 2.5 Flash nestes recursos")}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">
            {dados.podeEditar
              ? t("O Gemini 2.5 Flash não está no catálogo de modelos desta instalação.")
              : t("Só quem administra a organização troca o modelo destes recursos.")}
          </p>
        )}
      </div>

      <div className="mt-4 border-t pt-4">
        {erro ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-destructive">{erro}</p>
            <Button size="sm" variant="outline" onClick={() => void carregar()}>
              {t("Tentar de novo")}
            </Button>
          </div>
        ) : (
          <div className="flex items-start gap-3">
            <Switch
              id="assistente-mascarar-pii"
              checked={config?.mascarar_pii ?? true}
              disabled={config === null || salvandoMascara}
              onCheckedChange={(v) => void alternarMascara(v)}
              data-testid="assistente-mascarar-pii"
            />
            <div>
              <Label htmlFor="assistente-mascarar-pii" className="text-sm font-medium">
                {t("Mascarar dados pessoais antes de enviar à IA")}
              </Label>
              <p className="mt-1 text-xs text-muted-foreground">
                {t(
                  "CPF, e-mail, telefone e CEP são trocados por marcadores nas leituras que a IA faz da conversa. O que o agente escreve para o cliente não é afetado.",
                )}
              </p>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
