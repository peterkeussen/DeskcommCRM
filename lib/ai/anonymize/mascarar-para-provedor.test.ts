import { describe, expect, it } from "vitest";

import { mascararParaProvedor } from "./mascarar-para-provedor";

describe("mascararParaProvedor", () => {
  it("tira CPF, e-mail, telefone e CEP e conta cada um", () => {
    const { texto, contagem } = mascararParaProvedor(
      "Meu CPF é 123.456.789-09, e-mail maria@exemplo.com.br, fone 11 98765-4321, CEP 01310-100.",
    );
    expect(texto).toBe("Meu CPF é [CPF], e-mail [EMAIL], fone [TELEFONE], CEP [CEP].");
    expect(contagem).toEqual({ cpf: 1, email: 1, phone: 1, cep: 1 });
  });

  it("telefone com DDD entre parênteses não deixa dígito passar", () => {
    // O `\b` do padrão compartilhado não casa antes de "(", então o parêntese de
    // abertura fica no texto — cosmético. O que importa é nenhum dígito sobrar.
    const { texto } = mascararParaProvedor("liga no (11) 98765-4321");
    expect(texto).not.toMatch(/\d/);
    expect(texto).toContain("[TELEFONE]");
  });

  it("mantém o nome — é sentido, não identificador direto", () => {
    expect(mascararParaProvedor("A Maria pediu reembolso").texto).toBe("A Maria pediu reembolso");
  });

  it("CPF sem pontuação não é lido como CEP pela metade", () => {
    expect(mascararParaProvedor("cpf 12345678909").texto).toBe("cpf [CPF]");
  });

  it("chamadas seguidas não pulam ocorrência (regex com estado)", () => {
    mascararParaProvedor("a@b.com");
    expect(mascararParaProvedor("x@y.com e z@w.com").contagem.email).toBe(2);
  });

  it("texto sem dado pessoal volta idêntico", () => {
    const r = mascararParaProvedor("Quero saber o prazo de entrega do pedido 42");
    expect(r.texto).toBe("Quero saber o prazo de entrega do pedido 42");
    expect(Object.values(r.contagem).every((n) => n === 0)).toBe(true);
  });
});
