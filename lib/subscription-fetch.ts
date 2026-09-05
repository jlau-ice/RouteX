import http from "node:http";
import https from "node:https";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["192.0.0.0", 24],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  blocked.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["::", 96],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["64:ff9b::", 96],
] as const)
  blocked.addSubnet(address, prefix, "ipv6");

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  return (
    family !== 0 && !blocked.check(address, family === 4 ? "ipv4" : "ipv6")
  );
}

const MAX_SUBSCRIPTION_BYTES = 5 * 1024 * 1024;

/** Validate every redirect and pin the request to its checked DNS addresses. */
export async function fetchSubscriptionText(input: string) {
  const signal = AbortSignal.timeout(15_000);
  let current = new URL(input);
  for (let redirects = 0; redirects <= 4; redirects++) {
    if (
      !["https:", "http:"].includes(current.protocol) ||
      current.username ||
      current.password
    ) {
      throw new Error("仅支持不含登录信息的 HTTP / HTTPS 订阅地址");
    }
    const hostname = current.hostname.replace(/^\[|\]$/g, "");
    let addresses = isIP(hostname)
      ? [{ address: hostname, family: isIP(hostname) }]
      : await Promise.race([
          lookup(hostname, { all: true }),
          new Promise<never>((_, reject) => {
            signal.addEventListener(
              "abort",
              () => reject(new Error("订阅请求超时")),
              { once: true },
            );
          }),
        ]);
    signal.throwIfAborted();
    // Clash TUN 的 fake-ip DNS 会返回 198.18/15；用加密 DNS 重新解析，
    // 仍然校验并固定真实公网 IP，不对私网地址放行。
    if (
      !isIP(hostname) &&
      addresses.length &&
      addresses.every((item) => /^198\.(18|19)\./.test(item.address))
    ) {
      const response = await fetch(
        `https://1.1.1.1/dns-query?name=${encodeURIComponent(hostname)}&type=A`,
        {
          headers: { Accept: "application/dns-json" },
          signal,
          cache: "no-store",
        },
      );
      if (!response.ok) throw new Error("无法解析订阅的公网地址");
      const result = (await response.json()) as {
        Answer?: { type: number; data: string }[];
      };
      addresses = (result.Answer ?? [])
        .filter((answer) => answer.type === 1 && isIP(answer.data) === 4)
        .map((answer) => ({ address: answer.data, family: 4 }));
    }
    if (
      !addresses.length ||
      addresses.some((item) => !isPublicAddress(item.address))
    ) {
      throw new Error("订阅地址必须指向公网服务器");
    }
    const result = await new Promise<{
      text: string;
      location?: string;
      usage?: string;
    }>((resolve, reject) => {
      const request = (current.protocol === "https:" ? https : http).get(
        current,
        {
          signal,
          agent: false,
          headers: {
            "User-Agent": "clash-verge/v2.0",
            "Accept-Encoding": "identity",
          },
          lookup: (_host, options, callback) => {
            if (options.all) callback(null, addresses);
            else callback(null, addresses[0].address, addresses[0].family);
          },
        },
        (response) => {
          const status = response.statusCode ?? 0;
          if (
            [301, 302, 303, 307, 308].includes(status) &&
            response.headers.location
          ) {
            response.destroy();
            resolve({ text: "", location: response.headers.location });
            return;
          }
          if (status < 200 || status >= 300) {
            response.destroy();
            reject(new Error(`订阅服务器返回 HTTP ${status}`));
            return;
          }
          const chunks: Buffer[] = [];
          let bytes = 0;
          response.on("data", (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > MAX_SUBSCRIPTION_BYTES) {
              response.destroy(new Error("订阅内容超过 5 MiB"));
            } else chunks.push(chunk);
          });
          response.on("error", reject);
          response.on("end", () =>
            resolve({
              text: Buffer.concat(chunks).toString("utf8"),
              usage:
                typeof response.headers["subscription-userinfo"] === "string"
                  ? response.headers["subscription-userinfo"]
                  : undefined,
            }),
          );
        },
      );
      request.on("error", (error) =>
        reject(
          new Error(
            signal.aborted
              ? "订阅请求超时（15 秒）"
              : `订阅连接失败（${(error as NodeJS.ErrnoException).code ?? "NETWORK"}）`,
          ),
        ),
      );
    });
    if (!result.location) return result;
    current = new URL(result.location, current);
  }
  throw new Error("订阅重定向次数过多");
}
