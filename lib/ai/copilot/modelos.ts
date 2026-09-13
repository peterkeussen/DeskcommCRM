/**
 * O que o assistente do atendente oferece por padrão, num lugar só.
 *
 * `PONTOS_DO_COPILOTO` são os pontos de IA (ids de `lib/ai/pontos/registro.ts`)
 * que trabalham para quem ATENDE e não falam com o cliente — é a lista que o
 * atalho "Usar Gemini nestes recursos" grava de uma vez. Só entra aqui ponto
 * que existe no registro: o teste ao lado reprova id órfão.
 *
 * `MODELO_GEMINI_SUGERIDO` é SUGESTÃO de atalho, não configuração: o modelo em
 * vigor é o binding de cada ponto, no banco, e o operador troca na tela. Por
 * isso é constante de código e não variável de ambiente — não existe
 * `GEMINI_MODEL`. Tem de existir, não depreciado, em `ai_models` (a rota do
 * binding confere o par no catálogo e recusa o que não achar).
 */
export const PONTOS_DO_COPILOTO = ["sentiment_classify", "resumo_para_atendente"] as const;

/**
 * Por que 3.5 e não 2.5: medido contra a API real em 2026-09-13, o Google já
 * recusa `gemini-2.5-flash-lite` e `gemini-2.5-pro` para contas novas ("no
 * longer available to new users"), e a mesma família tende a seguir. O
 * `gemini-3.5-flash` é o padrão Google do catálogo (`ai_models`) e respondeu
 * normalmente, com raciocínio desligável (`thinkingBudget: 0`).
 */
export const MODELO_GEMINI_SUGERIDO = {
  provider: "google",
  modelId: "gemini-3.5-flash",
  rotulo: "Gemini 3.5 Flash",
} as const;
