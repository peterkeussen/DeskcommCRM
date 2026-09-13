import { describe, expect, it } from "vitest";

import { fatosChecaveis, filtrarAlternativas, semFatoNovo } from "./alternativas-de-resposta";

const BASE = "Oi! O frete para o seu CEP fica R$ 19,90 e chega em 3 dias úteis. Acompanhe em https://loja.com/pedido/4821.";

describe("fatosChecaveis", () => {
  it("pega números, valores, links e e-mails, normalizados", () => {
    const f = fatosChecaveis("Custa R$ 1.299,90, prazo 3 dias, fale com vendas@loja.com ou https://loja.com/x.");
    expect(f).toEqual(new Set(["1299.90", "3", "vendas@loja.com", "https://loja.com/x"]));
  });
});

describe("semFatoNovo", () => {
  it("reescrever o tom com os mesmos fatos passa", () => {
    expect(semFatoNovo(BASE, "Frete de R$ 19,90, entrega em 3 dias úteis: https://loja.com/pedido/4821")).toBe(true);
  });

  it("repetir o que o PRÓPRIO cliente escreveu não é fato novo (medido na API real)", () => {
    const cliente = "Quanto fica o frete pro CEP 01310-100?";
    const variacao = "O frete para o CEP 01310-100 fica R$ 19,90, em 3 dias úteis.";
    expect(semFatoNovo(BASE, variacao)).toBe(false);
    expect(semFatoNovo(BASE, variacao, cliente)).toBe(true);
  });

  it.each([
    ["preço diferente", "O frete fica R$ 9,90 e chega em 3 dias úteis."],
    ["prazo inventado", "Frete R$ 19,90, chega em 2 dias úteis."],
    ["desconto que a base não deu", "Frete R$ 19,90 com 10 de desconto, 3 dias úteis."],
    ["link novo", "Frete R$ 19,90, 3 dias úteis. Veja https://outra.com"],
  ])("%s é recusado", (_motivo, variacao) => {
    expect(semFatoNovo(BASE, variacao)).toBe(false);
  });
});

describe("filtrarAlternativas", () => {
  it("aceita JSON embrulhado em cerca de código e devolve no máximo 2", () => {
    const texto =
      '```json\n{"alternativas": ["Frete R$ 19,90, 3 dias úteis.", "Que bom falar com você! O frete fica R$ 19,90 e chega em 3 dias úteis.", "Frete: R$ 19,90 (3 dias úteis)."]}\n```';
    expect(filtrarAlternativas(BASE, texto)).toEqual([
      "Frete R$ 19,90, 3 dias úteis.",
      "Que bom falar com você! O frete fica R$ 19,90 e chega em 3 dias úteis.",
    ]);
  });

  it("descarta a que inventa fato e a que repete a base, mantém as outras", () => {
    const texto = JSON.stringify({ alternativas: [BASE, "Frete R$ 9,90!", "Frete R$ 19,90, 3 dias úteis."] });
    expect(filtrarAlternativas(BASE, texto)).toEqual(["Frete R$ 19,90, 3 dias úteis."]);
  });

  it("resposta que não é JSON vira lista vazia, não erro", () => {
    expect(filtrarAlternativas(BASE, "Desculpe, não posso ajudar.")).toEqual([]);
  });
});
