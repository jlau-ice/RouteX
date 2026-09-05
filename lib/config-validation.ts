import type { AppConfig, CustomRule, GroupType } from "./types";
import safeRegex from "safe-regex2";
import { AUTO_GROUP, sourceGroupNames } from "./policies";

export const MAX_CONFIG_BYTES = 1024 * 1024;

export function isConfigId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

const GROUP_TYPES = new Set<GroupType>([
  "auto",
  "manual",
  "all",
  "direct",
  "reject",
]);
const RULE_TYPES = new Set<CustomRule["type"]>([
  "DOMAIN",
  "DOMAIN-SUFFIX",
  "DOMAIN-KEYWORD",
  "IP-CIDR",
  "RAW",
]);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Restore unfinished drafts too, but never trust malformed persisted structures. */
export function isDraftConfig(value: unknown): value is AppConfig {
  return (
    isRecord(value) &&
    value.version === 1 &&
    Array.isArray(value.subscriptions) &&
    value.subscriptions.every(
      (item) =>
        isRecord(item) &&
        typeof item.url === "string" &&
        (item.label === undefined || typeof item.label === "string"),
    ) &&
    Array.isArray(value.groups) &&
    value.groups.every(
      (item) =>
        isRecord(item) &&
        typeof item.id === "string" &&
        typeof item.name === "string" &&
        GROUP_TYPES.has(item.type as GroupType) &&
        (item.pattern === undefined || typeof item.pattern === "string") &&
        (item.nodes === undefined ||
          (Array.isArray(item.nodes) &&
            item.nodes.every((node) => typeof node === "string"))),
    ) &&
    Array.isArray(value.ruleMapping) &&
    value.ruleMapping.every(
      (item) =>
        isRecord(item) &&
        typeof item.category === "string" &&
        typeof item.group === "string" &&
        (item.targets === undefined ||
          (Array.isArray(item.targets) &&
            item.targets.every((target) => typeof target === "string"))),
    ) &&
    Array.isArray(value.customRules) &&
    value.customRules.every(
      (item) =>
        isRecord(item) &&
        RULE_TYPES.has(item.type as CustomRule["type"]) &&
        typeof item.value === "string" &&
        typeof item.group === "string",
    )
  );
}

function isShortString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length <= maxLength;
}

