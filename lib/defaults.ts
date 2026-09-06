import type { AppConfig } from "./types";

// 新配置仅使用 iKuuu 基础分流；订阅、节点组和个人规则由用户自行添加。
// 订阅地址含有凭证，不要预填或提交到代码仓库。
export function buildDefaultConfig(): AppConfig {
  return {
    version: 1,
    subscriptions: [],
    groups: [],
    ruleMapping: [],
    customRules: [],
  };
}
