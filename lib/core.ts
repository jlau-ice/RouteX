import yaml from "yaml";
import type { AppConfig, CustomRule, NodeGroup, PreviewResult } from "./types";
import baseRulesJson from "./base-rules.json";
import { getErrorMessage } from "./errors";
import { loadBaseRules } from "./supabase-storage";
import {
  ALWAYS_AVAILABLE_TARGETS,
  AUTO_GROUP,
  MAIN_GROUP,
} from "./policy-targets";

// 内置基础规则（来自 iKuuu，随项目一起打包，不依赖任何订阅）
const FALLBACK_BASE_RULES: string[] = (Array.isArray(baseRulesJson) ? baseRulesJson : [])
  .filter((r): r is string => typeof r === "string")
  .filter((r) => r.trim().length > 0);

const BASE_RULES_CACHE_MS = 5 * 60 * 1000;
let baseRulesCache: { expiresAt: number; rules: string[] } | null = null;

/**
 * 基础规则由 Supabase 单行表统一维护；数据库暂时不可用时回退到随项目
 * 发布的副本，避免订阅生成服务因为外部存储故障完全不可用。
 */
async function getBaseRules(): Promise<string[]> {
  if (baseRulesCache && baseRulesCache.expiresAt > Date.now()) {
    return baseRulesCache.rules;
  }

  try {
    const stored = await loadBaseRules();
    if (stored) {
      baseRulesCache = {
        expiresAt: Date.now() + BASE_RULES_CACHE_MS,
        rules: stored,
      };
      return stored;
    }
  } catch (error) {
    console.error("Failed to load RouteX base rules from Supabase", error);
  }

  return FALLBACK_BASE_RULES;
}

// 规则里不会被当成“规则类别”的内建目标
const BUILTIN_TARGETS = new Set(["DIRECT", "REJECT", "PASS", "REJECT-DROP", "GLOBAL"]);

type ClashConfig = Record<string, unknown>;
type ClashProxy = Record<string, unknown> & { name: string };
type FetchedSubscription = {
  config: ClashConfig | null;
  error: string | null;
  index: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function fetchSubscription(url: string): Promise<ClashConfig> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "clash-verge/v2.0" },
      redirect: "follow",
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const parsed: unknown = yaml.parse(text);
    if (!isRecord(parsed)) throw new Error("内容不是 YAML");
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchAllSubscriptions(
  config: AppConfig,
): Promise<FetchedSubscription[]> {
  return Promise.all(
    config.subscriptions.map(async (s, index) => {
      try {
        const c = await fetchSubscription(s.url);
        return { config: c, error: null, index };
      } catch (error: unknown) {
        return { config: null, error: getErrorMessage(error), index };
      }
    }),
  );
}

/** 合并所有订阅的节点，按名字去重 */
export function collectNodes(configs: ClashConfig[]): ClashProxy[] {
  const seen = new Set<string>();
  const nodes: ClashProxy[] = [];
  for (const cfg of configs) {
    if (!Array.isArray(cfg.proxies)) continue;
    for (const proxy of cfg.proxies as unknown[]) {
      if (isRecord(proxy) && typeof proxy.name === "string" && proxy.name) {
        if (!seen.has(proxy.name)) {
          seen.add(proxy.name);
          nodes.push(proxy as ClashProxy);
        }
      }
    }
  }
  return nodes;
}

/** 按配置构建 select 策略组（auto 组用正则过滤节点名） */
export function buildGroups(
  defs: NodeGroup[],
  nodeNames: string[],
): { name: string; type: string; proxies: string[] }[] {
  const out: { name: string; type: string; proxies: string[] }[] = [];
  for (const def of defs) {
    let proxies: string[] = [];
    if (def.type === "auto" && def.pattern) {
      try {
        const re = new RegExp(def.pattern, "i");
        proxies = nodeNames.filter((n) => re.test(n));
      } catch {
        proxies = [];
      }
    } else if (def.type === "manual") {
      const existing = new Set(nodeNames);
      proxies = (def.nodes ?? []).filter((n) => existing.has(n));
    } else if (def.type === "all") {
      proxies = [...nodeNames];
    } else if (def.type === "direct") {
      proxies = ["DIRECT"];
    } else if (def.type === "reject") {
      proxies = ["REJECT"];
    }
    if (proxies.length > 0) out.push({ name: def.name, type: "select", proxies });
  }
  return out;
}

/** 每个导入订阅自动形成一个可选节点组。 */
function buildSourceGroups(
  config: AppConfig,
  fetched: Pick<FetchedSubscription, "config" | "index">[],
  reservedNames: Iterable<string>,
): { name: string; type: string; proxies: string[] }[] {
  const used = new Set(reservedNames);
  const groups: { name: string; type: string; proxies: string[] }[] = [];

  for (const item of fetched) {
    if (!item.config) continue;
    const proxies = collectNodes([item.config]).map((node) => node.name);
    if (proxies.length === 0) continue;

    const label = config.subscriptions[item.index]?.label?.trim();
    const baseName = `📦 ${label || `订阅 ${item.index + 1}`}`;
    let name = baseName;
    let suffix = 2;
    while (used.has(name)) {
      name = `${baseName} (${suffix})`;
      suffix += 1;
    }
    used.add(name);
    groups.push({ name, type: "select", proxies });
  }

  return groups;
}

