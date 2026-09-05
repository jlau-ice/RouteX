-- RouteX 云端配置初始化：仅创建专用表及凭证校验 RPC。
-- 不修改其他应用表；匿名请求不能枚举配置或绕过编辑凭证更新。
create or replace function public.touch_updated_at()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- =============================================================
-- 4) iKuuu 基础规则：全站共用一份，只允许管理员直接维护。
--    普通用户保存的是节点映射，不复制这 9816 条规则。
-- =============================================================
create table if not exists public.routex_base_rules (
  id         smallint primary key default 1 check (id = 1),
  rules      jsonb not null check (jsonb_typeof(rules) = 'array'),
  version    bigint not null default 1,
  updated_at timestamptz not null default now()
);

alter table public.routex_base_rules enable row level security;
revoke all on table public.routex_base_rules from anon, authenticated;
grant select on table public.routex_base_rules to anon, authenticated;
grant all on table public.routex_base_rules to service_role;

drop policy if exists "base rules are publicly readable" on public.routex_base_rules;
create policy "base rules are publicly readable"
  on public.routex_base_rules
  for select
  to anon, authenticated
  using (id = 1);

-- 应用只能读取规则，不能通过公开 API 修改规则。
create or replace function public.get_routex_base_rules()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select rules from public.routex_base_rules where id = 1;
$$;

revoke all on function public.get_routex_base_rules() from public;
grant execute on function public.get_routex_base_rules()
  to anon, authenticated, service_role;

