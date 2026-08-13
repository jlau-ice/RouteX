// 服务端 Supabase 客户端。只允许被 app/api/** 引用。
// 未配置环境变量时返回 null，相关接口会返回 501（保留纯 URL 模式兜底）。
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const supabase: SupabaseClient | null =
  url && key
    ? createClient(url, key, { auth: { persistSession: false } })
    : null;

export const hasSupabase = supabase !== null;
