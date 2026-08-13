// 订阅聚合服务的配置类型

/** 节点组类型 */
export type GroupType = "auto" | "all" | "direct" | "reject";

/** 一个承接规则用的节点组 */
export interface NodeGroup {
  id: string;
  /** 策略组名，如“数据库-新加坡” */
  name: string;
  type: GroupType;
  /** type=auto 时的正则，如 新加坡|🇸🇬|[-.]sg\d */
  pattern?: string;
}

/** 自定义规则 */
export interface CustomRule {
  type: "DOMAIN" | "DOMAIN-SUFFIX" | "DOMAIN-KEYWORD" | "IP-CIDR" | "RAW";
  /** RAW 时是完整规则行；其余为关键字/IP */
  value: string;
  /** 目标策略组名 */
  group: string;
}

/** 订阅来源 */
export interface SubscriptionSource {
  url: string;
  label?: string;
}

/** 基础规则类别 → 节点组 的映射 */
export interface RuleMappingEntry {
  /** 基础订阅里的规则类别（原策略组名），如“动画疯” */
  category: string;
  /** 承接它的节点组名，如“台湾节点” */
  group: string;
}

export interface AppConfig {
  version: number;
  /** 节点来源（可多个，全部合并去重） */
  subscriptions: SubscriptionSource[];
  /** 基础规则取自第几个订阅（下标） */
  baseIndex: number;
  /** 节点组定义 */
  groups: NodeGroup[];
  /** 基础规则类别映射 */
  ruleMapping: RuleMappingEntry[];
  /** 自定义规则（最高优先级） */
  customRules: CustomRule[];
}

/** /api/preview 的返回结果 */
export interface PreviewResult {
  allNodes: string[];
  /** 每个节点组匹配到的节点 */
  groups: { name: string; nodes: string[] }[];
  /** 从基础订阅提取的规则类别 */
  categories: string[];
  /** 提示信息（如订阅拉取失败的订阅索引） */
  warnings: string[];
}
