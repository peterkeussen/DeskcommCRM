/**
 * Tabela de preços versionada (stack.md §2: usage × pricing.ts → llm_calls.cost_cents).
 * ÚNICO lugar com preço de modelo no repo.
 *
 * Fonte: https://docs.claude.com/en/docs/about-claude/pricing (conferida 2026-07);
 * cache write cotado no TTL 1h (2× input) — o TTL adotado pela doutrina de caching
 * (CLAUDE.md regra 15); cache read = 0.1× input.
 *
 * Modelo fora da tabela → custo NULL (desconhecido): mais honesto que inventar 0 —
 * o budget soma coalesce(cost_cents, 0), então modelo sem preço não consome teto;
 * quem habilitar um modelo novo para uma org adiciona a linha de preço aqui.
 */

/** USD por MILHÃO de tokens; match por prefixo do id (cobre sufixo de data do vendor). */
const USD_PER_MTOK: Record<string, { input: number; output: number; cacheRead: number; cacheWrite1h: number }> = {
  'claude-sonnet-4': { input: 3, output: 15, cacheRead: 0.3, cacheWrite1h: 6 },
  'claude-haiku-4': { input: 1, output: 5, cacheRead: 0.1, cacheWrite1h: 2 },
  'claude-opus-4': { input: 15, output: 75, cacheRead: 1.5, cacheWrite1h: 30 },
  // Google Gemini — https://ai.google.dev/gemini-api/docs/pricing (conferida
  // 2026-09-13, tier pago, entrada de texto). Mesmos números de `ai_pricing`
  // (apêndice 0101 do baseline), que é o preço da pilha antiga.
  //
  // ⚠️ `flash-lite` ANTES de `flash`: o match é o PRIMEIRO prefixo na ordem de
  // declaração, e `gemini-2.5-flash` é prefixo de `gemini-2.5-flash-lite` — na
  // ordem inversa o Lite seria cobrado 3× (entrada) e 6× (saída) acima do real.
  //
  // O Gemini não cobra escrita de cache por token (o cache implícito é grátis;
  // o explícito cobra ARMAZENAMENTO por hora, que não é token) — `cacheWrite1h`
  // igual à entrada é o que não inventa sobretaxa.
  //
  // 2.5 Pro: a tarifa acima de 200 mil tokens de entrada é o dobro; aqui fica a
  // faixa até 200 mil, que é onde cabe toda conversa de atendimento.
  'gemini-2.5-flash-lite': { input: 0.1, output: 0.4, cacheRead: 0.01, cacheWrite1h: 0.1 },
  'gemini-2.5-flash': { input: 0.3, output: 2.5, cacheRead: 0.03, cacheWrite1h: 0.3 },
  'gemini-2.5-pro': { input: 1.25, output: 10, cacheRead: 0.125, cacheWrite1h: 1.25 },
};

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/**
 * Custo em CENTS (fracionário; coluna numeric) ou null se o modelo não tem preço
 * conhecido. `inputTokens` aqui é o TOTAL do usage do SDK — a parcela cacheada é
 * descontada e cobrada pela tarifa de cache.
 */
export function costCents(model: string, usage: TokenUsage): number | null {
  // O painel grava o id como o provedor o nomeia (`gemini-2.5-flash`), mas um
  // id canônico com rota (`google/gemini-2.5-flash`) é o mesmo modelo. Só o
  // prefixo `google/` é tirado: estender aos outros mudaria o custo (e o
  // orçamento) de chamadas que hoje já gravam, fora do escopo desta tabela.
  const id = model.startsWith('google/') ? model.slice('google/'.length) : model;
  const priceKey = Object.keys(USD_PER_MTOK).find((prefix) => id.startsWith(prefix));
  if (priceKey === undefined) {
    return null;
  }
  const p = USD_PER_MTOK[priceKey];
  if (p === undefined) {
    return null; // inalcançável (key veio de Object.keys); satisfaz noUncheckedIndexedAccess
  }
  const noCacheInput = Math.max(0, usage.inputTokens - usage.cacheReadTokens - usage.cacheWriteTokens);
  const usd =
    (noCacheInput * p.input +
      usage.cacheReadTokens * p.cacheRead +
      usage.cacheWriteTokens * p.cacheWrite1h +
      usage.outputTokens * p.output) /
    1_000_000;
  return usd * 100;
}
