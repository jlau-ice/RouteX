import type { NodeGroup, SubscriptionSource } from "./types";

export const MAIN_GROUP = "🔰 选择节点";
export const AUTO_GROUP = "♻️ 自动测速";
export const GPT_GROUP = "ChatGPT 专线";
export const CHATGPT_DOMAINS = [
  "chatgpt.com",
  "openai.com",
  "oaistatic.com",
  "oaiusercontent.com",
  "openaimerge.com",
  "oaistatsig.com",
  "featuregates.org",
  "featureassets.org",
  "prodregistryv2.org",
  "chatgpt.livekit.cloud",
];

export function sourceId(source: SubscriptionSource, index: number): string {
  return source.id ?? `source-${index + 1}`;
}

export function sourceGroupNames(sources: SubscriptionSource[]): string[] {
  const used = new Set<string>();
  return sources.map((source, index) => {
    const base = `📦 ${source.label?.trim() || `订阅 ${index + 1}`}`;
    let name = base;
    let suffix = 2;
    while (used.has(name)) name = `${base} (${suffix++})`;
    used.add(name);
    return name;
  });
}

/** 与 iKuuu 原始策略的默认选择一致；在服务端和界面共用。 */
export function defaultCategoryTarget(category: string): string {
  if (/国内|直连|爱奇艺|哔哩哔哩|Steam 登录|学术/.test(category))
    return "DIRECT";
  if (/广告|拦截/.test(category)) return "REJECT";
  return MAIN_GROUP;
}

export function matchGroupNodes(
  group: NodeGroup,
  allNodes: string[],
  sources: { sourceId: string; nodes: string[] }[] = [],
): string[] {
  const pool = group.sourceId
    ? (sources.find((source) => source.sourceId === group.sourceId)?.nodes ??
      [])
    : allNodes;
  let matched: string[] = [];
  if (group.type === "all") matched = pool;
  else if (group.type === "direct") matched = ["DIRECT"];
  else if (group.type === "reject") matched = ["REJECT"];
  else if (group.type === "manual") {
    const available = new Set(pool);
    matched = (group.nodes ?? []).filter((node) => available.has(node));
  } else if (group.pattern) {
    try {
      const pattern = new RegExp(group.pattern, "i");
      matched = pool.filter((node) => pattern.test(node));
    } catch {
      /* 无效正则由配置校验显示。 */
    }
  }
  const unique = [...new Set(matched)];
  return group.preferred && unique.includes(group.preferred)
    ? [group.preferred, ...unique.filter((name) => name !== group.preferred)]
    : unique;
}
