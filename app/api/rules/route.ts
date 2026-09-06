import { getBaseRules } from "@/lib/core";
import { parseBaseRule } from "@/lib/routing-editor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const query = (params.get("q") ?? "").trim().toLowerCase().slice(0, 200);
  const pageSize = 30;
  const requested = Number(params.get("page") ?? "1");
  const all = (await getBaseRules()).filter((raw) =>
    raw.toLowerCase().includes(query),
  );
  const pages = Math.max(1, Math.ceil(all.length / pageSize));
  const page = Math.min(
    pages,
    Math.max(1, Number.isFinite(requested) ? Math.floor(requested) : 1),
  );
  return Response.json(
    {
      rules: all
        .slice((page - 1) * pageSize, page * pageSize)
        .map(parseBaseRule),
      total: all.length,
      page,
      pages,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
