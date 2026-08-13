import yaml from "yaml";
import type { AppConfig, CustomRule, NodeGroup, PreviewResult } from "./types";

// 拉取订阅时会用到的集合类键，不会带进输出配置
const COLLECTION_KEYS = new Set([
  "proxies",
  "proxy-groups",
  "rules",
  "rule-providers",
  "proxy-providers",
  "sub-rules",
]);

// 规则里不会被当成“规则类别”的内建目标
const BUILTIN_TARGETS = new Set(["DIRECT", "REJECT", "PASS", "REJECT-DROP", "GLOBAL"]);

async function fetchSubscription(url: string): Promise<any> {
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
    const parsed = yaml.parse(text);
    if (!parsed || typeof parsed !== "object") throw new Error("内容不是 YAML");
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchAllSubscriptions(config: AppConfig) {
  return Promise.all(
    config.subscriptions.map(async (s, index) => {
      try {
        const c = await fetchSubscription(s.url);
        return { config: c as any, error: null as string | null, index };
      } catch (e: any) {
        return { config: null as any, error: String(e?.message ?? e), index };
      }
    }),
  );
}

/** 合并所有订阅的节点，按名字去重 */
export function collectNodes(configs: any[]): any[] {
  const seen = new Set<string>();
  const nodes: any[] = [];
  for (const cfg of configs) {
    if (!cfg || !Array.isArray(cfg.proxies)) continue;
    for (const p of cfg.proxies) {
      if (p && typeof p === "object" && typeof p.name === "string" && p.name) {
        if (!seen.has(p.name)) {
          seen.add(p.name);
          nodes.push(p);
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

/** 把一条自定义规则拼成完整规则行 */
export function buildCustomRule(r: CustomRule): string {
  if (!r || !r.value) return "";
  if (r.type === "RAW") return r.value.trim();
  const v = r.value.trim();
  if (!v || !r.group) return "";
  switch (r.type) {
    case "DOMAIN":
      return `DOMAIN,${v},${r.group}`;
    case "DOMAIN-SUFFIX":
      return `DOMAIN-SUFFIX,${v},${r.group}`;
    case "DOMAIN-KEYWORD":
      return `DOMAIN-KEYWORD,${v},${r.group}`;
    case "IP-CIDR": {
      const cidr = v.includes("/") ? v : `${v}/32`;
      return `IP-CIDR,${cidr},${r.group},no-resolve`;
    }
    default:
      return "";
  }
}

/** 从基础订阅里拷贝顶层设置（端口/DNS 等），跳过集合类键 */
function pickSettings(baseCfg: any): Record<string, any> {
  const out: Record<string, any> = { mode: "rule" };
  if (baseCfg && typeof baseCfg === "object") {
    for (const [k, v] of Object.entries(baseCfg)) {
      if (COLLECTION_KEYS.has(k)) continue;
      if (k === "mode") continue;
      out[k] = v;
    }
    if (typeof baseCfg.mode === "string") out.mode = baseCfg.mode;
  }
  return out;
}

const MAIN_GROUP = "🚀 选择节点";
const AUTO_GROUP = "♻️ 自动选择";
const TEST_URL = "http://www.gstatic.com/generate_204";

/** 生成最终的 Clash YAML 配置文本 */
export async function generateConfig(config: AppConfig): Promise<string> {
  const fetched = await fetchAllSubscriptions(config);
  const nodeConfigs = fetched.map((f) => f.config).filter(Boolean);
  if (nodeConfigs.length === 0) {
    throw new Error("所有订阅都拉取失败，无法生成");
  }

  const nodes = collectNodes(nodeConfigs);
  const nodeNames = nodes.map((n) => n.name);
  if (nodes.length === 0) {
    throw new Error("没有从订阅中解析到任何节点");
  }

  const baseCfg = fetched[config.baseIndex]?.config;
  const rawRules: unknown = baseCfg?.rules;
  const baseRules: string[] = Array.isArray(rawRules)
    ? rawRules.filter((r): r is string => typeof r === "string")
    : [];

  // 节点组
  const groups = buildGroups(config.groups, nodeNames);
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
  const allGroups = [...builtinGroups, ...groups];
  const validGroups = new Set(allGroups.map((g) => g.name));
  const fallbackGroup = validGroups.has(MAIN_GROUP)
    ? MAIN_GROUP
    : (allGroups[0]?.name ?? MAIN_GROUP);

  // 基础规则类别 → 节点组 的映射（只保留指向存在的组的映射）
  const mapping = new Map<string, string>();
  for (const m of config.ruleMapping) {
    if (validGroups.has(m.group)) mapping.set(m.category, m.group);
  }

  // 自定义规则（最高优先级）
  const custom = config.customRules
    .map(buildCustomRule)
    .filter(Boolean)
    .map((r) => fixRuleGroup(r, validGroups, fallbackGroup));

  // 基础规则重写
  const remapped = baseRules
    .map((r) => remapRule(r, mapping, fallbackGroup))
    .filter((r) => r.length > 0 && !r.startsWith("MATCH,"));

  // 最终规则：自定义在前，基础规则在后，MATCH 兜底放最后
  const finalRules = [...custom, ...remapped, `MATCH,${fallbackGroup}`];

  const output = {
    ...pickSettings(baseCfg),
    proxies: nodes,
    "proxy-groups": allGroups,
    rules: finalRules,
  };

  return yaml.stringify(output, { lineWidth: 0 });
}

/** 预览：返回所有节点、每个节点组的匹配结果、基础规则类别 */
export async function previewConfig(config: AppConfig): Promise<PreviewResult> {
  const fetched = await fetchAllSubscriptions(config);
  const nodeConfigs = fetched.map((f) => f.config).filter(Boolean);
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
    } else if (g.type === "all") {
      matched = [...nodeNames];
    } else if (g.type === "direct") {
      matched = ["DIRECT"];
    } else if (g.type === "reject") {
      matched = ["REJECT"];
    }
    return { name: g.name, nodes: matched };
  });

  const baseCfg = fetched[config.baseIndex]?.config;
  const rawRules: unknown = baseCfg?.rules;
  const baseRules: string[] = Array.isArray(rawRules)
    ? rawRules.filter((r): r is string => typeof r === "string")
    : [];
  const categories = Array.from(
    new Set(
      baseRules
        .map((r) => ruleCategory(r).category)
        .filter((c): c is string => c !== null),
    ),
  );

  return { allNodes: nodeNames, groups, categories, warnings };
}
