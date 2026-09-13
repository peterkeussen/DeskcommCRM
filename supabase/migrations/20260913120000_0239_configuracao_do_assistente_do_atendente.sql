-- =============================================================================
-- Migration 0239 — configuração do assistente do atendente (copiloto de IA)
-- =============================================================================
--
-- O QUÊ
--   `public.fn_ai_copilot_settings(p_org, p_config)`: grava as chaves booleanas
--   do assistente do atendente em `organizations.settings.ai_copilot`, com
--   MERGE (`||`) — um PATCH que liga um recurso não desliga os outros.
--
-- POR QUÊ
--   `organizations` não aceita UPDATE direto de `authenticated`; a escrita de
--   um bloco de `settings` pela tela passa por função `security definer` que
--   confere papel e suporte DENTRO do corpo — o mesmo desenho de
--   `fn_agenda_settings`. O liga/desliga mora no banco para valer sem reiniciar
--   nada (o banco manda sobre o `.env`).
--
--   A função valida a FORMA (objeto de booleanos, chaves curtas em snake_case,
--   no máximo 12) e não a lista de chaves: quem conhece a lista é
--   `copilotSettingsWriteSchema` (lib/schemas/settings.ts), e repetir a lista
--   aqui obrigaria uma migration por recurso novo — duas listas para a mesma
--   pergunta divergem. O teto de chaves impede usar a função como depósito.
--
-- Idempotente (`create or replace`). Portável em psql puro.
-- =============================================================================

create or replace function public.fn_ai_copilot_settings(p_org uuid, p_config jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_resultado jsonb;
begin
  if auth.uid() is null
     or not public.fn_role_at_least(p_org, 'manager')
     or not public.fn_support_write_allowed(p_org) then
    raise exception 'ai_copilot_settings_forbidden' using errcode = '42501';
  end if;

  if jsonb_typeof(p_config) is distinct from 'object'
     or (select count(*) from jsonb_object_keys(p_config)) > 12
     or exists (
       select 1 from jsonb_each(p_config) e
        where e.key !~ '^[a-z][a-z_]{0,39}$'
           or jsonb_typeof(e.value) is distinct from 'boolean'
     ) then
    raise exception 'ai_copilot_settings_invalid' using errcode = '22023';
  end if;

  update public.organizations
     set settings = jsonb_set(
           coalesce(settings, '{}'::jsonb),
           '{ai_copilot}',
           coalesce(settings->'ai_copilot', '{}'::jsonb) || p_config,
           true)
   where id = p_org
  returning settings->'ai_copilot' into v_resultado;

  if not found then
    raise exception 'organization_not_found' using errcode = 'P0002';
  end if;

  return v_resultado;
end;
$$;

revoke all on function public.fn_ai_copilot_settings(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.fn_ai_copilot_settings(uuid, jsonb) to authenticated;
