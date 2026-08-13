/** 旧版本曾生成的辅助策略组；仅用于迁移已有配置。 */
export const LEGACY_MAIN_GROUP = "🚀 选择节点";
export const LEGACY_AUTO_GROUP = "♻️ 自动选择";
export const DIRECT_TARGET = "DIRECT";
export const REJECT_TARGET = "REJECT";

export const ALWAYS_AVAILABLE_TARGETS = [
  DIRECT_TARGET,
  REJECT_TARGET,
] as const;

export const LEGACY_POLICY_TARGETS = [
  LEGACY_MAIN_GROUP,
  LEGACY_AUTO_GROUP,
] as const;