-- =============================================================
-- 5) routex_configs 固定订阅链接更新
--    订阅 UUID 只负责读取；更新必须同时提供服务端生成并哈希存储的编辑凭证。
-- =============================================================
create table if not exists public.routex_configs (
  id uuid primary key default gen_random_uuid(),
  config jsonb not null check (
    coalesce(jsonb_typeof(config) = 'object'
    and config ->> 'version' = '1'
    and jsonb_typeof(config -> 'subscriptions') = 'array'
    and jsonb_typeof(config -> 'groups') = 'array'
    and jsonb_typeof(config -> 'ruleMapping') = 'array'
    and jsonb_typeof(config -> 'customRules') = 'array', false)
    and octet_length(config::text) <= 2097152
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.routex_configs enable row level security;
revoke all on table public.routex_configs from anon, authenticated;
grant select, insert on table public.routex_configs to anon, authenticated;
grant all on table public.routex_configs to service_role;

drop policy if exists "routex read by capability" on public.routex_configs;
create policy "routex read by capability" on public.routex_configs
  for select to anon, authenticated
  using (id::text = (select current_setting('request.routex_read_id', true)));

drop policy if exists "routex insert through rpc" on public.routex_configs;
create policy "routex insert through rpc" on public.routex_configs
  for insert to anon, authenticated
  with check (id::text = (select current_setting('request.routex_write_id', true)));

create or replace function public.get_routex_config(p_id uuid)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare v_config jsonb;
begin
  perform set_config('request.routex_read_id', p_id::text, true);
  select config into v_config from public.routex_configs where id = p_id;
  return v_config;
end;
$$;
revoke all on function public.get_routex_config(uuid) from public;
grant execute on function public.get_routex_config(uuid) to anon, authenticated, service_role;

drop trigger if exists routex_configs_touch_updated_at on public.routex_configs;
create trigger routex_configs_touch_updated_at before update on public.routex_configs
  for each row execute function public.touch_updated_at();

alter table public.routex_configs
  add column if not exists edit_secret_hash text;

alter table public.routex_configs
  drop constraint if exists routex_configs_edit_secret_hash_format;
alter table public.routex_configs
  add constraint routex_configs_edit_secret_hash_format
  check (edit_secret_hash is null or edit_secret_hash ~ '^[0-9a-f]{64}$');

create or replace function public.save_routex_config_v2(
  p_config jsonb,
  p_edit_secret_hash text
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
begin
  if jsonb_typeof(p_config) <> 'object'
    or p_config ->> 'version' <> '1'
    or jsonb_typeof(p_config -> 'subscriptions') <> 'array'
    or jsonb_typeof(p_config -> 'groups') <> 'array'
    or jsonb_typeof(p_config -> 'ruleMapping') <> 'array'
    or jsonb_typeof(p_config -> 'customRules') <> 'array'
    or octet_length(p_config::text) > 2097152
    or p_edit_secret_hash is null
    or p_edit_secret_hash !~ '^[0-9a-f]{64}$'
  then
    raise exception using errcode = '22023', message = 'Invalid RouteX configuration';
  end if;

  perform set_config('request.routex_write_id', v_id::text, true);
  insert into public.routex_configs (id, config, edit_secret_hash)
  values (v_id, p_config, p_edit_secret_hash);
  return v_id;
end;
$$;

create or replace function public.update_routex_config(
  p_id uuid,
  p_edit_secret_hash text,
  p_config jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_updated_id uuid;
begin
  if jsonb_typeof(p_config) <> 'object'
    or p_config ->> 'version' <> '1'
    or jsonb_typeof(p_config -> 'subscriptions') <> 'array'
    or jsonb_typeof(p_config -> 'groups') <> 'array'
    or jsonb_typeof(p_config -> 'ruleMapping') <> 'array'
    or jsonb_typeof(p_config -> 'customRules') <> 'array'
    or octet_length(p_config::text) > 2097152
    or p_edit_secret_hash is null
    or p_edit_secret_hash !~ '^[0-9a-f]{64}$'
  then
    return false;
  end if;

  perform set_config('request.routex_update_id', p_id::text, true);
  perform set_config('request.routex_update_secret_hash', p_edit_secret_hash, true);
  perform set_config('request.routex_read_id', p_id::text, true);
  update public.routex_configs
  set config = p_config
  where id = p_id and edit_secret_hash = p_edit_secret_hash
  returning id into v_updated_id;
  return v_updated_id is not null;
end;
$$;

create or replace function public.get_routex_config_for_edit(
  p_id uuid,
  p_edit_secret_hash text
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_config jsonb;
begin
  if p_edit_secret_hash is null or p_edit_secret_hash !~ '^[0-9a-f]{64}$' then
    return null;
  end if;
  perform set_config('request.routex_read_id', p_id::text, true);
  select config into v_config
  from public.routex_configs
  where id = p_id and edit_secret_hash = p_edit_secret_hash;
  return v_config;
end;
$$;

revoke all on function public.save_routex_config_v2(jsonb, text) from public;
revoke all on function public.update_routex_config(uuid, text, jsonb) from public;
revoke all on function public.get_routex_config_for_edit(uuid, text) from public;
grant execute on function public.save_routex_config_v2(jsonb, text)
  to anon, authenticated, service_role;
grant execute on function public.update_routex_config(uuid, text, jsonb)
  to anon, authenticated, service_role;
grant execute on function public.get_routex_config_for_edit(uuid, text)
  to anon, authenticated, service_role;

grant update (config) on table public.routex_configs
  to anon, authenticated, service_role;

drop policy if exists "routex config update through update rpc" on public.routex_configs;
create policy "routex config update through update rpc"
  on public.routex_configs
  for update
  to anon, authenticated
  using (
    id::text = (select current_setting('request.routex_update_id', true))
    and edit_secret_hash = (select current_setting('request.routex_update_secret_hash', true))
  )
  with check (
    id::text = (select current_setting('request.routex_update_id', true))
    and edit_secret_hash = (select current_setting('request.routex_update_secret_hash', true))
    and jsonb_typeof(config) = 'object'
    and config ->> 'version' = '1'
    and jsonb_typeof(config -> 'subscriptions') = 'array'
    and jsonb_typeof(config -> 'groups') = 'array'
    and jsonb_typeof(config -> 'ruleMapping') = 'array'
    and jsonb_typeof(config -> 'customRules') = 'array'
    and octet_length(config::text) <= 2097152
  );
