import { NextRequest } from "next/server";
import { supabase, hasSupabase } from "@/lib/supabase";
import { isRecord } from "@/lib/config-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!hasSupabase) {
    return Response.json({ error: "未配置 Supabase" }, { status: 501 });
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
  const { id, k } = body;
  if (typeof id !== "string" || typeof k !== "string") {
    return Response.json({ error: "缺少 id / k" }, { status: 400 });
  }

  const { data, error } = await supabase!
    .from("configs")
    .delete()
    .eq("id", id)
    .eq("secret", k)
    .select("id")
    .maybeSingle();

  if (error) {
    return Response.json({ error: `删除失败：${error.message}` }, { status: 500 });
  }
  if (!data) {
    return Response.json({ error: "配置不存在或密钥错误" }, { status: 404 });
  }
  return Response.json({ ok: true });
}