/** Validate untrusted configuration data before fetching URLs or persisting it. */
export function validateAppConfig(value: unknown): string | null {
  if (!isRecord(value) || value.version !== 1) return "配置版本无效";

  const subscriptions = value.subscriptions;
  const groups = value.groups;
  const ruleMapping = value.ruleMapping;
  const customRules = value.customRules;

  if (!Array.isArray(subscriptions) || subscriptions.length > 20) {
    return "订阅来源数量无效";
  }
  if (
    !subscriptions.every(
      (item) =>
        isRecord(item) &&
        (item.id === undefined ||
          (isShortString(item.id, 128) && /^[\w-]+$/.test(item.id))) &&
        (item.enabled === undefined || typeof item.enabled === "boolean") &&
        isShortString(item.url, 8192) &&
        (item.label === undefined || isShortString(item.label, 200)),
    )
  ) {
    return "订阅来源格式无效";
  }
  const active = subscriptions.filter((source) => source.enabled !== false);
  if (!active.length) return "请至少添加并启用一个订阅";
  for (const source of subscriptions) {
    if (source.label && /[,\r\n\[\]]/.test(source.label))
      return "订阅名称不能包含逗号、换行或方括号";
    if (source.enabled === false && !source.url) continue;
    try {
      const url = new URL(source.url);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password
      )
        return "订阅地址必须是 HTTP / HTTPS 链接";
    } catch {
      return "请填写完整的订阅地址（以 https:// 或 http:// 开头）";
    }
  }
  const ids = subscriptions.map((source) => source.id).filter(Boolean);
  if (new Set(ids).size !== ids.length) return "订阅 ID 不能重复";

  if (!Array.isArray(groups) || groups.length > 100) return "节点组数量无效";
  if (
    !groups.every(
      (item) =>
        isRecord(item) &&
        isShortString(item.id, 128) &&
        isShortString(item.name, 200) &&
        GROUP_TYPES.has(item.type as GroupType) &&
        (item.sourceId === undefined || isShortString(item.sourceId, 128)) &&
        (item.preferred === undefined || isShortString(item.preferred, 800)) &&
        (item.strategy === undefined ||
          ["select", "url-test", "fallback"].includes(
            item.strategy as string,
          )) &&
        (item.pattern === undefined || isShortString(item.pattern, 2048)) &&
        (item.nodes === undefined ||
          (Array.isArray(item.nodes) &&
            item.nodes.length <= 10_000 &&
            item.nodes.every((node) => isShortString(node, 800)))),
    )
  ) {
    return "节点组格式无效";
  }
  const names = groups.map((group) => group.name.trim());
  if (new Set(names).size !== names.length) return "节点组名称不能重复";
  const reserved = new Set([
    "DIRECT",
    "REJECT",
    "PASS",
    "GLOBAL",
    "REJECT-DROP",
    "COMPATIBLE",
    AUTO_GROUP,
    ...sourceGroupNames(subscriptions),
  ]);
  for (const group of groups) {
    if (
      !group.name.trim() ||
      group.name !== group.name.trim() ||
      /[,\r\n]/.test(group.name)
    )
      return "节点组名称不能为空、包含逗号或首尾空格";
    if (reserved.has(group.name)) return `节点组“${group.name}”与内置策略重名`;
    if (group.type === "auto" && group.pattern && !safeRegex(group.pattern))
      return `“${group.name}”的正则无效或过于复杂，请简化筛选条件`;
  }

  if (!Array.isArray(ruleMapping) || ruleMapping.length > 1000) {
    return "规则映射数量无效";
  }
  if (
    !ruleMapping.every(
      (item) =>
        isRecord(item) &&
        isShortString(item.category, 500) &&
        isShortString(item.group, 800) &&
        (item.targets === undefined ||
          (Array.isArray(item.targets) &&
            item.targets.length <= 10_000 &&
            item.targets.every((target) => isShortString(target, 800)))),
    )
  ) {
    return "规则映射格式无效";
  }

  if (!Array.isArray(customRules) || customRules.length > 2000) {
    return "自定义规则数量无效";
  }
  if (
    !customRules.every(
      (item) =>
        isRecord(item) &&
        RULE_TYPES.has(item.type as CustomRule["type"]) &&
        isShortString(item.value, 32768) &&
        isShortString(item.group, 800),
    )
  ) {
    return "自定义规则格式无效";
  }
  for (const rule of customRules) {
    if (!rule.value.trim())
      return "自定义规则内容不能为空，请填写或删除空白规则";
    if (rule.type !== "RAW" && (!rule.group || /[,\r\n]/.test(rule.group)))
      return "请选择有效的规则目标";
    if (rule.type === "RAW") {
      for (const line of rule.value
        .split(/\r?\n/)
        .filter(
          (line: string) => line.trim() && !line.trim().startsWith("#"),
        )) {
        const parts = line.split(",").map((part: string) => part.trim());
        if (
          ![
            "DOMAIN",
            "DOMAIN-SUFFIX",
            "DOMAIN-KEYWORD",
            "IP-CIDR",
            "IP-CIDR6",
            "SRC-IP-CIDR",
            "DST-PORT",
            "SRC-PORT",
            "PROCESS-NAME",
            "PROCESS-PATH",
            "GEOSITE",
            "GEOIP",
            "NETWORK",
            "MATCH",
          ].includes(parts[0])
        )
          return "完整规则包含暂不支持的类型（如外部 RULE-SET），请使用域名或 IP 规则";
        if (
          parts.some((part: string) => !part) ||
          parts.length < (parts[0] === "MATCH" ? 2 : 3)
        )
          return "完整规则格式无效，请填写 类型,内容,目标";
        if (parts[0] === "MATCH")
          return "自定义规则不能包含 MATCH，请在基础规则中修改漏网之鱼的目标";
      }
    } else {
      for (const token of rule.value.split(/[\s,，]+/).filter(Boolean)) {
        if (rule.type === "IP-CIDR") {
          const [ip, prefix, extra] = token.split("/");
          const ipv6 = ip.includes(":");
          let valid = !extra;
          if (ipv6) {
            try {
              new URL(`http://[${ip}]/`);
            } catch {
              valid = false;
            }
          } else
            valid =
              valid &&
              /^\d{1,3}(\.\d{1,3}){3}$/.test(ip) &&
              ip.split(".").every((part: string) => Number(part) <= 255);
          if (
            prefix !== undefined &&
            (!/^\d+$/.test(prefix) || Number(prefix) > (ipv6 ? 128 : 32))
          )
            valid = false;
          if (!valid) return "IP 规则中存在无效的地址或网段";
        } else if (rule.type !== "DOMAIN-KEYWORD") {
          let domain = token.replace(/^\*\.|^\./, "").replace(/\.$/, "");
          if (/^https?:\/\//i.test(domain)) {
            try {
              domain = new URL(domain).hostname;
            } catch {
              return "规则中存在无效的网址";
            }
          }
          if (!domain || /[/:#?@]/.test(domain))
            return "域名规则请填写域名或完整的 HTTP / HTTPS 网址";
        }
      }
    }
  }

  if (
    new TextEncoder().encode(JSON.stringify(value)).byteLength >
    MAX_CONFIG_BYTES
  ) {
    return "配置超过 1 MiB";
  }

  return null;
}

export function assertAppConfig(value: unknown): asserts value is AppConfig {
  const error = validateAppConfig(value);
  if (error) throw new Error(error);
}
