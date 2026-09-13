/**
 * ASSISTENTE DO ATENDENTE, PELA TELA — ligar, resumir, escolher versão, ver a fila.
 *
 * O que esta spec prova é o que só a tela prova:
 *  - os interruptores de IA › Provedores gravam e a Caixa de entrada obedece;
 *  - "Gerar resumo" mostra o resumo no painel da conversa, e mensagem nova o
 *    marca como desatualizado;
 *  - com "outras versões" ligado, a sugestão chega com Opção 1/2/3, e o texto
 *    APROVADO é o da opção escolhida;
 *  - com "urgentes no topo" ligado, a Fila muda de ordem e mostra o selo.
 *
 * O provedor de IA é o controlado do CI (`INTERNAL_AGENT_RUN_STUB`,
 * `lib/agent-engine/agent/preview-fixture.ts`): troca só a resposta do modelo;
 * rotas, seam, banco, RLS e tela são os reais. A CLASSIFICAÇÃO de urgência não é
 * exercitada aqui (o worker de sentimento não passa pelo seam do CI) — a
 * `ai_priority` é semeada, e o que se mede é a ordenação e o selo. A
 * classificação tem prova unitária e prova contra a API real do Gemini
 * (docs/testing/user-journey-map.md, 2026-09-13).
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { test, expect, type Locator, type Page, type TestInfo } from "@playwright/test";
import { credenciaisSupabaseDeTeste } from "../../scripts/lib/env-de-teste";
import { seedPlatformPlaybook } from "../../lib/agent-engine/agent/playbook-seed";

const credentials = credenciaisSupabaseDeTeste();
const db = createClient(credentials.url, credentials.serviceRole, { auth: { persistSession: false } });
const password = `Local-${randomUUID()}!`;
const orgs: string[] = [];
const users: string[] = [];

test.use({ trace: "on", timezoneId: "America/Sao_Paulo", viewport: { width: 1440, height: 1000 } });
test.describe.configure({ timeout: 180_000 });

async function insert(table: string, value: Record<string, unknown>) {
  const { data, error } = await db.from(table).insert(value).select("id").single();
  if (error) throw new Error(`${table}: ${error.message}`);
  return data.id as string;
}

async function inbound(f: { org: string; contact: string; conversation: string; channel: string }, body: string, at = new Date()) {
  await insert("messages", {
    organization_id: f.org,
    contact_id: f.contact,
    conversation_id: f.conversation,
    channel_session_id: f.channel,
    direction: "inbound",
    type: "text",
    status: "received",
    external_id: randomUUID(),
    body,
    sent_at: at.toISOString(),
  });
  const r = await db.rpc("fn_mark_conversation_message", {
    p_conv: f.conversation,
    p_direction: "inbound",
    p_preview: body,
    p_at: at.toISOString(),
  });
  if (r.error) throw r.error;
}

async function fixture(pool: pg.Pool) {
  expect(["127.0.0.1", "localhost"]).toContain(new URL(credentials.dbUrl).hostname);
  expect(process.env.INTERNAL_AGENT_RUN_STUB).toBe("true");
  await seedPlatformPlaybook(pool);

  const email = `copiloto-ui-${randomUUID()}@invariant.test`;
  const created = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error || !created.data.user) throw created.error;
  const user = created.data.user.id;
  users.push(user);

  const org = await insert("organizations", {
    slug: `copiloto-ui-${randomUUID()}`,
    display_name: "Copiloto local",
    legal_name: "Copiloto local",
    onboarded_at: new Date().toISOString(),
    // O resumo não tem agente de quem herdar: usa o padrão da organização, como
    // numa instalação feita pelo kit (que grava settings.llm).
    settings: { llm: { provider: "anthropic", default_model: "claude-sonnet-4-6" } },
  });
  orgs.push(org);
  await insert("user_organizations", {
    organization_id: org,
    user_id: user,
    role: "admin",
    accepted_at: new Date().toISOString(),
  });

  const channel = await insert("channel_sessions", {
    organization_id: org,
    waha_session_name: randomUUID(),
    display_name: "Copiloto local",
    status: "WORKING",
    webhook_secret_encrypted: "\\x00",
    metadata: { ai_gate: "allowlist" },
  });

  const contact = await insert("contacts", {
    organization_id: org,
    name: "Maria Copiloto",
    display_name: "Maria Copiloto",
    phone_number: "+15551230001",
    force_human: true,
  });
  const conversation = await insert("conversations", {
    organization_id: org,
    contact_id: contact,
    channel_session_id: channel,
    status: "open",
    assignee_kind: "user",
    assigned_to_user_id: user,
    bot_silenced_until: "infinity",
  });

  // Agente assistido publicado: é quem escreve o rascunho base.
  const agent = await insert("ai_agents", {
    organization_id: org,
    name: "Assistente do copiloto",
    system_prompt: "Ajude com informações confirmadas.",
    operation_mode: "assisted",
  });
  const version = await insert("ai_agent_versions", {
    organization_id: org,
    agent_id: agent,
    version_number: 1,
    system_prompt: "Ajude com informações confirmadas.",
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    channel_session_id: channel,
    status: "published",
  });
  const source = await insert("ai_knowledge_sources", {
    organization_id: org,
    agent_id: agent,
    source_type: "faq",
    name: "Atendimento",
    status: "ready",
  });
  const knowledge = await insert("ai_knowledge_versions", {
    organization_id: org,
    agent_id: agent,
    version_number: 1,
    is_active: true,
  });
  const chunk = randomUUID();
  await pool.query(
    "insert into ai_chunks(id,organization_id,knowledge_source_id,kb_version_id,position,content,content_hash,token_count,embedding,metadata) values($1::uuid,$2,$3,$4,0,'Informações de atendimento disponíveis com confirmação humana.',$1::text,12,array_fill(0.1::real,array[1536])::vector,'{}')",
    [chunk, org, source, knowledge],
  );
  await pool.query("update ai_agents set published_version_id=$1,active_kb_version_id=$2 where organization_id=$3 and id=$4", [
    version,
    knowledge,
    org,
    agent,
  ]);
  await pool.query("update conversations set active_ai_agent_id=$1 where organization_id=$2 and id=$3", [
    agent,
    org,
    conversation,
  ]);

  const f = { org, user, email, channel, contact, conversation };
  await inbound(f, "Quero informações do atendimento");
  return f;
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

/** Duas conversas SEM dono na Fila: a neutra espera há mais tempo, a urgente chegou depois. */
async function filaComDuasConversas(f: Fixture) {
  const semear = async (nome: string, minutosAtras: number, prioridade: "neutro" | "urgente") => {
    const contact = await insert("contacts", {
      organization_id: f.org,
      name: nome,
      display_name: nome,
      phone_number: `+1555123${String(1000 + minutosAtras).slice(-4)}`,
      force_human: true,
    });
    const conversation = await insert("conversations", {
      organization_id: f.org,
      contact_id: contact,
      channel_session_id: f.channel,
      status: "pending",
      bot_silenced_until: "infinity",
    });
    await inbound({ org: f.org, contact, conversation, channel: f.channel }, `mensagem de ${nome}`, new Date(Date.now() - minutosAtras * 60_000));
    const r = await db
      .from("conversations")
      .update({ ai_priority: prioridade, ai_priority_at: new Date().toISOString() })
      .eq("organization_id", f.org)
      .eq("id", conversation);
    if (r.error) throw r.error;
    return conversation;
  };
  const neutra = await semear("Neutro Esperando Faz Tempo", 40, "neutro");
  const urgente = await semear("Urgente Chegou Agora", 2, "urgente");
  return { neutra, urgente };
}

