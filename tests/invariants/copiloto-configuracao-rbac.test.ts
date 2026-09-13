/**
 * QUEM LIGA E DESLIGA O ASSISTENTE DO ATENDENTE — provado pelo desfecho, com JWT.
 *
 * `fn_ai_copilot_settings` é `security definer` executável por `authenticated`,
 * e grava em `organizations.settings`. Entre as chaves está `mascarar_pii`:
 * desligá-la faz CPF, e-mail e telefone saírem para o provedor de IA. Então a
 * pergunta não é "a policy parece certa", é "quem de fato consegue gravar".
 *
 * Cada recusa confere também a AUSÊNCIA DE EFEITO: uma função que lança depois
 * de gravar passaria num teste que só olha o erro.
 */
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const pool = new pg.Pool({
  connectionString: `postgresql://postgres:postgres@127.0.0.1:${process.env.TEST_DB_PORT ?? 54329}/postgres`,
});
const tenants = [0, 1].map(() => ({
  org: randomUUID(),
  admin: randomUUID(),
  manager: randomUUID(),
  agent: randomUUID(),
  viewer: randomUUID(),
}));

async function asRole(
  role: "anon" | "authenticated",
  user: string | null,
  values: unknown[],
  aal = "aal1",
) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`set local role ${role}`);
    await client.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ role, aal, ...(user ? { sub: user } : {}) }),
    ]);
    const result = await client.query("select fn_ai_copilot_settings($1,$2) result", values);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

const bloco = async (org: string) =>
  (await pool.query("select settings->'ai_copilot' c from organizations where id=$1", [org])).rows[0].c;

beforeAll(async () => {
  for (const t of tenants) {
    await pool.query(
      "insert into organizations(id,slug,legal_name,display_name) values($1::uuid,$1::text,'ACL copiloto','ACL copiloto')",
      [t.org],
    );
    for (const role of ["admin", "manager", "agent", "viewer"] as const) {
      await pool.query("insert into auth.users(id,email) values($1,$2)", [t[role], `${t[role]}@invariant.test`]);
      await pool.query(
        "insert into user_organizations(user_id,organization_id,role,accepted_at) values($1,$2,$3,now())",
        [t[role], t.org, role],
      );
    }
  }
});
afterAll(() => pool.end());

describe("fn_ai_copilot_settings: só manager+ da própria organização grava", () => {
  it("manager grava na PRÓPRIA organização, com merge — nos dois tenants", async () => {
    for (const t of tenants) {
      await asRole("authenticated", t.manager, [t.org, { mascarar_pii: false }]);
      const r = await asRole("authenticated", t.admin, [t.org, { resumo_ao_assumir: true }]);
      expect(r.rows[0].result).toEqual({ mascarar_pii: false, resumo_ao_assumir: true });
      expect(await bloco(t.org)).toEqual({ mascarar_pii: false, resumo_ao_assumir: true });
    }
  });

  it("agent, viewer, manager de OUTRA organização e anon são recusados, sem efeito", async () => {
    for (const t of tenants) {
      const outra = tenants.find((x) => x.org !== t.org)!;
      const antes = await bloco(t.org);
      for (const user of [t.agent, t.viewer, outra.manager, outra.admin]) {
        await expect(asRole("authenticated", user, [t.org, { mascarar_pii: true }])).rejects.toMatchObject({
          code: "42501",
        });
      }
      await expect(asRole("anon", null, [t.org, { mascarar_pii: true }])).rejects.toMatchObject({
        code: "42501",
      });
      expect(await bloco(t.org)).toEqual(antes);
    }
  });

  it("forma inválida é recusada sem efeito: não-booleano, chave fora do padrão, não-objeto", async () => {
    const t = tenants[0]!;
    const antes = await bloco(t.org);
    for (const invalido of [{ mascarar_pii: "false" }, { "Chave-Ruim": true }, ["mascarar_pii"]]) {
      // JSON.stringify: o driver serializa array JS como array do Postgres, não como json.
      await expect(asRole("authenticated", t.manager, [t.org, JSON.stringify(invalido)])).rejects.toMatchObject({
        code: "22023",
      });
    }
    expect(await bloco(t.org)).toEqual(antes);
  });

  it("quem TEM fator de MFA precisa da sessão aal2", async () => {
    const t = tenants[1]!, factor = randomUUID();
    await pool.query(
      "insert into auth.mfa_factors(id,user_id,status,factor_type) values($1,$2,'verified','totp')",
      [factor, t.manager],
    );
    try {
      const antes = await bloco(t.org);
      await expect(
        asRole("authenticated", t.manager, [t.org, { prioridade_da_fila: true }], "aal1"),
      ).rejects.toMatchObject({ code: "42501" });
      expect(await bloco(t.org)).toEqual(antes);
      await asRole("authenticated", t.manager, [t.org, { prioridade_da_fila: true }], "aal2");
      expect((await bloco(t.org)).prioridade_da_fila).toBe(true);
    } finally {
      await pool.query("delete from auth.mfa_factors where id=$1", [factor]);
    }
  });
});
