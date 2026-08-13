import type { AppConfig } from "./types";
import { assertAppConfig } from "./config-validation";

// Publishable keys are designed for public clients. Environment variables can
// override these defaults without requiring a code change when the key rotates.
const SUPABASE_URL =
  process.env.SUPABASE_URL ?? "https://jpnzhharrtrgfpixqfvn.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ??
  "sb_publishable_diS8MYDx-L_Cs_pa7b4peQ__fP4FBsh";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isConfigId(value: string): boolean {
  return UUID_PATTERN.test(value);
}

async function callRpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Supabase RPC ${name} failed with HTTP ${response.status}`);
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function saveConfig(config: AppConfig): Promise<string> {
  assertAppConfig(config);
  const id = await callRpc<unknown>("save_routex_config", { p_config: config });
  if (typeof id !== "string" || !isConfigId(id)) {
    throw new Error("Supabase returned an invalid configuration ID");
  }
  return id;
}

export async function loadConfig(id: string): Promise<AppConfig | null> {
  if (!isConfigId(id)) return null;
  const config = await callRpc<unknown>("get_routex_config", { p_id: id });
  if (config === null) return null;
  assertAppConfig(config);
  return config;
}

/** 读取管理员统一维护的 iKuuu 基础规则。 */
export async function loadBaseRules(): Promise<string[] | null> {
  const value = await callRpc<unknown>("get_routex_base_rules", {});
  if (!Array.isArray(value)) return null;

  const rules = value.filter(
    (rule): rule is string => typeof rule === "string" && rule.trim().length > 0,
  );
  return rules.length > 0 ? rules : null;
}
