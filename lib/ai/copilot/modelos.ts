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
export const PONTOS_DO_COPILOTO = ["sentiment_classify"] as const;

export const MODELO_GEMINI_SUGERIDO = { provider: "google", modelId: "gemini-2.5-flash" } as const;