async function login(page: Page, f: Fixture) {
  await page.goto("/login");
  await page.getByLabel(/e-?mail/i).fill(f.email);
  await page.getByLabel(/senha/i).fill(password);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL(/\/app(?:\/|$)/, { timeout: 60_000 });
}

/** Evidência visual + medida por ferramenta: o bloco cabe na tela e está visível. */
async function capture(page: Page, target: Locator, info: TestInfo, name: string) {
  await target.scrollIntoViewIfNeeded();
  const dir = info.outputPath(name);
  mkdirSync(dir, { recursive: true });
  const measured = await target.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return {
      left: r.left,
      right: r.right,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      viewport: document.documentElement.clientWidth,
      visibility: getComputedStyle(el).visibility,
    };
  });
  expect(measured.left).toBeGreaterThanOrEqual(0);
  expect(measured.right).toBeLessThanOrEqual(measured.viewport + 1);
  expect(measured.scrollWidth).toBeLessThanOrEqual(measured.clientWidth + 1);
  expect(measured.visibility).toBe("visible");
  writeFileSync(`${dir}/measures.json`, JSON.stringify(measured, null, 2));
  await page.screenshot({ path: `${dir}/tela.png`, fullPage: true });
}

async function ligar(page: Page, chave: string) {
  const cartao = page.getByTestId("cartao-do-assistente");
  const interruptor = cartao.getByTestId(`assistente-${chave}`);
  await expect(interruptor).toBeEnabled({ timeout: 30_000 });
  if ((await interruptor.getAttribute("aria-checked")) === "true") return;
  const resposta = page.waitForResponse((r) => r.url().endsWith("/api/v1/ai/copilot") && r.request().method() === "PATCH");
  await interruptor.click();
  expect((await resposta).status()).toBe(200);
  await expect(interruptor).toHaveAttribute("aria-checked", "true");
}

