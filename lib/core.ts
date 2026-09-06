import { createHash } from "node:crypto";
import { isIP } from "node:net";
import yaml from "yaml";
import type {
  AppConfig,
  CustomRule,
  NodeGroup,
  PreviewResult,
  SubInfo,
} from "./types";
import baseRulesJson from "./base-rules.json";
import { loadBaseRules } from "./storage";
import { assertAppConfig, isRecord } from "./config-validation";
import { fetchSubscriptionText } from "./subscription-fetch";
import {
  AUTO_GROUP,
  MAIN_GROUP,
  defaultCategoryTarget,
  matchGroupNodes,
  sourceGroupNames,
  sourceId,
} from "./policies";
import { LEGACY_POLICY_TARGETS } from "./policy-targets";

const FALLBACK_BASE_RULES: string[] = baseRulesJson;
let baseRulesCache: { expiresAt: number; rules: string[] } | null = null;
export async function getBaseRules(): Promise<string[]> {
  if (baseRulesCache && baseRulesCache.expiresAt > Date.now())
    return baseRulesCache.rules;
  let rules = FALLBACK_BASE_RULES;
  try {
    rules = (await loadBaseRules()) ?? rules;
  } catch {
    /* 内置副本保证存储暂时不可用时仍能生成订阅。 */
  }
  baseRulesCache = { rules, expiresAt: Date.now() + 5 * 60_000 };
  return rules;
}

const BUILTINS = new Set([
  "DIRECT",
  "REJECT",
  "PASS",
  "REJECT-DROP",
  "GLOBAL",
  "COMPATIBLE",
]);
type ClashProxy = Record<string, unknown> & { name: string };
type ClashGroup = {
  name: string;
  type: string;
  proxies: string[];
  url?: string;
  interval?: number;
  "default-selected"?: string;
};
const INFO_NODE =
  /剩余流量|流量剩余|距离下次重置|套餐到期|到期时间|订阅到期|官网地址|国外地址|国内地址|更新订阅|traffic remaining|expire date/i;

/** 只排除明显的订阅提示行；完整保留节点的协议参数。 */
export function collectNodes(configs: Record<string, unknown>[]): ClashProxy[] {
  const signatures = new Set<string>();
  const names = new Set<string>();
  const nodes: ClashProxy[] = [];
  for (const config of configs) {
    if (!Array.isArray(config.proxies)) continue;
    for (const proxy of config.proxies) {
      if (
        !isRecord(proxy) ||
        typeof proxy.name !== "string" ||
        !proxy.name.trim() ||
        INFO_NODE.test(proxy.name)
      )
        continue;
      if (
        typeof proxy.type !== "string" ||
        typeof proxy.server !== "string" ||
        !proxy.server ||
        !Number.isInteger(Number(proxy.port)) ||
        Number(proxy.port) < 1 ||
        Number(proxy.port) > 65535
      )
        continue;
      const signature = JSON.stringify(
        Object.fromEntries(
          Object.entries(proxy).sort(([a], [b]) => a.localeCompare(b)),
        ),
      );
      if (signatures.has(signature)) continue;
      signatures.add(signature);
      let name = proxy.name
        .trim()
        .replace(/[,\r\n]/g, " ")
        .slice(0, 500);
      if (names.has(name))
        name += ` (${createHash("sha256").update(signature).digest("hex").slice(0, 8)})`;
      while (names.has(name)) name += "_";
      names.add(name);
      nodes.push({ ...proxy, name, port: Number(proxy.port) } as ClashProxy);
    }
  }
  return nodes;
}

function usageInfo(value?: string): SubInfo["usage"] {
  if (!value) return undefined;
  const fields = Object.fromEntries(
    value.split(";").map((part) => part.trim().split("=")),
  );
  const used = Number(fields.upload ?? 0) + Number(fields.download ?? 0);
  const total = Number(fields.total);
  const expire = Number(fields.expire);
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0)
    return undefined;
  return {
    used,
    total,
    ...(Number.isFinite(expire) && expire > 0 ? { expire } : {}),
  };
}

