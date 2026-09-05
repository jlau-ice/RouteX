import { generateConfig } from "@/lib/core";
import { validateAppConfig } from "@/lib/config-validation";
import { readConfigBody } from "@/lib/request-body";
import type { AppConfig } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = await readConfigBody(request);
    const issue = validateAppConfig(body.config);
    if (issue) return new Response(issue, { status: 400 });
    return new Response(await generateConfig(body.config as AppConfig), {
      headers: {
        "Content-Type": "text/yaml; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return new Response(
      error instanceof Error ? error.message : "配置生成失败",
      { status: 400 },
    );
  }
}
