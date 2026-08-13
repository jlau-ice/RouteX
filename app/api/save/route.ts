import { NextRequest } from "next/server";
import { randomBytes } from "crypto";
import { supabase, hasSupabase } from "@/lib/supabase";
import type { AppConfig } from "@/lib/types";
import { isRecord, validateAppConfig } from "@/lib/config-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!hasSupabase) {
    return Response.json(
      { error: "未配置 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" },
      { status: 501 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "请求体解析失败" }, { status: 400 });
  }

  if (!isRecord(body)) {
    return Response.json({ error: "请求体格式无效" }, { status: 400 });
  }
  const config = body.config;
  const validationError = validateAppConfig(config);
  if (validationError) {
    return Response.json({ error: validationError }, { status: 400 });
  }
  if (!config) {
    return Response.json({ error: "缺少 config" }, { status: 400 });
  }
  const name =
    typeof body.name === "string" && body.name.trim()
      ? body.name.trim()
      : null;

  // 密链：secret 是读取该配置的凭证，只在响应里返回一次
  const secret = randomBytes(24).toString("base64url");

  // slug 是短 ID，碰撞概率极低；遇到唯一冲突就换一个重试
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = randomBytes(6).toString("base64url");
    const { data, error } = await supabase!
      .from("configs")
      .insert({ slug, name, config: config as AppConfig, secret })
      .select("id, slug")
      .single();

    if (!error && data) {
      return Response.json({
        id: data.id,
        slug: data.slug,
        secret,
        url: `/api/sub?id=${data.id}&k=${secret}`,
        loadUrl: `/api/load?id=${data.id}&k=${secret}`,
      });
    }
    if (error?.code !== "23505") {
      return Response.json(
        { error: `保存失败：${error?.message ?? "未知错误"}` },
        { status: 500 },
      );
    }
  }
  return Response.json({ error: "保存失败（多次 slug 冲突）" }, { status: 500 });
}