test.afterAll(async () => {
  for (const org of orgs) {
    const r = await db.from("organizations").delete().eq("id", org);
    if (r.error) throw r.error;
  }
  for (const user of users) {
    const r = await db.auth.admin.deleteUser(user);
    if (r.error) throw r.error;
  }
});

test("ligar o assistente, gerar resumo, escolher outra versão da resposta e ver urgentes no topo da Fila", async ({
  page,
}, info) => {
  const pool = new pg.Pool({ connectionString: credentials.dbUrl, max: 5 });
  try {
    const f = await fixture(pool);
    const fila = await filaComDuasConversas(f);
    await login(page, f);

    // ── 1. Fila antes: ordem por tempo de espera, sem selo ──────────────────
    await page.goto("/app/inbox?filter=unassigned");
    const itens = page.locator("[data-conversation-id]");
    await expect(itens.first()).toHaveAttribute("data-conversation-id", fila.neutra, { timeout: 30_000 });
    await expect(page.getByTestId("selo-urgente")).toHaveCount(0);

    // ── 2. Ligar os três recursos pela tela ──────────────────────────────────
    await page.goto("/app/ai/providers");
    const cartao = page.getByTestId("cartao-do-assistente");
    await expect(cartao).toBeVisible({ timeout: 30_000 });
    await ligar(page, "resumo_ao_assumir");
    await ligar(page, "prioridade_da_fila");
    await ligar(page, "sugestoes_multiplas");
    await capture(page, cartao, info, "1-cartao-do-assistente");
    const { data: org } = await db.from("organizations").select("settings").eq("id", f.org).single();
    expect((org!.settings as { ai_copilot: unknown }).ai_copilot).toMatchObject({
      resumo_ao_assumir: true,
      prioridade_da_fila: true,
      sugestoes_multiplas: true,
      mascarar_pii: true,
    });

    // ── 3. Fila depois: urgente no topo, com selo ────────────────────────────
    await page.goto("/app/inbox?filter=unassigned");
    await expect(itens.first()).toHaveAttribute("data-conversation-id", fila.urgente, { timeout: 30_000 });
    await expect(itens.first().getByTestId("selo-urgente")).toBeVisible();
    await expect(page.locator(`[data-conversation-id="${fila.neutra}"]`).getByTestId("selo-urgente")).toHaveCount(0);
    await capture(page, itens.first(), info, "2-fila-urgente-no-topo");

    // ── 4. Resumo para quem assume ───────────────────────────────────────────
    await page.goto(`/app/inbox/${f.conversation}`);
    const resumo = page.getByTestId("inbox-resumo-da-conversa");
    await expect(resumo.getByTestId("resumo-vazio")).toBeVisible({ timeout: 30_000 });
    const gerou = page.waitForResponse((r) => r.url().endsWith("/summary") && r.request().method() === "POST");
    await resumo.getByTestId("resumo-gerar").click();
    const respostaDoResumo = await gerou;
    expect(respostaDoResumo.status(), await respostaDoResumo.text()).toBe(200);
    await expect(resumo.getByTestId("resumo-texto")).toContainText("Motivo:");
    await expect(resumo.getByTestId("resumo-desatualizado")).toHaveCount(0);
    await capture(page, resumo, info, "3-resumo-em-dia");
    const { rows: resumos } = await pool.query(
      "select gatilho, created_by from conversation_ai_summaries where organization_id=$1 and conversation_id=$2",
      [f.org, f.conversation],
    );
    expect(resumos).toEqual([{ gatilho: "manual", created_by: f.user }]);

    // Mensagem nova: o resumo continua, marcado como desatualizado, com "Atualizar".
    // Recarrega em vez de esperar o Realtime: a entrega em tempo real tem spec
    // própria e fica fora do CI (`inbox-tempo-real.spec.ts` em FORA_DO_CI); aqui
    // o que se mede é o CÁLCULO do desatualizado, não o transporte.
    await inbound(f, "E qual o horário de vocês?");
    await page.reload();
    await expect(resumo.getByTestId("resumo-desatualizado")).toBeVisible({ timeout: 30_000 });
    await expect(resumo.getByTestId("resumo-gerar")).toHaveText(/Atualizar resumo/);
    await capture(page, resumo, info, "4-resumo-desatualizado");

    // ── 5. Outras versões da resposta ────────────────────────────────────────
    const painel = page.locator('section[aria-label="Assistência do agente"]');
    const sugeriu = page.waitForResponse((r) => r.url().endsWith("/draft-reply") && r.request().method() === "POST");
    await painel.getByRole("button", { name: "Sugerir resposta", exact: true }).click();
    const respostaDaSugestao = await sugeriu;
    expect(respostaDaSugestao.status(), await respostaDaSugestao.text()).toBe(200);
    const draftId = (await respostaDaSugestao.json()).data.draft_id as string;

    await expect(painel.getByTestId("opcao-de-resposta-3")).toBeVisible({ timeout: 30_000 });
    await painel.getByTestId("opcao-de-resposta-2").click();
    const escolhida = "Olá! Posso ajudar com as informações do atendimento.";
    await expect(painel.getByLabel("Resposta sugerida")).toHaveValue(escolhida);
    await expect(painel.getByTestId("opcao-de-resposta-2")).toHaveAttribute("aria-pressed", "true");
    await capture(page, painel, info, "5-opcoes-de-resposta");

    const aprovou = page.waitForResponse((r) => r.url().endsWith(`/ai/replies/${draftId}`) && r.request().method() === "POST");
    await painel.getByRole("button", { name: "Aprovar e enviar" }).click();
    expect((await aprovou).status()).toBe(200);
    const { rows: aprovado } = await pool.query(
      "select approved_body, jsonb_array_length(alternatives) n, feedback->>'decision' decisao from ai_reply_drafts where organization_id=$1 and id=$2",
      [f.org, draftId],
    );
    // O que sai é o texto da OPÇÃO ESCOLHIDA, pelo caminho de aprovação de sempre.
    expect(aprovado[0]).toEqual({ approved_body: escolhida, n: 2, decisao: "edited" });
  } finally {
    await pool.end();
  }
});
