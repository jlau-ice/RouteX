/** Clash 内置、无需用户创建的规则目标。 */
export const MAIN_GROUP = "🚀 选择节点";
export const AUTO_GROUP = "♻️ 自动选择";
export const DIRECT_TARGET = "DIRECT";
export const REJECT_TARGET = "REJECT";

export const ALWAYS_AVAILABLE_TARGETS = [
  MAIN_GROUP,
  AUTO_GROUP,
  DIRECT_TARGET,
  REJECT_TARGET,
] as const;
