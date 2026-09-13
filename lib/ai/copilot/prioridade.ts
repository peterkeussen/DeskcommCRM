/**
 * A PRIORIDADE DA CONVERSA NA FILA — decisão pura, sem I/O.
 *
 * Três classes, e a ordem delas é a ordem da fila: `urgente` antes, `positivo`
 * por último. `neutro` é o meio e é também o que vale para conversa nunca
 * classificada — ela não pode furar a fila de quem está irritado, nem afundar
 * atrás de quem está satisfeito.
 *
 * ## Por que duas entradas e não só a nota
 *
 * Nota baixa e urgência são perguntas diferentes. "Preciso do boleto até as 17h,
 * senão perco o desconto" é educada (nota neutra) e é urgente. "Que atendimento
 * ruim" é insatisfeita e pode esperar cinco minutos sem piorar. A fila quer as
 * duas no topo — por isso `urgente` é OU, nunca E.
 *
 * O limiar da nota é o MESMO que decide o handoff por sentimento (o do agente da
 * conversa), e não um número desta função: com dois limiares, uma conversa
 * poderia ser passada a um humano e continuar marcada "neutra" na fila dele.
 */
export const PRIORIDADES = ["urgente", "neutro", "positivo"] as const;
export type Prioridade = (typeof PRIORIDADES)[number];

/** Acima disto o cliente está satisfeito o bastante para esperar um pouco mais. */
export const NOTA_POSITIVA = 0.65;

export function prioridadeDaMensagem(entrada: {
  nota: number;
  urgente: boolean;
  limiarDeInsatisfacao: number;
}): Prioridade {
  if (entrada.urgente || entrada.nota < entrada.limiarDeInsatisfacao) return "urgente";
  if (entrada.nota >= NOTA_POSITIVA) return "positivo";
  return "neutro";
}

/** A posição na fila — espelha a coluna gerada `conversations.ai_priority_rank`. */
export function posicaoNaFila(p: Prioridade | null): number {
  if (p === "urgente") return 0;
  if (p === "positivo") return 2;
  return 1;
}
