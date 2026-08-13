import { NextRequest } from "next/server";
import { inflateSync } from "zlib";
import { generateConfig } from "@/lib/core";
import { supabase, hasSupabase } from "@/lib/supabase";
import { assertAppConfig, MAX_CONFIG_BYTES } from "@/lib/config-validation";
import { isConfigId, loadConfig } from "@/lib/supabase-storage";
import type { AppConfig } from "@/lib/types";
import { getErrorMessage } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function decodeConfig(c: string): AppConfig {
  if (c.length > MAX_CONFIG_BYTES * 2) throw new Error("配置参数过长");
  const buf = Buffer.from(c, "base64url");
  // 优先按 deflate 解压；失败则按普通 base64 JSON 兜底
  try {
    return JSON.parse(
      inflateSync(buf, { maxOutputLength: MAX_CONFIG_BYTES }).toString("utf-8"),
    ) as AppConfig;
  } catch {
    return JSON.parse(buf.toString("utf-8")) as AppConfig;
  }
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const k = req.nextUrl.searchParams.get("k");
  const c = req.nextUrl.searchParams.get("c");

  let config: AppConfig;
  if (id && k) {
    // 短链模式：从 Supabase 读配置（密链校验）
    if (!hasSupabase) {
      return new Response("未配置 Supabase", {
        status: 501,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    const { data } = await supabase!
      .from("configs")
      .select("config")
      .eq("id", id)
      .eq("secret", k)
      .maybeSingle();
    if (!data) {
      return new Response("配置不存在或密钥错误", {
        status: 404,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    config = data.config as AppConfig;
  } else if (id) {
    if (!isConfigId(id)) {
      return new Response("配置 ID 格式无效", { status: 400 });
    }
    try {
      const stored = await loadConfig(id);
      if (!stored) return new Response("配置不存在", { status: 404 });
      config = stored;
    } catch (error) {
      console.error("Failed to load RouteX config", error);
      return new Response("配置存储服务暂时不可用", { status: 503 });
    }
  } else {
    if (!c) {
      return new Response("缺少 ?c=、?id= 或 ?id=&k= 参数", { status: 400 });
    }
    try {
      config = decodeConfig(c);
      assertAppConfig(config);
    } catch {
      return new Response("配置解码失败，链接可能已损坏", {
        status: 400,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
  }

  try {
    const text = await generateConfig(config);
    return new Response(text, {
      headers: {
        "Content-Type": "text/yaml; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (error: unknown) {
    return new Response(`生成失败：${getErrorMessage(error)}`, {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