async function fetchSources(config: AppConfig) {
  const names = sourceGroupNames(config.subscriptions);
  return Promise.all(
    config.subscriptions.map(async (source, index) => {
      const info: SubInfo = {
        index,
        sourceId: sourceId(source, index),
        label: source.label || `订阅 ${index + 1}`,
        nodeCount: 0,
        status: "disabled",
      };
      const name = names[index];
      const empty = {
        name,
        sourceId: info.sourceId,
        nodes: [] as ClashProxy[],
        info,
      };
      if (source.enabled === false) return empty;
      try {
        const response = await fetchSubscriptionText(source.url);
        let parsed: unknown;
        try {
          parsed = yaml.parse(response.text, { maxAliasCount: 50 });
        } catch {
          throw new Error("内容不是有效的 Clash YAML，请检查订阅格式");
        }
        if (!isRecord(parsed) || !Array.isArray(parsed.proxies))
          throw new Error(
            "需要含 proxies 的 Clash YAML 订阅；暂不支持 Base64 或 proxy-providers 订阅",
          );
        const rawNodes = collectNodes([parsed]);
        if (!rawNodes.length) throw new Error("订阅中没有可用的节点配置");
        // 固定来源命名空间，任一来源失败或停用都不会把同名节点换成其他线路。
        const prefix = `[${name.replace(/^📦 /, "")}] `;
        const renames = new Map(
          rawNodes.map((node) => [node.name, `${prefix}${node.name}`]),
        );
        const nodes = rawNodes.map((node) => {
          const result: ClashProxy = { ...node, name: renames.get(node.name)! };
          if (typeof result["dialer-proxy"] === "string") {
            const reference = result["dialer-proxy"];
            if (renames.has(reference))
              result["dialer-proxy"] = renames.get(reference);
            else if (!BUILTINS.has(reference))
              throw new Error("节点的 dialer-proxy 引用了未导入的策略组");
          }
          return result;
        });
        return {
          name,
          sourceId: info.sourceId,
          nodes,
          info: {
            ...info,
            status: "ok" as const,
            nodeCount: nodes.length,
            excludedCount: parsed.proxies.length - nodes.length,
            usage: usageInfo(response.usage),
          },
        };
      } catch (error) {
        return {
          ...empty,
          info: {
            ...info,
            status: "error" as const,
            error: error instanceof Error ? error.message : "订阅读取失败",
          },
        };
      }
    }),
  );
}

export function ruleCategory(rule: string): {
  category: string | null;
  idx: number;
} {
  const parts = rule.split(",").map((part) => part.trim());
  let idx = parts.length - 1;
  if (parts[idx] === "no-resolve") idx--;
  return idx < 1 || BUILTINS.has(parts[idx])
    ? { category: null, idx: -1 }
    : { category: parts[idx], idx };
}
export function remapRule(
  rule: string,
  mapping: Map<string, string>,
  fallback: string,
): string {
  const { category, idx } = ruleCategory(rule);
  if (!category) return rule;
  const parts = rule.split(",");
  parts[idx] = mapping.get(category) ?? fallback;
  return parts.join(",");
}
export function fixRuleGroup(
  rule: string,
  valid: Set<string>,
  fallback: string,
): string {
  const { category } = ruleCategory(rule);
  return category && !valid.has(category)
    ? remapRule(rule, new Map(), fallback)
    : rule;
}

