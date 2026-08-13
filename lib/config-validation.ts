import type { AppConfig, CustomRule, GroupType } from "./types";

export const MAX_CONFIG_BYTES = 1024 * 1024;

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
        isShortString(item.url, 8192) &&
        (item.label === undefined || isShortString(item.label, 200)),
    )
  ) {
    return "订阅来源格式无效";
  }

  if (!Array.isArray(groups) || groups.length > 100) return "节点组数量无效";
  if (
    !groups.every(
      (item) =>
        isRecord(item) &&
        isShortString(item.id, 128) &&
        isShortString(item.name, 200) &&
        GROUP_TYPES.has(item.type as GroupType) &&
        (item.pattern === undefined || isShortString(item.pattern, 2048)) &&
        (item.nodes === undefined ||
          (Array.isArray(item.nodes) &&
            item.nodes.length <= 10_000 &&
            item.nodes.every((node) => isShortString(node, 500)))),
    )
  ) {
    return "节点组格式无效";
  }

  if (!Array.isArray(ruleMapping) || ruleMapping.length > 1000) {
    return "规则映射数量无效";
  }
  if (
    !ruleMapping.every(
      (item) =>
        isRecord(item) &&
        isShortString(item.category, 500) &&
        isShortString(item.group, 200),
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
        isShortString(item.group, 200),
    )
  ) {
    return "自定义规则格式无效";
  }

  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > MAX_CONFIG_BYTES) {
    return "配置超过 1 MiB";
  }

  return null;
}

export function assertAppConfig(value: unknown): asserts value is AppConfig {
  const error = validateAppConfig(value);
  if (error) throw new Error(error);
}
