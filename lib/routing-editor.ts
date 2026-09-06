import type { AppConfig, CustomRule } from "./types";

function ipVersion(value: string): 0 | 4 | 6 {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value))
    return value.split(".").every((part) => Number(part) <= 255) ? 4 : 0;
  if (value.includes(":")) {
    try {
      new URL(`http://[${value}]/`);
      return 6;
    } catch {
      /* Continue as a hostname. */
    }
  }
  return 0;
}

/** Accept addresses, never retain database usernames/passwords or URL paths. */
export function addressRule(
  input: string,
  target: string,
  note = "",
): CustomRule {
  let value = input.trim();
  if (!value) throw new Error("请填写需要分流的地址");
  if (
    !value.includes("://") &&
    value.includes("/") &&
    /^(?:[\d.]+|[a-f\d]*:[a-f\d:.]*)\//i.test(value)
  ) {
    const [ip, prefix, extra] = value.split("/");
    const version = ipVersion(ip);
    if (
      !version ||
      extra !== undefined ||
      !/^\d+$/.test(prefix) ||
      Number(prefix) > (version === 6 ? 128 : 32)
    )
      throw new Error("IP 网段格式不正确，请检查地址和掩码长度");
    return { type: "IP-CIDR", value, group: target, note, enabled: true };
  }
  // Unbracketed IPv6 must be handled before treating ':' as a URL port.
  if (!ipVersion(value)) {
    value = value.replace(/^\*\.|^\./, "");
    try {
      const url = new URL(value.includes("://") ? value : `http://${value}`);
      if (
        ![
          "http:",
          "https:",
          "postgres:",
          "postgresql:",
          "mysql:",
          "redis:",
          "rediss:",
          "mongodb:",
          "mongodb+srv:",
        ].includes(url.protocol)
      )
        throw new Error("unsupported protocol");
      value = url.hostname.replace(/^\[|\]$/g, "");
    } catch {
      throw new Error(
        "地址格式不正确，请填写域名、网址、IP 或单个数据库连接地址",
      );
    }
  }
  value = value.toLowerCase().replace(/\.$/, "");
  const version = ipVersion(value);
  if (
    !version &&
    (!/^[a-z0-9_-]+(?:\.[a-z0-9_-]+)*$/i.test(value) ||
      /^\d+(\.\d+){3}$/.test(value))
  )
    throw new Error("主机名或 IP 格式不正确；多个数据库主机请分行填写");
  return {
    type: version ? "IP-CIDR" : "DOMAIN-SUFFIX",
    value,
    group: target,
    note,
    enabled: true,
  };
}

export function addressRules(input: string, target: string, note = "") {
  const lines = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) throw new Error("请先粘贴需要分流的地址，每行一个");
  const result = lines.map((line) => addressRule(line, target, note.trim()));
  return [
    ...new Map(
      result.map((rule) => [`${rule.type}:${rule.value}`, rule]),
    ).values(),
  ];
}

export function prependRules(
  config: AppConfig,
  rules: CustomRule[],
): AppConfig {
  const key = (rule: CustomRule) =>
    `${rule.type}:${rule.type === "RAW" ? retargetRaw(rule.value, "__TARGET__") : rule.value}`;
  const keys = new Set(rules.map(key));
  return {
    ...config,
    customRules: [
      ...rules,
      ...config.customRules.filter((rule) => !keys.has(key(rule))),
    ],
  };
}

export function parseBaseRule(raw: string) {
  const parts = raw.split(",").map((part) => part.trim());
  const targetIndex = parts.length - (parts.at(-1) === "no-resolve" ? 2 : 1);
  return {
    raw,
    type: parts[0],
    value: parts[0] === "MATCH" ? "其他未匹配流量" : parts[1],
    target: parts[targetIndex],
  };
}

export function retargetRaw(raw: string, target: string): string {
  return raw
    .split(/\r?\n/)
    .map((line) => {
      if (!line.trim() || line.trim().startsWith("#")) return line;
      const parts = line.split(",");
      const index =
        parts.length - (parts.at(-1)?.trim() === "no-resolve" ? 2 : 1);
      if (index < 1) return line;
      parts[index] = target;
      return parts.join(",");
    })
    .join("\n");
}

export function baseRuleOverride(raw: string, target: string): CustomRule {
  const rule = parseBaseRule(raw);
  if (rule.type === "MATCH")
    throw new Error("请在分类策略中修改漏网之鱼的目标");
  return {
    type: "RAW",
    value: retargetRaw(raw, target),
    group: target,
    note: `覆盖默认规则：${rule.value}`.slice(0, 200),
    enabled: true,
  };
}

export function publishChanges(
  previous: AppConfig | undefined,
  current: AppConfig,
): string[] {
  if (!previous)
    return [
      `保存 ${current.subscriptions.length} 个订阅、${current.groups.length} 个节点组和 ${current.customRules.filter((rule) => rule.enabled !== false).length} 条启用的个人规则`,
    ];
  const changes: string[] = [];
  if (
    JSON.stringify(previous.subscriptions) !==
    JSON.stringify(current.subscriptions)
  )
    changes.push("订阅来源、地址或启用状态有修改");
  if (JSON.stringify(previous.groups) !== JSON.stringify(current.groups))
    changes.push("节点组、候选节点或默认节点有修改");
  if (
    JSON.stringify(previous.ruleMapping) !== JSON.stringify(current.ruleMapping)
  )
    changes.push("默认出口或分类策略有修改");
  if (
    JSON.stringify(previous.customRules) !== JSON.stringify(current.customRules)
  ) {
    changes.push(
      `个人规则有修改：${current.customRules.filter((rule) => rule.enabled !== false).length} 条启用，${current.customRules.filter((rule) => rule.enabled === false).length} 条暂停`,
    );
    const old = new Set(
      previous.customRules.map((rule) => JSON.stringify(rule)),
    );
    for (const rule of current.customRules
      .filter((item) => !old.has(JSON.stringify(item)))
      .slice(0, 4))
      changes.push(
        `${rule.enabled === false ? "暂停" : "应用"} ${rule.note || rule.value.split("\n")[0]} → ${rule.group === "DIRECT" ? "直连" : rule.group}`,
      );
  }
  return changes;
}
