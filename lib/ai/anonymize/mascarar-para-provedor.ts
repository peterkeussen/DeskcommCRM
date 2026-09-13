/**
 * MÁSCARA DE DADO PESSOAL ANTES DE O TEXTO SAIR PARA O PROVEDOR DE IA.
 *
 * O `anonymize()` ao lado existe para a ingestão de RAG, onde o texto vira
 * material permanente e até o primeiro nome sai. Aqui o uso é outro: leitura de
 * uma conversa viva para resumir ou classificar, em que o nome é parte do
 * sentido ("a Maria pediu reembolso") e trocá-lo por `[NOME]` piora o resultado
 * sem proteger quase nada — o nome sozinho raramente identifica alguém.
 *
 * O que sai são os identificadores DIRETOS: CPF, e-mail, telefone e CEP. São
 * os quatro que, vazados num log de provedor, bastam para achar a pessoa.
 *
 * Os padrões vêm de `buildPiiPatterns()` — a mesma régua do guarda residual da
 * ingestão. Duas listas de regex para a mesma pergunta divergem; a de lá já é
 * testada. A ORDEM importa e é a mesma do `anonymize()`: CPF antes de CEP,
 * porque os dois têm o formato dígito-traço e o CEP comeria o fim do CPF.
 *
 * Função pura, sem I/O. Quem decide SE mascara é o chamador (a configuração da
 * organização); quem aplica é o seam, no último instante antes do provedor.
 */
import { buildPiiPatterns } from "./index";

export type TipoMascarado = "cpf" | "email" | "phone" | "cep";

const SUBSTITUTO: Record<TipoMascarado, string> = {
  cpf: "[CPF]",
  email: "[EMAIL]",
  phone: "[TELEFONE]",
  cep: "[CEP]",
};

const ORDEM: readonly TipoMascarado[] = ["cpf", "email", "phone", "cep"];

export interface TextoMascarado {
  texto: string;
  /** Quantas ocorrências de cada tipo saíram — vai para log, nunca o valor. */
  contagem: Record<TipoMascarado, number>;
}

export function mascararParaProvedor(texto: string): TextoMascarado {
  // Instâncias NOVAS a cada chamada: regex com `g` guarda `lastIndex`, e uma
  // instância compartilhada entre chamadas pularia ocorrências em silêncio.
  const padroes = buildPiiPatterns();
  const contagem: Record<TipoMascarado, number> = { cpf: 0, email: 0, phone: 0, cep: 0 };
  let saida = texto;
  for (const tipo of ORDEM) {
    const padrao = padroes[tipo];
    if (padrao === undefined) continue;
    saida = saida.replace(padrao, () => {
      contagem[tipo] += 1;
      return SUBSTITUTO[tipo];
    });
  }
  return { texto: saida, contagem };
}
