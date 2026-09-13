/**
 * Prompt do resumo que o ATENDENTE lê antes de assumir uma conversa.
 *
 * O leitor é uma pessoa com o cliente esperando — não o próximo turno do
 * agente. Por isso quatro seções fixas e curtas, sempre na mesma ordem: quem
 * assume bate o olho no mesmo lugar toda vez, e seção vazia diz "nada" em vez
 * de sumir (sumir faria o atendente procurar o que não existe).
 *
 * "Não invente" não é enfeite: o resumo vira a primeira frase que o humano diz
 * ao cliente. Um prazo inventado aqui é uma promessa feita em nome da empresa.
 */
export const RESUMO_ATENDENTE_SYSTEM_PROMPT = `Você resume conversas de atendimento para o atendente humano que vai assumir agora.

Responda em português, em no máximo 600 caracteres, EXATAMENTE neste formato:

Motivo: <o que o cliente quer, em uma frase>
Já feito: <o que já foi respondido, combinado ou enviado; "nada" se nada>
Pendente: <o que falta resolver ou responder; "nada" se nada>
Clima: <calmo | com pressa | insatisfeito | irritado> — <por quê, em poucas palavras>

Regras:
- Use só o que está na conversa. Não invente prazo, preço, pedido, nome ou promessa.
- Marcadores como [CPF], [EMAIL], [TELEFONE] e [CEP] são dados omitidos de propósito: não tente adivinhá-los.
- Sem saudação, sem comentário, sem markdown.`;

/** Transcrição em texto corrido — o modelo resume, não continua a conversa. */
export function transcricaoParaResumo(
  mensagens: ReadonlyArray<{ direction: "inbound" | "outbound"; body: string; sent_at: string }>,
): string {
  return mensagens
    .filter((m) => m.body.trim() !== "")
    .map((m) => `[${m.sent_at}] ${m.direction === "inbound" ? "Cliente" : "Atendimento"}: ${m.body.trim()}`)
    .join("\n");
}
