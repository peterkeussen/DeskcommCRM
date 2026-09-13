import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { PONTO_POR_ID } from "@/lib/ai/pontos/registro";

import { MODELO_GEMINI_SUGERIDO, PONTOS_DO_COPILOTO } from "./modelos";

describe("atalho do assistente do atendente", () => {
  it("todo ponto do atalho existe no registro e aceita troca de modelo", () => {
    for (const id of PONTOS_DO_COPILOTO) {
      const ponto = PONTO_POR_ID.get(id);
      expect(ponto, `${id} não está em lib/ai/pontos/registro.ts`).toBeDefined();
      expect(ponto?.fixo, `${id} é fixo — o atalho gravaria um binding que ninguém lê`).toBeUndefined();
      // Modelo sugerido não declara ferramentas para estes pontos: nenhum pode exigir.
      expect(ponto?.exige.tools ?? false).toBe(false);
    }
  });

  it("o modelo sugerido está no catálogo que o baseline semeia", () => {
    const baseline = readFileSync(resolve(__dirname, "../../../supabase/baseline.sql"), "utf8");
    const par = new RegExp(`\\('${MODELO_GEMINI_SUGERIDO.provider}',\\s*'${MODELO_GEMINI_SUGERIDO.modelId.replace(/\./g, "\\.")}'`);
    expect(baseline).toMatch(par);
    // E ninguém o depreciou depois de semear.
    expect(baseline).not.toMatch(
      new RegExp(`deprecated_at\\s*=\\s*now\\(\\)[^;]*model_id\\s*=\\s*'${MODELO_GEMINI_SUGERIDO.modelId.replace(/\./g, "\\.")}'`),
    );
  });
});
