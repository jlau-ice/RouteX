import { NextRequest } from "next/server";
import { previewConfig } from "@/lib/core";
import type { AppConfig } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let config: AppConfig;
  try {
    const body = await req.json();
    config = body?.config;
    if (!config) throw new Error("缺少 config");
  } catch {
    return Response.json({ error: "请求体解析失败" }, { status: 400 });
  }

  try {
    const result = await previewConfig(config);
    return Response.json(result);
  } catch (e: any) {
    return Response.json(
      { error: `预览失败：${e?.message ?? e}` },
      { status: 500 },
    );
  }
}
