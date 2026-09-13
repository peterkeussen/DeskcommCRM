-- =============================================================================
-- Migration 0240 — resumo da conversa para o atendente + prioridade na fila
-- =============================================================================
--
-- DUAS PEÇAS DO ASSISTENTE DO ATENDENTE (lib/ai/copilot/).
--
-- 1) `conversation_ai_summaries` — o resumo que o humano lê ANTES de assumir.
--
--    DIRC. Não é `checkpoint` (memória INTERNA do agente, escrita para o próximo
--    turno dele, e que só existe quando houve turno de agente); o resumo é para
--    uma pessoa e vale também em conversa que nunca passou pela IA. Não é
--    Calcular on-demand porque cada leitura pagaria uma chamada de modelo e a
--    tela abre a mesma conversa muitas vezes. É Duplicar com fonte declarada: a
--    fonte são as mensagens; `last_message_id` diz ATÉ ONDE o resumo leu, e a
--    tela calcula "desatualizado" comparando com a última mensagem — o status
--    não é coluna.
--
--    Idempotência: `unique (organization_id, conversation_id, last_message_id)`.
--    O gatilho do handoff e o botão podem pedir o mesmo resumo ao mesmo tempo;
--    o segundo INSERT toma 23505 e lê o do primeiro.
--
--    RLS: só SELECT, para `agent+` da organização. Não há policy de escrita —
--    quem grava é o servidor (pool do agent-engine), nunca o browser. Policy
--    ALL só-tenancy está proibida para tabela nova
--    (tests/invariants/rbac-config-ia-canais.test.ts).
--
--    LGPD: o corpo do resumo é conteúdo da conversa de uma pessoa. Anonimizar o
--    contato APAGA os resumos das conversas dele — por TRIGGER na transição
--    `is_anonymized false → true`, e não como passo de
--    `fn_lgpd_cascade_redact_contact`, pela razão escrita nas migrations 0174 e
--    0184: aquela função tem ~180 linhas e um passo novo exigiria carregar uma
--    cópia inteira dela no apêndice do baseline.
--
-- 2) `conversations.ai_priority` — a classe que ordena a fila.
--
--    DIRC. Duplicar com fonte declarada: quem escreve é
--    `workers/ai-sentiment-worker.ts`, a partir da última mensagem recebida
--    (`ai_priority_message_id`). Mora na conversa porque é ORDENAÇÃO de lista
--    paginada: calcular por linha a cada página não indexa.
--
--    `ai_priority_rank` é GERADA (urgente 0, neutro/sem classe 1, positivo 2):
--    o PostgREST ordena por coluna, não por expressão, e sem ela a regra da
--    ordem teria de viver no cliente. NINGUÉM a escreve
--    (tests/invariants/colunas-geradas-nao-sao-escritas.test.ts).
--
--    CHECK em `ai_priority`: vocabulário FECHADO e coluna nova — nenhum clone
--    tem valor legado que o `update.sh` quebraria. O mesmo vocabulário vive em
--    `PRIORIDADES` (lib/ai/copilot/prioridade.ts).
--
-- Idempotente: `if not exists`, `drop ... if exists` antes de policy/trigger,
-- publicação conferida no catálogo. Portável em psql puro.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Resumo para o atendente
-- ---------------------------------------------------------------------------
create table if not exists public.conversation_ai_summaries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  body text not null,
  last_message_id uuid references public.messages(id) on delete set null,
  gatilho text not null,
  model text,
  llm_call_id uuid,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint conversation_ai_summaries_gatilho_check check (gatilho in ('handoff', 'manual')),
  constraint conversation_ai_summaries_body_nao_vazio check (length(btrim(body)) > 0)
);

create unique index if not exists conversation_ai_summaries_um_por_ponto_idx
  on public.conversation_ai_summaries (organization_id, conversation_id, last_message_id);

create index if not exists conversation_ai_summaries_recente_idx
  on public.conversation_ai_summaries (organization_id, conversation_id, created_at desc);

alter table public.conversation_ai_summaries enable row level security;
revoke all on table public.conversation_ai_summaries from anon;

drop policy if exists conversation_ai_summaries_select on public.conversation_ai_summaries;
create policy conversation_ai_summaries_select on public.conversation_ai_summaries
  for select using (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'agent')
  );

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'conversation_ai_summaries'
     ) then
    execute 'alter publication supabase_realtime add table public.conversation_ai_summaries';
  end if;
end $$;

create or replace function public.fn_apagar_resumos_do_contato_anonimizado()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  delete from public.conversation_ai_summaries s
   using public.conversations c
   where c.id = s.conversation_id
     and c.organization_id = new.organization_id
     and s.organization_id = new.organization_id
     and c.contact_id = new.id;
  return new;
end;
$$;

revoke execute on function public.fn_apagar_resumos_do_contato_anonimizado() from public, anon, authenticated;
grant  execute on function public.fn_apagar_resumos_do_contato_anonimizado() to service_role;

drop trigger if exists trg_apagar_resumos_ao_anonimizar on public.contacts;
create trigger trg_apagar_resumos_ao_anonimizar
  after update of is_anonymized on public.contacts
  for each row
  when (new.is_anonymized is true and old.is_anonymized is distinct from true)
  execute function public.fn_apagar_resumos_do_contato_anonimizado();

-- ---------------------------------------------------------------------------
-- 2. Prioridade da conversa na fila
-- ---------------------------------------------------------------------------
alter table public.conversations add column if not exists ai_priority text;
alter table public.conversations add column if not exists ai_priority_at timestamptz;
alter table public.conversations add column if not exists ai_priority_message_id uuid;
alter table public.conversations add column if not exists ai_priority_rank smallint
  generated always as (
    case ai_priority when 'urgente' then 0 when 'positivo' then 2 else 1 end
  ) stored;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'conversations_ai_priority_check'
       and conrelid = 'public.conversations'::regclass
  ) then
    -- Coluna nova: nenhum valor legado. O `not valid` + `validate` é só para não
    -- segurar lock longo numa tabela grande de clone.
    alter table public.conversations
      add constraint conversations_ai_priority_check
      check (ai_priority in ('urgente', 'neutro', 'positivo')) not valid;
    alter table public.conversations validate constraint conversations_ai_priority_check;
  end if;
end $$;

create index if not exists conversations_fila_por_prioridade_idx
  on public.conversations (organization_id, ai_priority_rank, last_inbound_at, id);
