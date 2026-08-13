import { NextRequest } from "next/server";
import { supabase, hasSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!hasSupabase) {
    return Response.json({ error: "未配置 Supabase" }, { status: 501 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "请求体解析失败" }, { status: 400 });
  }

  const { id, k, config, name } = body ?? {};
  if (!id || !k || !config || typeof config !== "object") {
    return Response.json({ error: "缺少 id / k / config" }, { status: 400 });
  }

  const patch: Record<string, any> = { config };
  if (typeof name === "string") patch.name = name.trim() || null;

  const { data, error } = await supabase!
    .from("configs")
    .update(patch)
    .eq("id", id)
    .eq("secret", k)
    .select("id")
    .maybeSingle();

  if (error) {
    return Response.json({ error: `更新失败：${error.message}` }, { status: 500 });
  }
  if (!data) {
    return Response.json({ error: "配置不存在或密钥错误" }, { status: 404 });
  }
  return Response.json({ ok: true });
}
