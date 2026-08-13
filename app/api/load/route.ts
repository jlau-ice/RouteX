import { NextRequest } from "next/server";
import { supabase, hasSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!hasSupabase) {
    return Response.json({ error: "未配置 Supabase" }, { status: 501 });
  }

  const id = req.nextUrl.searchParams.get("id");
  const k = req.nextUrl.searchParams.get("k");
  if (!id || !k) {
    return Response.json({ error: "缺少 id 或 k" }, { status: 400 });
  }

  const { data, error } = await supabase!
    .from("configs")
    .select("id, slug, name, config")
    .eq("id", id)
    .eq("secret", k)
    .maybeSingle();

  if (error) {
    return Response.json({ error: `读取失败：${error.message}` }, { status: 500 });
  }
  if (!data) {
    return Response.json({ error: "配置不存在或密钥错误" }, { status: 404 });
  }
  return Response.json({
    id: data.id,
    slug: data.slug,
    name: data.name,
    config: data.config,
  });
}
