"use client";

/**
 * "Assistente do atendente" — os recursos de IA que trabalham para quem
 * atende, e não falam com o cliente.
 *
 * Mora dentro do painel de provedores (e não numa tela nova) porque a pergunta
 * que ele responde é a mesma do painel: qual IA faz isto, com qual chave, e o
 * que sai para ela. Tela nova seria mais uma porta para a mesma configuração.
 *
 * Dois tipos de controle:
 *  - os INTERRUPTORES (resumo ao assumir, prioridade da fila, máscara de dado
 *    pessoal), que qualquer `manager` liga e desliga — a mesma permissão da
 *    rota `/api/v1/ai/copilot`;
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
  resumo_ao_assumir: boolean;
  prioridade_da_fila: boolean;
  sugestoes_multiplas: boolean;
}

type Chave = keyof Configuracao;

/** Cada interruptor diz o que muda e quanto custa — é o que a pessoa decide. */
const INTERRUPTORES: Array<{ chave: Chave; rotulo: string; explicacao: string; ligado: string; desligado: string }> = [
  {
    chave: "resumo_ao_assumir",
    rotulo: "Resumir a conversa quando ela passa para uma pessoa",
    explicacao:
      "Quem assume vê no topo da conversa o motivo, o que já foi feito, o que falta e o clima. Uma chamada de IA por passagem; o botão \"Gerar resumo\" funciona com isto desligado.",
    ligado: "Conversas passadas para uma pessoa chegam com resumo.",
    desligado: "O resumo automático foi desligado. O botão continua disponível.",
  },
  {
    chave: "prioridade_da_fila",
    rotulo: "Pôr as conversas urgentes no topo da Fila",
    explicacao:
      "A IA já mede o clima de cada mensagem recebida. Com isto ligado, cliente com prazo, problema em andamento ou insatisfeito sobe na Fila e ganha o selo Urgente — para o time inteiro.",
    ligado: "A Fila agora mostra os urgentes primeiro.",
    desligado: "A Fila voltou à ordem por tempo de espera.",
  },
  {
    chave: "sugestoes_multiplas",
    rotulo: "Oferecer outras versões da resposta sugerida",
    explicacao:
      "Além do rascunho do agente, o atendente escolhe entre uma versão mais direta e outra mais acolhedora. As versões mantêm os mesmos fatos: se uma trouxer preço, prazo ou link que o rascunho não tem, ela é descartada. Uma chamada de IA a mais por sugestão.",
    ligado: "As sugestões de resposta agora chegam com outras versões.",
    desligado: "As sugestões voltam a ter uma versão só.",
  },
  {
    chave: "mascarar_pii",
    rotulo: "Mascarar dados pessoais antes de enviar à IA",
    explicacao:
      "CPF, e-mail, telefone e CEP são trocados por marcadores nas leituras que a IA faz da conversa. O que o agente escreve para o cliente não é afetado.",
    ligado: "Dados pessoais serão mascarados antes de ir para a IA.",
    desligado: "Os textos vão para a IA como chegaram.",
  },
];

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
  const [salvando, setSalvando] = useState<Chave | null>(null);
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

  async function alternar(chave: Chave, valor: boolean) {
    setSalvando(chave);
    try {
      const res = await fetch("/api/v1/ai/copilot", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [chave]: valor }),
      });
      const json = (await res.json().catch(() => null)) as
        | { data?: Configuracao; error?: { message?: string } }
        | null;
      if (!res.ok || !json?.data) {
        toast.error(json?.error?.message ? t(json.error.message) : t("não consegui salvar"));
        return;
      }
      setConfig(json.data);
      const item = INTERRUPTORES.find((i) => i.chave === chave)!;
      toast.success(t(json.data[chave] ? item.ligado : item.desligado));
    } finally {
      setSalvando(null);
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
      toast.success(`${t("O assistente do atendente agora usa o")} ${MODELO_GEMINI_SUGERIDO.rotulo}.`);
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
            {t("Estes recursos já usam o")} {MODELO_GEMINI_SUGERIDO.rotulo}.
          </p>
        ) : dados.podeEditar && modeloNoCatalogo ? (
          <Button
            size="sm"
            variant="outline"
            disabled={aplicandoGemini}
            onClick={() => void usarGemini()}
            data-testid="assistente-usar-gemini"
          >
            {aplicandoGemini ? t("Aplicando…") : `${t("Usar nestes recursos:")} ${MODELO_GEMINI_SUGERIDO.rotulo}`}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">
            {dados.podeEditar
              ? `${MODELO_GEMINI_SUGERIDO.rotulo}: ${t("não está no catálogo de modelos desta instalação.")}`
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
          <div className="space-y-4">
            {INTERRUPTORES.map((item) => (
              <div key={item.chave} className="flex items-start gap-3">
                <Switch
                  id={`assistente-${item.chave}`}
                  checked={config?.[item.chave] ?? false}
                  disabled={config === null || salvando !== null}
                  onCheckedChange={(v) => void alternar(item.chave, v)}
                  data-testid={`assistente-${item.chave}`}
                />
                <div>
                  <Label htmlFor={`assistente-${item.chave}`} className="text-sm font-medium">
                    {t(item.rotulo)}
                  </Label>
                  <p className="mt-1 text-xs text-muted-foreground">{t(item.explicacao)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