/**
 * 取出规则的目标“策略组”（即规则类别）。
 * 返回 category 与它在规则里的下标；没有可重写目标时返回 null。
 */
export function ruleCategory(
  rule: string,
): { category: string | null; idx: number } {
  if (typeof rule !== "string") return { category: null, idx: -1 };
  const parts = rule.split(",");
  if (parts.length < 2) return { category: null, idx: -1 };
  let idx = parts.length - 1;
  // IP-CIDR,xx,group,no-resolve 这种情况，去掉末尾的 no-resolve
  if (parts[idx] === "no-resolve" && parts.length >= 3) idx -= 1;
  const target = parts[idx];
  if (BUILTIN_TARGETS.has(target) || target === "no-resolve") {
    return { category: null, idx: -1 };
  }
  return { category: target, idx };
}

/** 把规则里的目标策略组替换为映射后的节点组 */
export function remapRule(
  rule: string,
  mapping: Map<string, string>,
  fallback: string,
): string {
  const { category, idx } = ruleCategory(rule);
  if (category === null || idx < 1) return rule;
  const parts = rule.split(",");
  parts[idx] = mapping.get(category) ?? fallback;
  return parts.join(",");
}

/** iKuuu 基础规则中出现的策略组，保持原始顺序。 */
function baseRuleCategories(rules: string[]): string[] {
  return Array.from(
    new Set(
      rules
        .map((rule) => ruleCategory(rule).category)
        .filter((category): category is string => category !== null),
    ),
  );
}

/** 若规则的目标组不存在，回退到 fallback */
export function fixRuleGroup(
  rule: string,
  valid: Set<string>,
  fallback: string,
): string {
  const { category, idx } = ruleCategory(rule);
  if (category === null || idx < 1) return rule;
  if (valid.has(category)) return rule;
  const parts = rule.split(",");
  parts[idx] = fallback;
  return parts.join(",");
}

/** 把一批 Host / IP 输入展开成完整规则行。 */
export function buildCustomRules(r: CustomRule): string[] {
  if (!r || !r.value) return [];
  if (r.type === "RAW") {
    return r.value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }
  if (!r.group) return [];

  const values = r.value
    .split(/[\s,，]+/)
    .map((value) => value.trim())
    .filter(Boolean);

  return values
    .map((value) => {
      switch (r.type) {
        case "DOMAIN":
          return `DOMAIN,${value},${r.group}`;
        case "DOMAIN-SUFFIX":
          return `DOMAIN-SUFFIX,${value},${r.group}`;
        case "DOMAIN-KEYWORD":
          return `DOMAIN-KEYWORD,${value},${r.group}`;
        case "IP-CIDR": {
          const cidr = value.includes("/") ? value : `${value}/32`;
          return `IP-CIDR,${cidr},${r.group},no-resolve`;
        }
        default:
          return "";
      }
    })
    .filter(Boolean);
}

/** 输出配置的固定顶层设置（端口/DNS 等） */
const DEFAULT_SETTINGS: Record<string, unknown> = {
  port: 7890,
  "socks-port": 7891,
  "allow-lan": false,
  mode: "rule",
  "log-level": "info",
  ipv6: false,
  "external-controller": "127.0.0.1:9090",
  dns: {
    enable: true,
    ipv6: false,
    "enhanced-mode": "fake-ip",
    "fake-ip-range": "198.18.0.1/16",
    nameserver: ["223.5.5.5", "119.29.29.29"],
    fallback: ["8.8.8.8", "1.1.1.1"],
  },
};

const TEST_URL = "http://www.gstatic.com/generate_204";

