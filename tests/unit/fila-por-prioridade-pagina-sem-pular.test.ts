/**
 * A FILA POR PRIORIDADE PAGINA SEM PULAR NEM REPETIR CONVERSA.
 *
 * O filtro de cursor é texto na gramática do `or=` do PostgREST, com três
 * chaves de ordem (classe, coluna da aba com `nulls last`, id). Um erro ali não
 * quebra nada visível: a página seguinte simplesmente não traz algumas
 * conversas — e conversa urgente que some da fila é o oposto do recurso.
 *
 * O teste avalia o filtro de verdade (um avaliador mínimo da gramática) contra
 * um conjunto com empates de classe, empates de data e datas nulas, pagina de
 * 2 em 2 e exige que a concatenação das páginas seja a ordem completa.
 */
import { describe, expect, it } from "vitest";

import { filtroDepoisDoCursorPorPrioridade } from "@/app/api/v1/conversations/_handler";

type Linha = { id: string; ai_priority_rank: number; last_inbound_at: string | null };

function dividirNoTopo(s: string): string[] {
  const partes: string[] = [];
  let nivel = 0;
  let atual = "";
  for (const ch of s) {
    if (ch === "(") nivel++;
    if (ch === ")") nivel--;
    if (ch === "," && nivel === 0) {
      partes.push(atual);
      atual = "";
    } else atual += ch;
  }
  partes.push(atual);
  return partes;
}

function avaliar(expr: string, l: Linha): boolean {
  if (expr.startsWith("and(")) return dividirNoTopo(expr.slice(4, -1)).every((p) => avaliar(p, l));
  if (expr.startsWith("or(")) return dividirNoTopo(expr.slice(3, -1)).some((p) => avaliar(p, l));
  const [col, op, ...resto] = expr.split(".");
  const valor = resto.join(".");
  const atual = (l as Record<string, unknown>)[col!];
  if (op === "is") return valor === "null" ? atual === null : false;
  if (atual === null || atual === undefined) return false; // comparação com nulo é nula
  const a = typeof atual === "number" ? atual : String(atual);
  const b = typeof atual === "number" ? Number(valor) : valor;
  if (op === "eq") return a === b;
  if (op === "gt") return a > b;
  if (op === "lt") return a < b;
  throw new Error(`operador desconhecido: ${op}`);
}

function ordenar(linhas: Linha[], asc: boolean): Linha[] {
  return [...linhas].sort((x, y) => {
    if (x.ai_priority_rank !== y.ai_priority_rank) return x.ai_priority_rank - y.ai_priority_rank;
    if (x.last_inbound_at !== y.last_inbound_at) {
      if (x.last_inbound_at === null) return 1; // nulls last
      if (y.last_inbound_at === null) return -1;
      const c = x.last_inbound_at < y.last_inbound_at ? -1 : 1;
      return asc ? c : -c;
    }
    const c = x.id < y.id ? -1 : 1;
    return asc ? c : -c;
  });
}

const T = (h: number) => `2026-09-13T1${h}:00:00+00:00`;
const LINHAS: Linha[] = [
  { id: "a1", ai_priority_rank: 1, last_inbound_at: T(1) },
  { id: "a2", ai_priority_rank: 0, last_inbound_at: T(3) },
  { id: "a3", ai_priority_rank: 0, last_inbound_at: T(1) },
  { id: "a4", ai_priority_rank: 2, last_inbound_at: T(0) },
  { id: "a5", ai_priority_rank: 0, last_inbound_at: T(1) }, // empate de data com a3
  { id: "a6", ai_priority_rank: 1, last_inbound_at: null },
  { id: "a7", ai_priority_rank: 0, last_inbound_at: null },
  { id: "a8", ai_priority_rank: 1, last_inbound_at: T(2) },
  { id: "a9", ai_priority_rank: 1, last_inbound_at: null },
];

describe.each([
  ["Fila (tempo de espera, asc)", true],
  ["demais abas (atividade recente, desc)", false],
] as const)("%s", (_nome, asc) => {
  it("as páginas somadas são a ordem completa", () => {
    const completa = ordenar(LINHAS, asc);
    const vistas: string[] = [];
    let cursor: { sort: string | null; id: string; rank: number } | null = null;
    for (let guarda = 0; guarda < 20; guarda++) {
      const candidatas: Linha[] = cursor
        ? LINHAS.filter((l) =>
            dividirNoTopo(filtroDepoisDoCursorPorPrioridade("last_inbound_at", asc ? "gt" : "lt", cursor!)).some((p) =>
              avaliar(p, l),
            ),
          )
        : LINHAS;
      const pagina: Linha[] = ordenar(candidatas, asc).slice(0, 2);
      if (pagina.length === 0) break;
      vistas.push(...pagina.map((l) => l.id));
      const ultima: Linha = pagina[pagina.length - 1]!;
      cursor = { sort: ultima.last_inbound_at, id: ultima.id, rank: ultima.ai_priority_rank };
    }
    expect(vistas).toEqual(completa.map((l) => l.id));
  });

  it("urgentes vêm antes de tudo", () => {
    const ordem = ordenar(LINHAS, asc);
    expect(ordem.slice(0, 4).every((l) => l.ai_priority_rank === 0)).toBe(true);
  });
});
