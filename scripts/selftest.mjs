// 端到端自测：调用本机 dev server 的 /api/preview 与 /api/sub
import { deflateSync } from "node:zlib";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "yaml";

// 从 Clash Verge 本机配置读取订阅地址（带 token，不提交进仓库）
const profilePath = `${os.homedir()}/Library/Application Support/io.github.clash-verge-rev.clash-verge-rev/profiles.yaml`;
const profileUrls = [
  ...readFileSync(profilePath, "utf8").matchAll(/^  url: (\S+)$/gm),
].map((m) => m[1]);
if (profileUrls.length < 2) {
  console.error("无法从 Clash Verge profiles.yaml 读取到两个订阅地址");
  process.exit(1);
}

const BASE = "http://localhost:3000";
const dir = path.dirname(fileURLToPath(import.meta.url));

// 从扩展脚本里提取数据库 IP 列表
const scriptText = readFileSync(path.join(dir, "Script-v2.js"), "utf8");
const ips = [
  ...scriptText.matchAll(/"((?:\d{1,3}\.){3}\d{1,3})"/g),
].map((m) => m[1]);

const singaporeDomains = ["dramarewards.com", "chewrobot.com"];
const chatgptDomains = [
  "chatgpt.com", "openai.com", "oaistatic.com", "oaiusercontent.com",
  "openaimerge.com", "oaistatsig.com", "featuregates.org",
  "featureassets.org", "prodregistryv2.org", "chatgpt.livekit.cloud",
];

const config = {
  version: 1,
  subscriptions: [
    { url: profileUrls[0], label: "订阅1（基础规则）" },
    { url: profileUrls[1], label: "订阅2" },
  ],
  baseIndex: 0,
  groups: [
    { id: "sg", name: "数据库-新加坡", type: "auto", pattern: "新加坡|🇸🇬|[-.]sg\\d" },
    { id: "us", name: "ChatGPT-美国", type: "auto", pattern: "美国|🇺🇸|🇺🇲|[-.]sv[-.\\d]|[-.]us\\d" },
    { id: "tw", name: "台湾节点", type: "auto", pattern: "台湾|🇨🇳台湾|🇹🇼|[-.]tw\\d" },
    { id: "jp", name: "日本节点", type: "auto", pattern: "日本|🇯🇵|[-.]jp\\d" },
    { id: "hk", name: "香港节点", type: "auto", pattern: "香港|🇭🇰|[-.]hk\\d" },
    { id: "all", name: "全部节点", type: "all" },
    { id: "direct", name: "直连", type: "direct" },
    { id: "reject", name: "拒绝", type: "reject" },
  ],
  ruleMapping: [],
  customRules: [
    ...ips.map((ip) => ({ type: "IP-CIDR", value: ip, group: "数据库-新加坡" })),
    ...singaporeDomains.map((d) => ({ type: "DOMAIN-SUFFIX", value: d, group: "数据库-新加坡" })),
    ...chatgptDomains.map((d) => ({ type: "DOMAIN-SUFFIX", value: d, group: "ChatGPT-美国" })),
  ],
};

function encode(cfg) {
  return deflateSync(Buffer.from(JSON.stringify(cfg), "utf-8")).toString("base64url");
}

function suggest(cat, groups) {
  const byType = (t) => groups.find((g) => g.type === t)?.name;
  const byName = (re) => groups.find((g) => re.test(g.name))?.name;
  if (/国内|直连/.test(cat)) return byType("direct") ?? byName(/直连/) ?? groups[0].name;
  if (/广告|拦截/.test(cat)) return byType("reject") ?? byType("direct") ?? "";
  if (/动画疯|巴哈|台湾/.test(cat)) return byName(/台湾/) ?? byType("all") ?? groups[0].name;
  if (/选择节点|漏网|全局/.test(cat)) return byType("all") ?? groups[0].name;
  return byType("all") ?? groups[0].name;
}

// 等 dev server 就绪
for (let i = 0; i < 30; i++) {
  try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 1000)); }
}

console.log("===== 1) 预览 =====");
const previewRes = await fetch(`${BASE}/api/preview`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ config }),
});
const preview = await previewRes.json();
if (!previewRes.ok) { console.error("预览失败:", preview); process.exit(1); }
console.log("总节点数:", preview.allNodes.length);
for (const g of preview.groups) console.log(`  组「${g.name}」→ ${g.nodes.length} 个`);
console.log("规则类别:", preview.categories);
console.log("警告:", preview.warnings);

// 模拟界面里的默认推荐映射
config.ruleMapping = preview.categories
  .map((cat) => ({ category: cat, group: suggest(cat, config.groups) }))
  .filter((m) => m.group);
console.log("\n===== 2) 默认推荐映射 =====");
for (const m of config.ruleMapping) console.log(`  ${m.category} → ${m.group}`);

console.log("\n===== 3) 生成订阅 YAML =====");
const enc = encode(config);
console.log("编码后配置长度:", enc.length, "字符");
const subRes = await fetch(`${BASE}/api/sub?c=${enc}`);
const text = await subRes.text();
console.log("HTTP", subRes.status, "| 内容长度:", text.length, "字符");
if (!subRes.ok) { console.error(text); process.exit(1); }

const out = yaml.parse(text);
console.log("\n===== 4) 校验输出 =====");
console.log("proxies 节点数:", out.proxies.length);
console.log("顶层设置: port =", out.port, "| mode =", out.mode, "| dns.enable =", out.dns?.enable, "| external-controller =", out["external-controller"]);
console.log("proxy-groups:", out["proxy-groups"].map((g) => g.name).join(" | "));
console.log("rules 条数:", out.rules.length);

// 校验所有策略组引用都存在
const known = new Set(out.proxies.map((p) => p.name));
for (const g of out["proxy-groups"]) known.add(g.name);
known.add("DIRECT"); known.add("REJECT");
const broken = [];
for (const g of out["proxy-groups"]) {
  for (const ref of g.proxies ?? []) if (!known.has(ref)) broken.push(`${g.name} → ${ref}`);
}
console.log("策略组引用缺失:", broken.length === 0 ? "无 ✔" : broken);

// 抽查规则
console.log("\n前 4 条自定义规则:");
for (const r of out.rules.slice(0, 4)) console.log("  ", r);
console.log("动画疯相关规则抽样:");
for (const r of out.rules) if (r.includes("动画疯")) { console.log("  ", r); break; }
console.log("国内网站相关规则抽样:");
for (const r of out.rules) if (r.includes("国内网站")) { console.log("  ", r); break; }
console.log("最后 2 条规则:");
for (const r of out.rules.slice(-2)) console.log("  ", r);

// 重写正确性校验
const targetCounts = {};
for (const r of out.rules) {
  const parts = r.split(",");
  const t = parts[parts.length - 1] === "no-resolve" ? parts[parts.length - 2] : parts[parts.length - 1];
  if (t) targetCounts[t] = (targetCounts[t] || 0) + 1;
}
console.log("\n===== 5) 重写正确性 =====");
console.log("规则目标分布:", targetCounts);
console.log("chatgpt 自定义规则存在:", out.rules.some((r) => r.startsWith("DOMAIN-SUFFIX,chatgpt.com,")));
console.log("动画疯→台湾节点 重写成功:", out.rules.some((r) => r.endsWith(",台湾节点")));
console.log("国内网站→直连 重写成功:", out.rules.some((r) => r.endsWith(",直连")));
console.log("拦截广告→拒绝 重写成功:", out.rules.some((r) => r.endsWith(",拒绝")));
