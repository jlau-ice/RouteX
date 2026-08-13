// 订阅聚合服务的配置类型

/** 节点组类型 */
export type GroupType = "auto" | "manual" | "all" | "direct" | "reject";

/** 用户自己建立的节点集合；不是 iKuuu 的规则类别 */
export interface NodeGroup {
  id: string;
  /** 策略组名，如“数据库-新加坡” */
  name: string;
  type: GroupType;
  /** type=auto 时的正则，如 新加坡|🇸🇬|[-.]sg\d */
  pattern?: string;
  /** type=manual 时手动勾选的节点名列表 */
  nodes?: string[];
}

/** 自定义规则 */
export interface CustomRule {
  type: "DOMAIN" | "DOMAIN-SUFFIX" | "DOMAIN-KEYWORD" | "IP-CIDR" | "RAW";
  /** RAW 时是完整规则行；其余为关键字/IP */
  value: string;
  /** 目标：单个节点、用户节点组、内置选择组、DIRECT 或 REJECT */
  group: string;
}

/** 订阅来源 */
export interface SubscriptionSource {
  url: string;
  label?: string;
}

/** iKuuu 规则策略组 → 组内可执行目标的映射 */
export interface RuleMappingEntry {
  /** 基础规则里的原策略组名，如“动画疯” */
  category: string;
  /** 该策略组内部选择的单节点、用户节点组、选择节点、DIRECT 或 REJECT */
  group: string;
}

export interface AppConfig {
  version: number;
  /** 节点来源（可多个，全部合并去重；仅提供节点，规则走内置基础规则） */
  subscriptions: SubscriptionSource[];
  /** 节点组定义 */
  groups: NodeGroup[];
  /** 基础规则类别映射 */
  ruleMapping: RuleMappingEntry[];
  /** 自定义规则（最高优先级） */
  customRules: CustomRule[];
}

/** 每个订阅的统计 */
export interface SubInfo {
  index: number;
  label: string;
  nodeCount: number;
}

/** /api/preview 的返回结果 */
export interface PreviewResult {
  allNodes: string[];
  /** 每个导入订阅自动形成的节点组 */
  sourceGroups: { name: string; nodes: string[] }[];
  /** 每个节点组匹配到的节点 */
  groups: { name: string; nodes: string[] }[];
  /** 从基础订阅提取的规则类别 */
  categories: string[];
  /** 提示信息（如订阅拉取失败的订阅索引） */
  warnings: string[];
  /** 各订阅的节点/规则数统计 */
  subscriptions: SubInfo[];
  /** 当前基础订阅的规则条数 */
  baseRuleCount: number;
}
