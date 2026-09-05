import { MAX_CONFIG_BYTES, isRecord } from "./config-validation";

export async function readConfigBody(
  request: Request,
): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new Error("仅支持 JSON 请求");
  if (!request.body) throw new Error("请求内容不能为空");
  const reader = request.body.getReader();
  let size = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_CONFIG_BYTES + 4096) {
      await reader.cancel();
      throw new Error("配置超过 1 MiB");
    }
    chunks.push(value);
  }
  let body: unknown;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("请求体解析失败");
  }
  if (!isRecord(body)) throw new Error("请求体格式无效");
  return body;
}
