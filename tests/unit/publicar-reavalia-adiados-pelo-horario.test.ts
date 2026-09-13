/**
 * PUBLICAR REAVALIA AS RESPOSTAS QUE O HORÁRIO ANTIGO ADIOU.
 *
 * Medido numa instalação real (2026-09-13): o turno das 07:19 foi adiado para
 * 08:00:58 pela versão das 08:00; às 07:31 publicou-se a versão das 07:00, e a
 * mensagem das 07:32 foi juntada ao job parado. Ninguém respondeu até 08:00:58.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/ai/runtime/agent", () => ({ chaveDePlataforma: () => true }));

import { MOTIVO_ADIADO_PELO_HORARIO } from "@/lib/agent-engine/agent/janela-de-atendimento";
import { rescheduleJob } from "@/lib/agent-engine/queue/queue";
import { publishAgentVersion } from "@/lib/ai/agents/publish";
import { reavaliarRespostasAdiadasPeloHorario } from "@/lib/ai/agents/reavaliar-adiados";

const ORG = "11111111-1111-4111-8111-111111111111";
const AGENTE = "22222222-2222-4222-8222-222222222222";
const VERSAO = "33333333-3333-4333-8333-333333333333";
const CANAL = "44444444-4444-4444-8444-444444444444";

interface Job {
  id: string;
  organization_id: string;
  kind: string;
  status: string;
  run_after: string;
  last_error: string | null;
  payload: { channel_session_id?: string };
}

const FUTURO = new Date(Date.now() + 40 * 60_000).toISOString();

function job(parcial: Partial<Job> & { id: string }): Job {
  return {
    organization_id: ORG,
    kind: "inbound_turn",
    status: "pending",
    run_after: FUTURO,
    last_error: MOTIVO_ADIADO_PELO_HORARIO,
    payload: { channel_session_id: CANAL },
    ...parcial,
  };
}

/**
 * Admin client falso que APLICA os filtros sobre uma tabela em memória — um
 * dublê que devolvesse sempre as mesmas linhas aprovaria uma liberação sem
 * filtro nenhum, que é justamente o defeito a vigiar.
 */
function adminFalso(opts: { jobs: Job[]; versao?: { channel_session_id: string | null }; publicarFalha?: boolean; updateFalha?: boolean }) {
  const jobs = opts.jobs;
  const from = (tabela: string) => {
    const filtros: Array<(j: Job) => boolean> = [];
    let update: Record<string, unknown> | null = null;
    const chain = {
      select: () => chain,
      update: (valores: Record<string, unknown>) => {
        update = valores;
        return chain;
      },
      eq: (col: string, val: unknown) => {
        filtros.push((j) =>
          col === "payload->>channel_session_id"
            ? j.payload.channel_session_id === val
            : (j as unknown as Record<string, unknown>)[col] === val,
        );
        return chain;
      },
      gt: (col: string, val: string) => {
        filtros.push((j) => String((j as unknown as Record<string, unknown>)[col]) > val);
        return chain;
      },
      maybeSingle: async () =>
        tabela === "ai_agent_versions"
          ? { data: { provider: "anthropic", credential_id: "cred", ...(opts.versao ?? { channel_session_id: CANAL }) }, error: null }
          : { data: null, error: null },
      then: (ok: (v: unknown) => unknown) => {
        if (tabela !== "job_queue" || update === null) return Promise.resolve({ data: [], error: null }).then(ok);
        if (opts.updateFalha) return Promise.resolve({ data: null, error: { message: "boom" } }).then(ok);
        const alvo = jobs.filter((j) => filtros.every((f) => f(j)));
        for (const j of alvo) Object.assign(j, update);
        return Promise.resolve({ data: alvo.map((j) => ({ id: j.id })), error: null }).then(ok);
      },
    };
    return chain;
  };
  const rpc = vi.fn(async () =>
    opts.publicarFalha
      ? { data: null, error: { message: "agent_not_found" } }
      : { data: [{ agent_id: AGENTE, version_id: VERSAO, previous_version_id: null, published_at: "t" }], error: null },
  );
  return { from, rpc } as never;
}

