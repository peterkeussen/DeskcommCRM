/**
 * 2 A 3 OPÇÕES DE RESPOSTA — variações do rascunho que o agente já preparou.
 *
 * ## Por que variação do rascunho, e não três rascunhos independentes
 *
 * O rascunho base sai do preview do agente (`reply-drafts.ts`): versão
 * publicada, base de conhecimento, notas do contato, feedback anterior e
 * guardrails. Gerar três vezes esse caminho triplicaria custo e latência — e
 * três respostas independentes podem discordar sobre FATO (um preço, um prazo),
 * o que obrigaria o atendente a conferir as três. Variar só o TOM de uma
 * resposta já fundamentada dá a escolha sem abrir essa porta.
 *
 * ## A regra que não é só do prompt
 *
 * "Não invente fato" está no prompt, e prompt é pedido, não garantia. Por isso
 * `semFatoNovo` confere depois: número, valor, link e e-mail de cada variação
 * precisam estar no rascunho base. Variação que traz algo novo é DESCARTADA em
 * silêncio — o atendente fica com menos opções, nunca com uma que promete o que
 * a base não prometeu.
 *
 * ## Sem máscara de dado pessoal, de propósito
 *
 * Este ponto ESCREVE para o cliente. Mascarar trocaria o telefone da loja por
 * `[TELEFONE]` dentro da mensagem que o cliente recebe.
 *
 * Falha nunca derruba o rascunho: quem chama recebe `[]` e segue.
 */
import type pg from "pg";
import { z } from "zod";

import { runModelCall, type LlmEdgeConfig } from "@/lib/agent-engine/edge/llm/run-model-call";
import type { ProviderRegistry } from "@/lib/agent-engine/edge/llm/providers";
import type { Logger } from "@/lib/agent-engine/obs/logger";

export const MAXIMO_DE_ALTERNATIVAS = 2;

export const TEMPO_DAS_ALTERNATIVAS = { timeoutMs: 20_000, maxRetries: 2 } as const;

const PROMPT = `Você reescreve uma resposta de atendimento em DUAS variações de tom, para o atendente escolher.

1. Mais direta: curta, objetiva, sem rodeio.
2. Mais acolhedora: calorosa, com empatia, sem ficar longa.

Regras:
- Mantenha exatamente os mesmos fatos da resposta base (pode repetir o que o cliente escreveu). Não acrescente preço, prazo, número, link, e-mail, desconto nem promessa que não esteja nela.
- Não se identifique como IA ou assistente. Escreva como o atendente.
- Mesmo idioma da resposta base.

Responda SOMENTE com JSON, sem markdown: {"alternativas": ["<variação 1>", "<variação 2>"]}`;

const respostaSchema = z.object({
  alternativas: z.array(z.string()).max(4),
});

/**
 * Os "fatos checáveis" de um texto: números (com decimal e milhar), links e
 * e-mails, normalizados. É deliberadamente estreito — nome de produto e verbo
 * não entram, porque reescrever é justamente trocar palavras.
 */
export function fatosChecaveis(texto: string): Set<string> {
  const fatos = new Set<string>();
  for (const m of texto.matchAll(/https?:\/\/\S+|www\.\S+/gi)) fatos.add(m[0].toLowerCase().replace(/[.,;)]+$/, ""));
  for (const m of texto.matchAll(/[\w.+-]+@[\w-]+\.[\w.]+/g)) fatos.add(m[0].toLowerCase());
  const semLinks = texto.replace(/https?:\/\/\S+|www\.\S+|[\w.+-]+@[\w-]+\.[\w.]+/gi, " ");
  for (const m of semLinks.matchAll(/\d+(?:[.,]\d+)*/g)) fatos.add(m[0].replace(/[.,](?=\d{3}\b)/g, "").replace(",", "."));
  return fatos;
}

/**
 * A variação só passa se todo fato checável dela existe no rascunho base OU na
 * mensagem do cliente. O segundo lado foi medido contra a API real: a versão
 * "mais direta" repetia o CEP que o próprio cliente escreveu ("o frete para o
 * CEP 01310-100 fica…") e era descartada — repetir o que o cliente disse não é
 * inventar fato.
 */
export function semFatoNovo(base: string, variacao: string, mensagemDoCliente: string | null = null): boolean {
  const permitidos = fatosChecaveis(`${base}\n${mensagemDoCliente ?? ""}`);
  for (const fato of fatosChecaveis(variacao)) if (!permitidos.has(fato)) return false;
  return true;
}

/** Tira cerca de código e texto em volta — modelos às vezes embrulham o JSON. */
function extrairJson(texto: string): unknown {
  const inicio = texto.indexOf("{");
  const fim = texto.lastIndexOf("}");
  if (inicio < 0 || fim <= inicio) return null;
  try {
    return JSON.parse(texto.slice(inicio, fim + 1));
  } catch {
    return null;
  }
}

/** Pura: resposta crua do modelo → variações aceitas, na ordem, sem repetição. */
export function filtrarAlternativas(
  base: string,
  textoDoModelo: string,
  mensagemDoCliente: string | null = null,
): string[] {
  const parsed = respostaSchema.safeParse(extrairJson(textoDoModelo));
  if (!parsed.success) return [];
  const normalizar = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  const vistas = new Set([normalizar(base)]);
  const aceitas: string[] = [];
  for (const bruta of parsed.data.alternativas) {
    const texto = bruta.trim();
    if (texto === "" || texto.length > 4000) continue;
    if (vistas.has(normalizar(texto))) continue;
    if (!semFatoNovo(base, texto, mensagemDoCliente)) continue;
    vistas.add(normalizar(texto));
    aceitas.push(texto);
    if (aceitas.length === MAXIMO_DE_ALTERNATIVAS) break;
  }
  return aceitas;
}

export async function gerarAlternativas(
  pool: pg.Pool,
  deps: { llmCfg: LlmEdgeConfig; log?: Logger; registry?: ProviderRegistry },
  input: {
    organizationId: string;
    contactId: string;
    rascunhoBase: string;
    ultimaMensagemDoCliente: string | null;
  },
): Promise<string[]> {
  const base = input.rascunhoBase.trim();
  if (base === "") return [];
  try {
    const { result } = await runModelCall(
      pool,
      deps.llmCfg,
      {
        tenantId: input.organizationId,
        leadId: input.contactId,
        purpose: "sugestao_alternativas",
        system: PROMPT,
        messages: [
          {
            role: "user",
            content:
              (input.ultimaMensagemDoCliente ? `Mensagem do cliente:\n${input.ultimaMensagemDoCliente}\n\n` : "") +
              `Resposta base:\n${base}`,
          },
        ],
        semRaciocinio: true,
        ...TEMPO_DAS_ALTERNATIVAS,
      },
      {
        ...(deps.registry ? { registry: deps.registry } : {}),
        ...(deps.log ? { log: deps.log } : {}),
      },
    );
    return filtrarAlternativas(base, result.text ?? "", input.ultimaMensagemDoCliente);
  } catch (erro) {
    // A falha já está em `llm_calls`. Aqui só não pode derrubar o rascunho.
    deps.log?.warn("copiloto: alternativas não geradas", {
      organization_id: input.organizationId,
      erro: erro instanceof Error ? erro.name : "erro_desconhecido",
    });
    return [];
  }
}