/** 生成最终的 Clash YAML 配置文本 */
export async function generateConfig(config: AppConfig): Promise<string> {
  const fetched = await fetchAllSubscriptions(config);
  const nodeConfigs = fetched
    .map((f) => f.config)
    .filter((item): item is ClashConfig => item !== null);
  if (nodeConfigs.length === 0) {
    throw new Error("所有订阅都拉取失败，无法生成");
  }

  const nodes = collectNodes(nodeConfigs);
  const nodeNames = nodes.map((n) => n.name);
  if (nodes.length === 0) {
    throw new Error("没有从订阅中解析到任何节点");
  }

  const baseRules = await getBaseRules();

  // iKuuu 的规则类别同时也是最终需要展示在 Clash 里的策略组。
  const categories = baseRuleCategories(baseRules);
  const categoryNames = new Set(categories);

  // 用户节点组不能覆盖 iKuuu 原策略组；同名时保留原策略组。
  const groups = buildGroups(config.groups, nodeNames).filter(
    (group) => !categoryNames.has(group.name),
  );
  const groupNames = new Set(groups.map((g) => g.name));
  const builtinGroups = [
    {
      name: MAIN_GROUP,
      type: "select",
      proxies: [...nodeNames, "DIRECT"],
    },
    {
      name: AUTO_GROUP,
      type: "url-test",
      url: TEST_URL,
      interval: 300,
      tolerance: 50,
      proxies: [...nodeNames],
    },
  ].filter((g) => !groupNames.has(g.name));
  const sourceGroups = buildSourceGroups(
    config,
    fetched,
    [...groupNames, ...categoryNames, MAIN_GROUP, AUTO_GROUP],
  );
  const selectableGroups = [...builtinGroups, ...sourceGroups, ...groups];
  const validTargets = new Set([
    ...selectableGroups.map((g) => g.name),
    ...nodeNames,
    ...ALWAYS_AVAILABLE_TARGETS,
  ]);
  const fallbackGroup = validTargets.has(MAIN_GROUP)
    ? MAIN_GROUP
    : (selectableGroups[0]?.name ?? MAIN_GROUP);

  // iKuuu 原规则类别 → 规则目标。
  // 目标既可以是策略组，也可以是导入的单个节点或 Clash 内置的 DIRECT/REJECT。
  const mapping = new Map<string, string[]>();
  for (const m of config.ruleMapping) {
    const requested = m.targets?.length ? m.targets : [m.group];
    const targets = Array.from(new Set(requested)).filter((target) =>
      validTargets.has(target),
    );
    if (targets.length > 0) mapping.set(m.category, targets);
  }

  // 保留 iKuuu 原策略组名称。网页中的映射只决定每个策略组内部
  // 指向哪个单节点/节点组/DIRECT/REJECT，而不改写规则本身的目标名称。
  const categoryGroups = categories.map((category) => ({
    name: category,
    type: "select",
    proxies: mapping.get(category) ?? [fallbackGroup],
  }));
  const allGroups = [...categoryGroups, ...selectableGroups];

  // 自定义规则（最高优先级）
  const custom = config.customRules
    .flatMap(buildCustomRules)
    .filter(Boolean)
    .map((r) => fixRuleGroup(r, validTargets, fallbackGroup));

  // 最终规则：自定义在前，iKuuu 基础规则保持原样在后。
  // 原规则中的 MATCH 继续指向“漏网之鱼”；仅在规则集缺少 MATCH 时补兜底。
  const finalRules = [...custom, ...baseRules];
  if (!baseRules.some((rule) => rule.startsWith("MATCH,"))) {
    finalRules.push(`MATCH,${fallbackGroup}`);
  }

  const output = {
    ...DEFAULT_SETTINGS,
    proxies: nodes,
    "proxy-groups": allGroups,
    rules: finalRules,
  };

  return yaml.stringify(output, { lineWidth: 0 });
}

/** 预览：返回所有节点、每个节点组的匹配结果、基础规则类别 */
export async function previewConfig(config: AppConfig): Promise<PreviewResult> {
  const baseRules = await getBaseRules();
  const fetched = await fetchAllSubscriptions(config);
  const nodeConfigs = fetched
    .map((f) => f.config)
    .filter((item): item is ClashConfig => item !== null);
  const nodes = collectNodes(nodeConfigs);
  const nodeNames = nodes.map((n) => n.name);

  const warnings: string[] = [];
  fetched.forEach((f, i) => {
    if (f.error) warnings.push(`订阅 ${i + 1}（${config.subscriptions[i]?.label ?? "未命名"}）拉取失败：${f.error}`);
  });
  for (const f of fetched) {
    if (f.config && !Array.isArray(f.config.proxies)) {
      warnings.push("某个订阅没有内嵌 proxies（可能是 proxy-providers 形式），当前版本暂不支持该格式的节点");
    }
  }

  const groups = config.groups.map((g) => {
    let matched: string[] = [];
    if (g.type === "auto" && g.pattern) {
      try {
        const re = new RegExp(g.pattern, "i");
        matched = nodeNames.filter((n) => re.test(n));
      } catch {
        matched = [];
      }
    } else if (g.type === "manual") {
      const existing = new Set(nodeNames);
      matched = (g.nodes ?? []).filter((n) => existing.has(n));
    } else if (g.type === "all") {
      matched = [...nodeNames];
    } else if (g.type === "direct") {
      matched = ["DIRECT"];
    } else if (g.type === "reject") {
      matched = ["REJECT"];
    }
    return { name: g.name, nodes: matched };
  });
  const sourceGroups = buildSourceGroups(
    config,
    fetched,
    [...config.groups.map((g) => g.name), MAIN_GROUP, AUTO_GROUP],
  ).map((group) => ({ name: group.name, nodes: group.proxies }));

  const categories = baseRuleCategories(baseRules);

  const subscriptions = fetched.map((f, i) => ({
    index: i,
    label: config.subscriptions[i]?.label || `订阅 ${i + 1}`,
    nodeCount: f.config ? collectNodes([f.config]).length : 0,
  }));
  const baseRuleCount = baseRules.length;

  return {
    allNodes: nodeNames,
    sourceGroups,
    groups,
    categories,
    warnings,
    subscriptions,
    baseRuleCount,
  };
}
