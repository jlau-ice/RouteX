import { Pool } from "pg";
import type { AppConfig } from "./types";
import { assertAppConfig, isConfigId } from "./config-validation";

// Reuse connections across Next.js development reloads. Create them on demand,
// so builds and Supabase deployments never need a local PostgreSQL server.
const shared = globalThis as typeof globalThis & {
  routexPostgres?: { url: string; pool: Pool };
};

function database() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("DATABASE_URL is required for PostgreSQL storage");
  if (shared.routexPostgres?.url !== url) {
    void shared.routexPostgres?.pool.end().catch(() => {});
    const pool = new Pool({
      connectionString: url,
      max: 5,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      statement_timeout: 10_000,
      application_name: "routex",
      allowExitOnIdle: true,
    });
    pool.on("error", () => {
      console.error("RouteX PostgreSQL idle connection failed");
    });
    shared.routexPostgres = { url, pool };
  }
  return shared.routexPostgres.pool;
}

const validHash = (value: string) => /^[0-9a-f]{64}$/.test(value);

export async function saveConfig(config: AppConfig, editSecretHash: string) {
  assertAppConfig(config);
  if (!validHash(editSecretHash)) throw new Error("Invalid edit secret hash");
  const { rows } = await database().query<{ id: string }>(
    `insert into public.routex_configs (config, edit_secret_hash)
     values ($1::jsonb, $2) returning id`,
    [JSON.stringify(config), editSecretHash],
  );
  return rows[0].id;
}

export async function updateConfig(
  id: string,
  editSecretHash: string,
  config: AppConfig,
) {
  if (!isConfigId(id) || !validHash(editSecretHash)) return false;
  assertAppConfig(config);
  const { rowCount } = await database().query(
    `update public.routex_configs set config = $3::jsonb, updated_at = now()
     where id = $1::uuid and edit_secret_hash = $2`,
    [id, editSecretHash, JSON.stringify(config)],
  );
  return rowCount === 1;
}

function readConfig(rows: { config: unknown }[]): AppConfig | null {
  if (!rows.length) return null;
  assertAppConfig(rows[0].config);
  return rows[0].config;
}

export async function loadConfig(id: string): Promise<AppConfig | null> {
  if (!isConfigId(id)) return null;
  const { rows } = await database().query<{ config: unknown }>(
    "select config from public.routex_configs where id = $1::uuid",
    [id],
  );
  return readConfig(rows);
}

export async function loadEditableConfig(id: string, editSecretHash: string) {
  if (!isConfigId(id) || !validHash(editSecretHash)) return null;
  const { rows } = await database().query<{ config: unknown }>(
    `select config from public.routex_configs
     where id = $1::uuid and edit_secret_hash = $2`,
    [id, editSecretHash],
  );
  return readConfig(rows);
}
