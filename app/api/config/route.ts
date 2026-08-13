import { MAX_CONFIG_BYTES, validateAppConfig } from "@/lib/config-validation";
import { saveConfig } from "@/lib/supabase-storage";
import type { AppConfig } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return Response.json({ error: "仅支持 JSON 请求" }, { status: 415 });
  }

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_CONFIG_BYTES + 4096) {
    return Response.json({ error: "配置超过 1 MiB" }, { status: 413 });
  }

  let config: unknown;
  try {
    const body = await request.json();
    config = body?.config;
  } catch {
    return Response.json({ error: "请求体解析失败" }, { status: 400 });
  }

  const validationError = validateAppConfig(config);
  if (validationError) {
    return Response.json({ error: validationError }, { status: 400 });
  }

  try {
    const id = await saveConfig(config as AppConfig);
    return Response.json(
      { id },
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
