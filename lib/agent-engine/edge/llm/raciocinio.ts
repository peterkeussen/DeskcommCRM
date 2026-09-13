/**
 * DESLIGAR O RACIOCÍNIO INTERNO EM TAREFA CURTA — traduzido por provedor aqui,
 * para nenhum ponto de chamada precisar saber qual provedor pensa.
 *
 * Medido em 2026-09-13 contra a API real do Google: o Gemini 2.5 Flash raciocina
 * por padrão, e os tokens de raciocínio contam no `maxOutputTokens`. O
 * classificador de sentimento usa teto de 256 — e com o Gemini **toda**
 * classificação falhava com `AI_NoObjectGeneratedError` (o raciocínio consumia
 * o teto e o JSON não saía). Com o raciocínio desligado, as mesmas cinco frases
 * classificaram certo em ~1 s cada. O resumo do atendente, com raciocínio,
 * levava ~11 s e ~1.000 tokens de saída para 300 caracteres de texto.
 *
 * Só o que foi medido entra:
 *  - Gemini Flash (2.5 e 3.5) aceita `thinkingBudget: 0` e responde com 0
 *    tokens de raciocínio.
 *  - Gemini **Pro** não entra: a família Pro exige raciocínio, e mandar orçamento
 *    zero viraria erro 400 onde hoje há uma resposta lenta. Lento é melhor que
 *    quebrado.
 *  - Os outros provedores ignoram o namespace `google` — devolver as opções do
 *    Google para um modelo Anthropic não muda nada, mas o filtro pelo id evita
 *    mandar configuração a quem não a lê.
 */
export type OpcoesDoProvedor = Record<string, Record<string, unknown>>;

export function opcoesSemRaciocinio(modelId: string): OpcoesDoProvedor | undefined {
  const id = modelId.toLowerCase().replace(/^google\//, "");
  if (!id.startsWith("gemini-")) return undefined;
  if (/-pro(\b|-|$)/.test(id)) return undefined;
  return { google: { thinkingConfig: { thinkingBudget: 0 } } };
}