export function buildCustomRules(rule: CustomRule): string[] {
  if (rule.enabled === false) return [];
  if (!rule.value.trim()) return [];
  if (rule.type === "RAW")
    return rule.value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
  return [...new Set(rule.value.split(/[\s,，]+/).filter(Boolean))].map(
    (value) => {
      if (rule.type === "IP-CIDR") {
        const ipv6 = isIP(value.split("/")[0]) === 6;
        return `${ipv6 ? "IP-CIDR6" : "IP-CIDR"},${value.includes("/") ? value : `${value}/${ipv6 ? 128 : 32}`},${rule.group},no-resolve`;
      }
      let domain = value.trim().toLowerCase();
      if (rule.type !== "DOMAIN-KEYWORD") {
        if (/^https?:\/\//i.test(domain)) domain = new URL(domain).hostname;
        domain = domain.replace(/^\*\.|^\./, "").replace(/\.$/, "");
      }
      return `${rule.type},${domain},${rule.group}`;
    },
  );
}

export function buildGroups(
  defs: NodeGroup[],
  nodeNames: string[],
  sources: PreviewResult["sourceGroups"] = [],
): ClashGroup[] {
  return defs.map((def) => {
    const nodes = matchGroupNodes(def, nodeNames, sources);
    const proxies = nodes.length ? nodes : ["REJECT"];
    const strategy =
      proxies[0] === "REJECT" || def.type === "direct" || def.type === "reject"
        ? "select"
        : (def.strategy ?? "select");
    return {
      name: def.name,
      type: strategy,
      proxies,
      ...(strategy === "select"
        ? { "default-selected": proxies[0] }
        : { url: "https://www.gstatic.com/generate_204", interval: 300 }),
    };
  });
}

async function assemble(config: AppConfig) {
  assertAppConfig(config);
  const [baseRules, fetched] = await Promise.all([
    getBaseRules(),
    fetchSources(config),
  ]);
  const nodes = fetched.flatMap((source) => source.nodes);
  const allNodes = nodes.map((node) => node.name);
  const sourceGroups = fetched.map((source) => ({
    name: source.name,
    sourceId: source.sourceId,
    nodes: source.nodes.map((node) => node.name),
  }));
  const warnings = fetched
    .filter((source) => source.info.error)
    .map((source) => `${source.info.label}：${source.info.error}`);
  const categoryCounts: Record<string, number> = {};
  for (const rule of baseRules) {
    const { category } = ruleCategory(rule);
    if (category)
      categoryCounts[category] = (categoryCounts[category] ?? 0) + 1;
  }
  const categories = Object.keys(categoryCounts);
  const sourceNames = sourceGroups.map((source) => source.name);
  for (const group of config.groups) {
    if (
      [
        ...categories,
        ...sourceNames,
        ...allNodes,
        AUTO_GROUP,
        ...BUILTINS,
      ].includes(group.name)
    )
      throw new Error(`节点组“${group.name}”与已有策略或节点重名，请修改名称`);
  }
  const customGroups = buildGroups(config.groups, allNodes, sourceGroups);
  const helpers: ClashGroup[] = [
    ...sourceGroups.map((source) => ({
      name: source.name,
      type: "select",
      proxies: source.nodes.length ? source.nodes : ["REJECT"],
    })),
    ...customGroups,
    {
      name: AUTO_GROUP,
      type: allNodes.length ? "url-test" : "select",
      proxies: allNodes.length ? allNodes : ["REJECT"],
      url: "https://www.gstatic.com/generate_204",
      interval: 300,
    },
  ];
  const valid = new Set([
    ...allNodes,
    ...categories,
    ...helpers.map((group) => group.name),
    ...BUILTINS,
  ]);
  // 兼容旧配置里没有来源前缀的唯一节点名，存在同名时拒绝猜测。
  const resolveTarget = (target: string): string => {
    if (valid.has(target)) return target;
    if (target === LEGACY_POLICY_TARGETS[0]) return MAIN_GROUP;
    if (target === LEGACY_POLICY_TARGETS[1]) return AUTO_GROUP;
    const matches = allNodes.filter(
      (name) => name.slice(name.indexOf("] ") + 2) === target,
    );
    if (matches.length === 1) return matches[0];
    warnings.push(`目标“${target || "未选择"}”已失效，相关流量将拒绝连接。`);
    return "REJECT";
  };
  // 同时兼容已有的手选节点，不会把不明确的同名节点映射到别的订阅。
  const migratedGroups = config.groups.map((group) => ({
    ...group,
    nodes: group.nodes?.map(resolveTarget),
    preferred: group.preferred ? resolveTarget(group.preferred) : undefined,
  }));
  for (const group of migratedGroups) {
    if (!matchGroupNodes(group, allNodes, sourceGroups).length)
      warnings.push(
        `“${group.name}”未匹配到节点，相关流量将拒绝连接；请选择其他节点或订阅。`,
      );
    else if (
      group.preferred &&
      !matchGroupNodes(
        { ...group, preferred: undefined },
        allNodes,
        sourceGroups,
      ).includes(group.preferred)
    )
      warnings.push(`“${group.name}”的默认节点已失效，将使用组内第一个节点。`);
  }
  helpers.splice(
    sourceGroups.length,
    customGroups.length,
    ...buildGroups(migratedGroups, allNodes, sourceGroups),
  );
  const mappings = new Map(
    config.ruleMapping.map((entry) => [entry.category, entry]),
  );
  const policyGroups: ClashGroup[] = categories.map((category) => {
    const entry = mappings.get(category);
    const requested = entry
      ? (entry.targets ?? (entry.group ? [entry.group] : []))
      : null;
    const targets = requested
      ? [...new Set(requested.map(resolveTarget))]
      : category === MAIN_GROUP
        ? sourceGroups
            .filter((source) => source.nodes.length)
            .map((source) => source.name)
        : [defaultCategoryTarget(category)];
    const proxies = targets.length ? targets : ["REJECT"];
    return {
      name: category,
      type: "select",
      proxies,
      "default-selected": proxies[0],
    };
  });
  if (!categories.includes(MAIN_GROUP))
    policyGroups.push({
      name: MAIN_GROUP,
      type: "select",
      proxies: allNodes.length ? allNodes : ["REJECT"],
    });
  const groups = [...policyGroups, ...helpers];
  const byName = new Map(groups.map((group) => [group.name, group]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(name: string) {
    if (visiting.has(name))
      throw new Error(`策略组“${name}”存在循环引用，请调整规则目标`);
    if (visited.has(name) || !byName.has(name)) return;
    visiting.add(name);
    byName.get(name)!.proxies.forEach(visit);
    visiting.delete(name);
    visited.add(name);
  }
  groups.forEach((group) => visit(group.name));
  const custom = config.customRules.flatMap(buildCustomRules).map((rule) => {
    const { category, idx } = ruleCategory(rule);
    if (!category) return rule;
    const parts = rule.split(",");
    parts[idx] = resolveTarget(category);
    return parts.join(",");
  });
  const rules = [...new Set(custom), ...baseRules];
  if (!rules.some((rule) => rule.startsWith("MATCH,")))
    rules.push(`MATCH,${MAIN_GROUP}`);
  const preview: PreviewResult = {
    allNodes,
    sourceGroups,
    categories,
    categoryCounts,
    baseRuleCount: baseRules.length,
    subscriptions: fetched.map((source) => source.info),
    groups: migratedGroups.map((group) => ({
      name: group.name,
      nodes: matchGroupNodes(group, allNodes, sourceGroups),
    })),
    warnings: [...new Set(warnings)],
  };
  return { nodes, groups, rules, preview };
}

export async function previewConfig(config: AppConfig): Promise<PreviewResult> {
  return (await assemble(config)).preview;
}

export async function generateConfig(config: AppConfig): Promise<string> {
  const { nodes, groups, rules } = await assemble(config);
  if (!nodes.length)
    throw new Error("所有启用的订阅均未获得可用节点，请先检查订阅来源");
  return yaml.stringify(
    {
      "mixed-port": 7890,
      "allow-lan": false,
      mode: "rule",
      "log-level": "info",
      ipv6: false,
      // 更新配置时采用网页设定的默认节点；运行期间仍可在 Clash 手动切换。
      profile: { "store-selected": false },
      dns: {
        enable: true,
        ipv6: false,
        "enhanced-mode": "fake-ip",
        "fake-ip-range": "198.18.0.1/16",
        nameserver: ["223.5.5.5", "119.29.29.29"],
        fallback: ["8.8.8.8", "1.1.1.1"],
      },
      proxies: nodes,
      "proxy-groups": groups,
      rules,
    },
    { lineWidth: 0 },
  );
}
