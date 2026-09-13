/**
 * O ERRO DO PROVEDOR EM PORTUGUÊS DE QUEM OPERA — para a tela, não para o log.
 *
 * `normalizarErro` já separa o que exige conversas diferentes (chave, modelo,
 * saldo, indisponibilidade). Faltava a última milha: as rotas recebiam a
 * classificação e mostravam uma frase só. Medido numa instalação real em
 * 2026-09-13: o botão Testar do agente respondia "Confira modelo, credencial e
 * materiais do agente" enquanto o log dizia, por escrito, que a chave do Google
 * estava no PLANO GRATUITO (5 pedidos por minuto por modelo) — e um teste faz
 * cinco ou mais chamadas. A pessoa foi conferir modelo e credencial, que
 * estavam certos.
 *
 * Só frases fixas saem daqui: nunca o texto cru do provedor, que pode ecoar
 * prompt ou cabeçalho (ver `redigirMensagemDoProvedor`).
 */
import { normalizarErro } from "./run-model-call";

export const MENSAGEM_PADRAO_DO_ERRO = "Não foi possível executar o teste. Confira modelo, credencial e materiais do agente.";

const POR_CLASSE: Record<string, string> = {
  credencial_recusada: "O provedor de IA recusou a chave. Confira a credencial em IA › Credenciais.",
  modelo_inexistente: "O modelo escolhido não existe no provedor. Troque o modelo na versão do agente.",
  limite_ou_saldo: "O provedor de IA recusou por limite de uso ou falta de saldo. Espere um pouco ou confira o plano da chave.",
  provedor_indisponivel: "O provedor de IA não respondeu a tempo. Tente de novo em instantes.",
  orcamento_esgotado: "O teto mensal de gasto com IA desta organização foi atingido. Ajuste em Uso de IA › Orçamento.",
  modelo_sem_ferramentas: "O modelo escolhido não usa ferramentas, e o agente precisa delas. Escolha outro modelo.",
};

/**
 * O plano gratuito do Google tem nome próprio na mensagem de cota
 * (`generate_content_free_tier_requests`). Merece frase própria: a saída não é
 * "confira o saldo", é ativar o faturamento ou espaçar os testes.
 */
const PLANO_GRATUITO_DO_GOOGLE =
  "A chave do Google está no plano gratuito, que aceita poucos pedidos por minuto — e um teste do agente faz vários. Espere um minuto e teste de novo, ou ative o faturamento da chave no Google AI Studio.";

export function mensagemDoErroDoProvedor(erro: unknown): { codigo: string; mensagem: string } {
  const { error_code } = normalizarErro(erro);
  const bruto = erro instanceof Error ? erro.message : String(erro);
  if (error_code === "limite_ou_saldo" && /free_tier/i.test(bruto)) {
    return { codigo: error_code, mensagem: PLANO_GRATUITO_DO_GOOGLE };
  }
  return { codigo: error_code, mensagem: POR_CLASSE[error_code] ?? MENSAGEM_PADRAO_DO_ERRO };
}
