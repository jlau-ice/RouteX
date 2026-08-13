import type { AppConfig } from "./types";

// 订阅地址在页面里填写（会存到浏览器 localStorage）。
// 注意：订阅链接带 token，切勿硬编码进代码 / 提交到公开仓库。
export const DEFAULT_SUBSCRIPTIONS: { url: string; label?: string }[] = [];

// 数据库服务器 IP（腾讯云新加坡段）
const DATABASE_IPS = [
  "43.156.35.51", "43.128.81.174", "43.156.29.215", "43.163.85.90",
  "43.134.94.148", "43.163.90.89", "43.163.85.33", "43.134.91.196",
  "43.163.80.4", "43.156.229.44", "43.156.108.77", "43.159.60.31",
  "43.134.97.230", "43.128.105.86", "43.134.57.245", "129.226.156.39",
  "43.128.107.155", "43.134.122.151", "43.156.44.199", "43.159.33.201",
  "43.156.34.96", "43.153.193.218", "43.156.38.81", "43.156.172.51",
  "43.156.117.219", "43.163.92.93", "43.156.25.237", "43.134.231.90",
  "150.109.16.240", "43.134.75.230", "101.32.168.220", "129.226.220.246",
  "43.134.97.195", "43.163.91.25", "43.134.167.153", "43.134.80.167",
  "43.163.123.69", "43.156.76.59", "119.28.106.23", "43.159.35.235",
  "43.163.107.142", "43.156.111.48", "43.163.127.217", "43.156.200.74",
  "43.134.238.173", "129.226.4.113", "43.128.67.163", "119.28.108.19",
  "43.133.59.145", "43.128.102.151", "43.163.122.89", "101.32.166.177",
  "43.160.249.27", "43.160.221.156", "43.172.182.156", "43.133.58.22",
];

const SINGAPORE_DOMAINS = ["dramarewards.com", "chewrobot.com"];

// OpenAI/ChatGPT 专用域名
const CHATGPT_DOMAINS = [
  "chatgpt.com", "openai.com", "oaistatic.com", "oaiusercontent.com",
  "openaimerge.com", "oaistatsig.com", "featuregates.org",
  "featureassets.org", "prodregistryv2.org", "chatgpt.livekit.cloud",
];

export function buildDefaultConfig(): AppConfig {
  return {
    version: 1,
    subscriptions: DEFAULT_SUBSCRIPTIONS.map((s) => ({ ...s })),
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
      ...DATABASE_IPS.map((ip) => ({
        type: "IP-CIDR" as const,
        value: ip,
        group: "数据库-新加坡",
      })),
      ...SINGAPORE_DOMAINS.map((d) => ({
        type: "DOMAIN-SUFFIX" as const,
        value: d,
        group: "数据库-新加坡",
      })),
      ...CHATGPT_DOMAINS.map((d) => ({
        type: "DOMAIN-SUFFIX" as const,
        value: d,
        group: "ChatGPT-美国",
      })),
    ],
  };
}
