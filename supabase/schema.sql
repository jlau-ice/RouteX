-- =============================================================
-- RouteX → Supabase 迁移脚本
-- 在 Supabase Dashboard → SQL Editor 里粘贴执行即可。
-- =============================================================

create extension if not exists pgcrypto;

-- -------------------------------------------------------------
-- 1) 配置表
--    每个配置对应一个"密链"：拥有 id + secret 才能读取。
--    订阅地址带 token，务必使用这种密链模型，绝不能公开可读。
-- -------------------------------------------------------------
create table if not exists public.configs (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique,          -- 短 ID，用于分享链接
  name       text,                          -- 配置名（可选）
  config     jsonb not null,                -- AppConfig 对象
  secret     text not null,                 -- 访问密钥（服务端生成的长随机串）
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists configs_slug_idx on public.configs (slug);

-- -------------------------------------------------------------
-- 2) 自动更新 updated_at
-- -------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists configs_touch_updated_at on public.configs;
create trigger configs_touch_updated_at
  before update on public.configs
  for each row execute function public.touch_updated_at();

-- -------------------------------------------------------------
-- 3) RLS：默认禁止匿名角色任何操作。
--    （真正读写走 Vercel 服务端的 service_role key，会绕过 RLS，
--      这里只是防止有人用公开的 anon key 直接查表。）
-- -------------------------------------------------------------
alter table public.configs enable row level security;

drop policy if exists "deny anon select" on public.configs;
drop policy if exists "deny anon insert" on public.configs;
drop policy if exists "deny anon update" on public.configs;
drop policy if exists "deny anon delete" on public.configs;

create policy "deny anon select" on public.configs for select using (false);
create policy "deny anon insert" on public.configs for insert with check (false);
create policy "deny anon update" on public.configs for update using (false);
create policy "deny anon delete" on public.configs for delete using (false);

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
    or octet_length(p_config::text) > 131072
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
    or octet_length(p_config::text) > 131072
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
    and octet_length(config::text) <= 131072
  );
