-- Run in the dedicated RouteX database with its owner account.
-- The Node.js backend accesses this table directly; editing still requires
-- the configuration ID and hashed edit key. No Supabase roles or RPCs needed.
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
  edit_secret_hash text not null check (edit_secret_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
