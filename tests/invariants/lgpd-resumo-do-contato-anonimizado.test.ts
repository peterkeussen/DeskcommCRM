/**
 * ANONIMIZAR O CONTATO APAGA OS RESUMOS DAS CONVERSAS DELE — e só os dele.
 *
 * O resumo para quem assume (migration 0240) é texto da conversa de uma pessoa:
 * "Motivo: troca do tênis da Maria, pedido 4821". Ele não tem FK para
 * `contacts`, então a varredura de `lgpd-cascata-alcanca-quem-guarda-pessoa`
 * não o enxerga — e é justamente por isso que precisa de prova própria, pelo
 * desfecho, e não pela presença do trigger no catálogo.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, describe, expect, it } from "vitest";

const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${process.env.TEST_DB_PORT ?? 54329}/postgres`,
});
afterAll(() => pool.end());

async function conversaComResumo(org: string, nome: string) {
  const contato = randomUUID(), conversa = randomUUID(), sessao = randomUUID();
  await pool.query("insert into contacts(id,organization_id,display_name) values($1,$2,$3)", [contato, org, nome]);
  await pool.query(
    "insert into channel_sessions(id,organization_id,waha_session_name,status,webhook_secret_encrypted) values($1,$2,$3,'WORKING',decode('00','hex'))",
    [sessao, org, `lgpd-resumo-${sessao.slice(0, 8)}`],
  );
  await pool.query(
    "insert into conversations(id,organization_id,contact_id,channel_session_id) values($1,$2,$3,$4)",
    [conversa, org, contato, sessao],
  );
  await pool.query(
    "insert into conversation_ai_summaries(organization_id,conversation_id,body,gatilho) values($1,$2,$3,'handoff')",
    [org, conversa, `Motivo: troca do tênis de ${nome}`],
  );
  return { contato, conversa };
}

const resumos = async (conversa: string) =>
  Number((await pool.query("select count(*) n from conversation_ai_summaries where conversation_id=$1", [conversa])).rows[0].n);

describe("LGPD: resumo para o atendente", () => {
  it("anonimizar apaga os resumos do contato e preserva os do vizinho", async () => {
    const org = randomUUID();
    await pool.query(
      "insert into organizations(id,slug,legal_name,display_name) values($1::uuid,$1::text,'LGPD resumo','LGPD resumo')",
      [org],
    );
    const titular = await conversaComResumo(org, "Maria Titular");
    const vizinho = await conversaComResumo(org, "João Vizinho");
    expect(await resumos(titular.conversa)).toBe(1);

    // A FUNÇÃO REAL da cascata, não um UPDATE à mão: o trigger precisa disparar
    // dentro da transação por onde a anonimização de fato passa.
    await pool.query("select public.fn_lgpd_cascade_redact_contact($1, $2, gen_random_uuid())", [org, titular.contato]);

    expect(await resumos(titular.conversa)).toBe(0);
    expect(await resumos(vizinho.conversa)).toBe(1);
  });
});
