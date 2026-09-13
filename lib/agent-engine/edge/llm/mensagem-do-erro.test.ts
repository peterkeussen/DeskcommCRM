import { describe, expect, it } from "vitest";

import { MENSAGEM_PADRAO_DO_ERRO, mensagemDoErroDoProvedor } from "./mensagem-do-erro";

describe("mensagemDoErroDoProvedor", () => {
  it("cota do plano gratuito do Google: diz o que fazer (texto real do log de 2026-09-13)", () => {
    const erro = new Error(
      "Failed after 3 attempts. Last error: AI_APICallError: You exceeded your current quota, please check your plan and billing details. " +
        "* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 5, model: gemini-3.5-flash\nPlease retry in 22.78s.",
    );
    const r = mensagemDoErroDoProvedor(erro);
    expect(r.codigo).toBe("limite_ou_saldo");
    expect(r.mensagem).toMatch(/plano gratuito/);
    expect(r.mensagem).toMatch(/faturamento/);
  });

  it("cota paga (sem free_tier): frase de limite/saldo, não a do plano gratuito", () => {
    const r = mensagemDoErroDoProvedor(Object.assign(new Error("429 rate limit"), { statusCode: 429 }));
    expect(r.mensagem).toMatch(/limite de uso/);
    expect(r.mensagem).not.toMatch(/plano gratuito/);
  });

  it.each([
    [Object.assign(new Error("nope"), { statusCode: 401 }), "credencial_recusada", /recusou a chave/],
    [Object.assign(new Error("model not found"), { statusCode: 404 }), "modelo_inexistente", /não existe no provedor/],
    [Object.assign(new Error("boom"), { statusCode: 503 }), "provedor_indisponivel", /não respondeu/],
  ])("%s → %s", (erro, codigo, frase) => {
    const r = mensagemDoErroDoProvedor(erro);
    expect(r.codigo).toBe(codigo);
    expect(r.mensagem).toMatch(frase);
  });

  it("erro que não é do provedor mantém a frase de antes", () => {
    expect(mensagemDoErroDoProvedor(new Error("algo interno")).mensagem).toBe(MENSAGEM_PADRAO_DO_ERRO);
  });

  it("nunca repassa o texto cru do provedor", () => {
    const r = mensagemDoErroDoProvedor(new Error("401 invalid api key AIzaSyEXEMPLOEXEMPLOEXEMPLO"));
    expect(r.mensagem).not.toContain("AIza");
  });
});