const publicar = (admin: never) => publishAgentVersion(admin, { orgId: ORG, agentId: AGENTE, versionId: VERSAO });

beforeEach(() => vi.clearAllMocks());

describe("publicar uma versão libera os turnos adiados pelo horário", () => {
  it("o adiado pelo horário, deste canal e desta organização, volta para agora", async () => {
    const jobs = [job({ id: "adiado" })];
    const r = await publicar(adminFalso({ jobs }));
    expect(r).toMatchObject({ ok: true, respostas_adiadas_reavaliadas: 1 });
    expect(new Date(jobs[0]!.run_after).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("não toca no que não é dele: outro motivo, outro canal, outra organização, running, follow-up", async () => {
    const intocados = [
      job({ id: "midia", last_error: "mídia ainda sendo transcrita" }),
      job({ id: "debounce", last_error: null }),
      job({ id: "outro-canal", payload: { channel_session_id: "55555555-5555-4555-8555-555555555555" } }),
      job({ id: "outra-org", organization_id: "99999999-9999-4999-8999-999999999999" }),
      job({ id: "rodando", status: "running" }),
      job({ id: "followup", kind: "followup_turn" }),
    ];
    const r = await publicar(adminFalso({ jobs: intocados }));
    expect(r).toMatchObject({ ok: true, respostas_adiadas_reavaliadas: 0 });
    for (const j of intocados) expect(j.run_after, j.id).toBe(FUTURO);
  });

  it("versão sem canal alcança os adiados da organização inteira", async () => {
    const jobs = [job({ id: "a" }), job({ id: "b", payload: { channel_session_id: "55555555-5555-4555-8555-555555555555" } })];
    const r = await publicar(adminFalso({ jobs, versao: { channel_session_id: null } }));
    expect(r).toMatchObject({ ok: true, respostas_adiadas_reavaliadas: 2 });
  });

  it("publicação que falha não libera nada", async () => {
    const jobs = [job({ id: "adiado" })];
    const r = await publicar(adminFalso({ jobs, publicarFalha: true }));
    expect(r.ok).toBe(false);
    expect(jobs[0]!.run_after).toBe(FUTURO);
  });

  it("falha ao liberar não transforma a publicação em erro", async () => {
    const r = await publicar(adminFalso({ jobs: [job({ id: "adiado" })], updateFalha: true }));
    expect(r).toMatchObject({ ok: true, respostas_adiadas_reavaliadas: 0 });
  });
});

describe("o turno grava exatamente o motivo que a liberação procura", () => {
  it("rescheduleJob grava a constante sem cortar nem alterar", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    await rescheduleJob({ query } as never, "job-1", "worker-1", { delayMs: 1000, reason: MOTIVO_ADIADO_PELO_HORARIO });
    const params = (query.mock.calls[0] as unknown as [string, unknown[]])[1];
    expect(params[3]).toBe(MOTIVO_ADIADO_PELO_HORARIO);
  });

  it("inbound-turn usa a constante, não uma frase solta que possa divergir", () => {
    const fonte = readFileSync(resolve(process.cwd(), "lib/agent-engine/agent/inbound-turn.ts"), "utf8");
    expect(fonte).toContain("reason: MOTIVO_ADIADO_PELO_HORARIO");
    expect(fonte).not.toContain("'fora do horário de funcionamento do agente — turno adiado");
  });

  it("a função isolada devolve 0 e não lança quando o banco falha", async () => {
    await expect(
      reavaliarRespostasAdiadasPeloHorario(adminFalso({ jobs: [], updateFalha: true }), { orgId: ORG, channelSessionId: CANAL }),
    ).resolves.toBe(0);
  });
});
