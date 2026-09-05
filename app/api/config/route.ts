import { createHash, randomBytes } from "crypto";
import { MAX_CONFIG_BYTES, validateAppConfig } from "@/lib/config-validation";
import {
  isConfigId,
  loadEditableConfig,
  saveConfig,
  updateConfig,
} from "@/lib/supabase-storage";
import type { AppConfig } from "@/lib/types";
import { readConfigBody } from "@/lib/request-body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function hashEditKey(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  const editKey = request.headers.get("x-routex-edit-key") ?? "";
  if (!isConfigId(id)) {
    return Response.json({ error: "配置 ID 格式无效" }, { status: 400 });
  }
  if (editKey.length < 32 || editKey.length > 256) {
    return Response.json({ error: "缺少有效的编辑凭证" }, { status: 403 });
  }

  try {
    const config = await loadEditableConfig(id, hashEditKey(editKey));
    if (!config) {
      return Response.json(
        { error: "配置不存在或编辑凭证错误" },
        { status: 404 },
      );
    }
    return Response.json(
      { id, config },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Failed to load RouteX config", error);
    return Response.json(
      { error: "配置读取服务暂时不可用，请稍后重试" },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return Response.json({ error: "仅支持 JSON 请求" }, { status: 415 });
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_CONFIG_BYTES + 4096
  ) {
    return Response.json({ error: "配置超过 1 MiB" }, { status: 413 });
  }

  let config: unknown;
  try {
    const body = await readConfigBody(request);
    config = body?.config;
  } catch {
    return Response.json({ error: "请求体解析失败" }, { status: 400 });
  }

  const validationError = validateAppConfig(config);
  if (validationError) {
    return Response.json({ error: validationError }, { status: 400 });
  }

  try {
    const editKey = randomBytes(32).toString("base64url");
    const id = await saveConfig(config as AppConfig, hashEditKey(editKey));
    return Response.json(
      { id, editKey },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Failed to save RouteX config", error);
    return Response.json(
      { error: "配置保存服务暂时不可用，请稍后重试" },
      { status: 503 },
    );
  }
}

export async function PUT(request: Request) {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return Response.json({ error: "仅支持 JSON 请求" }, { status: 415 });
  }

  let body: unknown;
  try {
    body = await readConfigBody(request);
  } catch {
    return Response.json({ error: "请求体解析失败" }, { status: 400 });
  }

  const record = body as Record<string, unknown> | null;
  const id = record?.id;
  const editKey = record?.editKey;
  const config = record?.config;
  if (
    typeof id !== "string" ||
    !isConfigId(id) ||
    typeof editKey !== "string" ||
    editKey.length < 32 ||
    editKey.length > 256
  ) {
    return Response.json({ error: "配置 ID 或编辑凭证无效" }, { status: 400 });
  }
  const validationError = validateAppConfig(config);
  if (validationError) {
    return Response.json({ error: validationError }, { status: 400 });
  }

  try {
    const updated = await updateConfig(
      id,
      hashEditKey(editKey),
      config as AppConfig,
    );
    if (!updated) {
      return Response.json(
        { error: "配置不存在或编辑凭证错误" },
        { status: 404 },
      );
    }
    return Response.json(
      { ok: true, id },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Failed to update RouteX config", error);
    return Response.json(
      { error: "配置更新服务暂时不可用，请稍后重试" },
      { status: 503 },
    );
  }
}
