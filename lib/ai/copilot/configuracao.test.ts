import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn() } }));

import { copilotSettingsWriteSchema } from "@/lib/schemas/settings";

import { configuracaoDoCopiloto, lerConfiguracaoDoCopiloto } from "./configuracao";

const PADRAO = { mascarar_pii: true, resumo_ao_assumir: false, prioridade_da_fila: false };

describe("configuração do assistente do atendente", () => {
  it("organização que nunca abriu a tela: máscara LIGADA, resumo e prioridade DESLIGADOS", () => {
    expect(configuracaoDoCopiloto({})).toEqual(PADRAO);
    expect(configuracaoDoCopiloto(null)).toEqual(PADRAO);
  });

  it("o que a organização decidiu vale", () => {
    expect(configuracaoDoCopiloto({ ai_copilot: { mascarar_pii: false } })).toEqual({ ...PADRAO, mascarar_pii: false });
  });

  it("ligar um recurso não mexe nos outros", () => {
    expect(configuracaoDoCopiloto({ ai_copilot: { resumo_ao_assumir: true } })).toEqual({ ...PADRAO, resumo_ao_assumir: true });
  });

  it("valor com forma errada cai no padrão, sem derrubar ninguém", () => {
    expect(configuracaoDoCopiloto({ ai_copilot: { mascarar_pii: "sim" } })).toEqual(PADRAO);
    expect(configuracaoDoCopiloto({ ai_copilot: "quebrado" })).toEqual(PADRAO);
  });

  it("leitura que falha devolve o padrão em vez de lançar", async () => {
    const cliente = {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: new Error("42703") }) }) }),
      }),
    };
    await expect(lerConfiguracaoDoCopiloto(cliente, "org")).resolves.toEqual(PADRAO);
  });

  it("escrita recusa chave desconhecida e corpo vazio", () => {
    expect(copilotSettingsWriteSchema.safeParse({ mascarar_pii: false }).success).toBe(true);
    expect(copilotSettingsWriteSchema.safeParse({ resumo_ao_assumir: true, prioridade_da_fila: true }).success).toBe(true);
    expect(copilotSettingsWriteSchema.safeParse({ inventado: true }).success).toBe(false);
    expect(copilotSettingsWriteSchema.safeParse({}).success).toBe(false);
    expect(copilotSettingsWriteSchema.safeParse({ mascarar_pii: "true" }).success).toBe(false);
  });
});
