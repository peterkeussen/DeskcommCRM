import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn() } }));

import { copilotSettingsWriteSchema } from "@/lib/schemas/settings";

import { configuracaoDoCopiloto, lerConfiguracaoDoCopiloto } from "./configuracao";

describe("configuração do assistente do atendente", () => {
  it("organização que nunca abriu a tela: máscara de dado pessoal LIGADA", () => {
    expect(configuracaoDoCopiloto({})).toEqual({ mascarar_pii: true });
    expect(configuracaoDoCopiloto(null)).toEqual({ mascarar_pii: true });
  });

  it("o que a organização decidiu vale", () => {
    expect(configuracaoDoCopiloto({ ai_copilot: { mascarar_pii: false } })).toEqual({ mascarar_pii: false });
  });

  it("valor com forma errada cai no padrão, sem derrubar ninguém", () => {
    expect(configuracaoDoCopiloto({ ai_copilot: { mascarar_pii: "sim" } })).toEqual({ mascarar_pii: true });
    expect(configuracaoDoCopiloto({ ai_copilot: "quebrado" })).toEqual({ mascarar_pii: true });
  });

  it("leitura que falha devolve o padrão em vez de lançar", async () => {
    const cliente = {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: new Error("42703") }) }) }),
      }),
    };
    await expect(lerConfiguracaoDoCopiloto(cliente, "org")).resolves.toEqual({ mascarar_pii: true });
  });

  it("escrita recusa chave desconhecida e corpo vazio", () => {
    expect(copilotSettingsWriteSchema.safeParse({ mascarar_pii: false }).success).toBe(true);
    expect(copilotSettingsWriteSchema.safeParse({ inventado: true }).success).toBe(false);
    expect(copilotSettingsWriteSchema.safeParse({}).success).toBe(false);
    expect(copilotSettingsWriteSchema.safeParse({ mascarar_pii: "true" }).success).toBe(false);
  });
});
