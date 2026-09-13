import { describe, expect, it } from "vitest";

import { NOTA_POSITIVA, PRIORIDADES, posicaoNaFila, prioridadeDaMensagem } from "./prioridade";

const LIMIAR = 0.3;

describe("prioridade da conversa na fila", () => {
  it.each([
    // [nota, urgente, esperado, por quê]
    [0.5, true, "urgente", "educado e com prazo: urgência não depende de humor"],
    [0.1, false, "urgente", "insatisfeito abaixo do limiar do agente"],
    [0.1, true, "urgente", "os dois ao mesmo tempo"],
    [0.5, false, "neutro", "nem irritado, nem com pressa"],
    [LIMIAR, false, "neutro", "exatamente no limiar não é insatisfeito (o handoff usa `<`)"],
    [NOTA_POSITIVA, false, "positivo", "a partir da nota positiva"],
    [0.95, false, "positivo", "satisfeito e sem pressa"],
  ] as Array<[number, boolean, string, string]>)("nota %s, urgente=%s → %s (%s)", (nota, urgente, esperado) => {
    expect(prioridadeDaMensagem({ nota, urgente, limiarDeInsatisfacao: LIMIAR })).toBe(esperado);
  });

  it("o limiar é o do agente, não uma constante: agente tolerante não marca urgente a mesma nota", () => {
    expect(prioridadeDaMensagem({ nota: 0.2, urgente: false, limiarDeInsatisfacao: 0.1 })).toBe("neutro");
    expect(prioridadeDaMensagem({ nota: 0.2, urgente: false, limiarDeInsatisfacao: 0.9 })).toBe("urgente");
  });

  it("a ordem da fila segue a ordem da tupla, e conversa nunca classificada fica no meio", () => {
    expect(PRIORIDADES.map(posicaoNaFila)).toEqual([0, 1, 2]);
    expect(posicaoNaFila(null)).toBe(posicaoNaFila("neutro"));
  });
});
