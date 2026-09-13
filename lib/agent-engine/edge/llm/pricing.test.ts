import { describe, expect, it } from "vitest";

import { costCents } from "./pricing";

const umMilhao = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 0, cacheWriteTokens: 0 };

describe("costCents — Gemini", () => {
  it("cobra o 2.5 Flash pela tarifa dele ($0,30 + $2,50 por milhão)", () => {
    expect(costCents("gemini-2.5-flash", umMilhao)).toBeCloseTo(280);
  });

  it("não confunde o Flash-Lite com o Flash, embora um seja prefixo do outro", () => {
    // $0,10 + $0,40 = 50 centavos. Na ordem errada da tabela daria 280.
    expect(costCents("gemini-2.5-flash-lite", umMilhao)).toBeCloseTo(50);
  });

  it("cobra o 2.5 Pro na faixa até 200 mil tokens", () => {
    expect(costCents("gemini-2.5-pro", umMilhao)).toBeCloseTo(1125);
  });

  it("aceita o id com rota `google/`", () => {
    expect(costCents("google/gemini-2.5-flash", umMilhao)).toBeCloseTo(280);
  });

  it("desconta a leitura de cache da entrada e cobra pela tarifa de cache", () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 1_000_000, cacheWriteTokens: 0 };
    expect(costCents("gemini-2.5-flash", usage)).toBeCloseTo(3);
  });

  it("cobra o 3.5 Flash pela tarifa dele ($1,50 + $9,00 por milhão)", () => {
    expect(costCents("gemini-3.5-flash", umMilhao)).toBeCloseTo(1050);
  });

  it("o 3.5 Flash-Lite, sem linha própria, é NULL — nunca o preço do Flash", () => {
    expect(costCents("gemini-3.5-flash-lite", umMilhao)).toBeNull();
  });

  it("modelo sem preço continua NULL, nunca zero", () => {
    expect(costCents("gemini-9-ultra", umMilhao)).toBeNull();
  });
});
