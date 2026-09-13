-- =============================================================================
-- Migration 0241 — 2 a 3 opções de resposta para o atendente escolher
-- =============================================================================
--
-- O QUÊ
--   `ai_reply_drafts.alternatives jsonb` — até duas variações do rascunho base
--   (uma mais direta, uma mais acolhedora), geradas por
--   `lib/ai/copilot/alternativas-de-resposta.ts` depois que o rascunho base
--   termina.
--
-- DIRC
--   Duplicar, com fonte declarada: a fonte é o `original_body` do MESMO
--   rascunho, e as variações não podem trazer fato que ele não tem (a checagem
--   mora no código). Mora na linha do rascunho — e não em tabela própria —
--   porque nasce, fica obsoleta e morre junto com ele: o mesmo
--   `fn_reply_context_current`, a mesma revisão, o mesmo destino na
--   anonimização. Escolher uma opção NÃO é um caminho novo: vira o `body` da
--   aprovação de sempre (`fn_reply_action`), e o feedback registra "editado".
--
-- LGPD
--   As variações são texto sobre o contato. `fn_reply_redact` (o trigger da
--   anonimização) passa a zerá-las junto com os outros corpos. A função é
--   curta e é recriada inteira aqui — o corpo é o da 0227 com uma coluna a mais.
--
-- Idempotente: `add column if not exists`, constraint conferida no catálogo,
-- `create or replace`. Portável em psql puro.
-- =============================================================================

alter table public.ai_reply_drafts
  add column if not exists alternatives jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'ai_reply_drafts_alternatives_array'
       and conrelid = 'public.ai_reply_drafts'::regclass
  ) then
    alter table public.ai_reply_drafts
      add constraint ai_reply_drafts_alternatives_array
      check (jsonb_typeof(alternatives) = 'array' and jsonb_array_length(alternatives) <= 3);
  end if;
end $$;

create or replace function public.fn_reply_redact() returns trigger language plpgsql security definer set search_path=public as $$
begin
 update public.ai_reply_drafts set original_body=null,edited_body=null,approved_body=null,alternatives='[]',proposals='[]',trace='[]',feedback=null,status=case when status='sent' then status else 'stale' end,error_code='redacted',updated_at=now() where organization_id=new.organization_id and contact_id=new.id;
 update public.job_queue set payload='{}',status=case when status in('pending','running') then 'failed' else status end,locked_by=null,locked_at=null,last_error='reply_redacted' where organization_id=new.organization_id and contact_id=new.id and kind='approved_reply';
 return new;
end;$$;
revoke all on function public.fn_reply_redact() from public,anon,authenticated;
