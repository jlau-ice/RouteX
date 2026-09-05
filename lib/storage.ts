import type { AppConfig, StorageMode } from "./types";
import * as postgres from "./postgres-storage";
import * as supabase from "./supabase-storage";

export { isConfigId } from "./config-validation";

export function getStorageMode(): StorageMode {
  return process.env.DATABASE_URL?.trim() ? "postgres" : "supabase";
}

function storage() {
  return getStorageMode() === "postgres" ? postgres : supabase;
}

export function saveConfig(config: AppConfig, editSecretHash: string) {
  return storage().saveConfig(config, editSecretHash);
}

export function updateConfig(id: string, editSecretHash: string, config: AppConfig) {
  return storage().updateConfig(id, editSecretHash, config);
}

export function loadConfig(id: string) {
  return storage().loadConfig(id);
}

export function loadEditableConfig(id: string, editSecretHash: string) {
  return storage().loadEditableConfig(id, editSecretHash);
}

export function loadBaseRules(): Promise<string[] | null> {
  // Local storage uses the bundled iKuuu rules without contacting Supabase.
  return getStorageMode() === "postgres"
    ? Promise.resolve(null)
    : supabase.loadBaseRules();
}
