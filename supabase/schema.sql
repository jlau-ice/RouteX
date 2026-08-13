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
-- （可选）4) 内置基础规则入库：单行表，规则更新无需重新部署
-- =============================================================
-- create table if not exists public.base_rules (
--   id         int primary key default 1 check (id = 1),
--   rules      jsonb not null,
--   updated_at timestamptz not null default now()
-- );
-- insert into public.base_rules (id, rules) values (1, '[]')
--   on conflict (id) do nothing;
