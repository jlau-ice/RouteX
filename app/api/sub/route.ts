import { NextRequest } from "next/server";
import { inflateSync } from "zlib";
import { generateConfig } from "@/lib/core";
import type { AppConfig } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function decodeConfig(c: string): AppConfig {
  const buf = Buffer.from(c, "base64url");
  // 优先按 deflate 解压；失败则按普通 base64 JSON 兜底
  try {
    return JSON.parse(inflateSync(buf).toString("utf-8")) as AppConfig;
  } catch {
    return JSON.parse(buf.toString("utf-8")) as AppConfig;
  }
}

export async function GET(req: NextRequest) {
  const c = req.nextUrl.searchParams.get("c");
  if (!c) {
    return new Response("缺少 ?c= 参数", { status: 400 });
  }
  let config: AppConfig;
  try {
    config = decodeConfig(c);
  } catch {
    return new Response("配置解码失败，链接可能已损坏", {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  try {
    const text = await generateConfig(config);
    return new Response(text, {
      headers: {
        "Content-Type": "text/yaml; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return new Response(`生成失败：${e?.message ?? e}`, {
      status: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
