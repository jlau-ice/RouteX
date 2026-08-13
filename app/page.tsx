"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type {
  AppConfig,
  CustomRule,
  GroupType,
  NodeGroup,
  PreviewResult,
} from "@/lib/types";
import { buildDefaultConfig } from "@/lib/defaults";
import { getErrorMessage } from "@/lib/errors";
import {
  ALWAYS_AVAILABLE_TARGETS,
  DIRECT_TARGET,
  LEGACY_POLICY_TARGETS,
  REJECT_TARGET,
} from "@/lib/policy-targets";

const LS_KEY = "clash-agg-config-v1";
const LS_SAVED_KEY = "routex-saved-config-v1";

/* ---------- 工具 ---------- */

/** 给 iKuuu 原规则类别推荐默认目标。普通类别默认直接包含全部真实节点。 */
function suggestTargets(
  category: string,
  groups: NodeGroup[],
  nodeNames: string[],
): string[] {
  const byName = (re: RegExp) => groups.find((g) => re.test(g.name))?.name;
  if (/国内|直连/.test(category)) return [DIRECT_TARGET];
  if (/广告|拦截/.test(category)) return [REJECT_TARGET];
  if (/动画疯|巴哈|台湾/.test(category))
    return [byName(/台湾/) ?? nodeNames[0]].filter(Boolean);
  return [...nodeNames];
}

/* ---------- 小组件 ---------- */

const inputCls =
  "w-full rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 focus:border-zinc-500 focus:outline-none";
const btnPrimary =
  "rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40";
const btnGhost =
  "rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-300 transition-colors hover:bg-zinc-800";

function Section({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-5">
      <h2 className="text-base font-semibold text-zinc-100">{title}</h2>
      {desc && <p className="mt-1 text-sm text-zinc-400">{desc}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/* ---------- 手动选节点 ---------- */

function NodePicker({
  allNodes,
  selected,
  onChange,
}: {
  allNodes: string[];
  selected: string[];
  onChange: (nodes: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const sel = useMemo(() => new Set(selected), [selected]);
  const filtered = allNodes.filter((n) =>
    n.toLowerCase().includes(query.toLowerCase()),
  );
  const toggle = (n: string) => {
    if (sel.has(n)) onChange(selected.filter((x) => x !== n));
    else onChange([...selected, n]);
  };
  const selectFiltered = () =>
    onChange(Array.from(new Set([...selected, ...filtered])));
  return (
    <div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          className={inputCls}
          placeholder="搜索节点…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="shrink-0 text-xs text-zinc-500">
          已选 {selected.length} / {allNodes.length}
        </span>
        <button
          type="button"
          className={`${btnGhost} shrink-0 !px-3 !py-1 text-xs`}
          onClick={selectFiltered}
          disabled={filtered.length === 0}
        >
          全选当前结果
        </button>
        <button
          type="button"
          className={`${btnGhost} shrink-0 !px-3 !py-1 text-xs`}
          onClick={() => onChange([])}
          disabled={selected.length === 0}
        >
          清空
        </button>
      </div>
      <div className="mt-2 grid max-h-56 grid-cols-1 gap-1 overflow-y-auto rounded-lg border border-zinc-800 p-2 sm:grid-cols-2">
        {filtered.map((n) => (
          <label
            key={n}
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-zinc-800"
          >
            <input
              type="checkbox"
              checked={sel.has(n)}
              onChange={() => toggle(n)}
              className="accent-sky-500"
            />
            <span className="truncate">{n}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

type TargetSection = { label: string; options: { value: string; label: string }[] };

function MultiRuleTargetPicker({
  selected,
  sourceGroups,
  customGroups,
  nodeNames,
  onChange,
}: {
  selected: string[];
  sourceGroups: { name: string; nodes: string[] }[];
  customGroups: { name: string; nodes: string[] }[];
  nodeNames: string[];
  onChange: (targets: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const sections = useMemo<TargetSection[]>(
    () => [
      {
        label: `真实节点（${nodeNames.length}）`,
        options: nodeNames.map((value) => ({ value, label: value })),
      },
      {
        label: "导入订阅组（选择后会展开为真实节点）",
        options: sourceGroups.map(({ name, nodes }) => ({
          value: name,
          label: `${name}（${nodes.length} 个节点）`,
        })),
      },
      {
        label: "自定义节点组（选择后会展开为真实节点）",
        options: customGroups.map(({ name, nodes }) => ({
          value: name,
          label: `${name}（${nodes.length} 个节点）`,
        })),
      },
      {
        label: "特殊目标（不是节点）",
        options: [
          { value: DIRECT_TARGET, label: "直连（DIRECT）" },
          { value: REJECT_TARGET, label: "拒绝（REJECT）" },
        ],
      },
    ],
    [customGroups, nodeNames, sourceGroups],
  );
  const knownTargets = useMemo(
    () => new Set(sections.flatMap((section) => section.options.map((option) => option.value))),
    [sections],
  );
  const normalizedQuery = query.trim().toLowerCase();
  const visibleSections = sections
    .map((section) => ({
      ...section,
      options: normalizedQuery
        ? section.options.filter((option) =>
            option.label.toLowerCase().includes(normalizedQuery),
          )
        : section.options,
    }))
    .filter((section) => section.options.length > 0);
  const invalidTargets = selected.filter((target) => !knownTargets.has(target));
  const toggle = (target: string) => {
    if (selectedSet.has(target)) {
      onChange(selected.filter((value) => value !== target));
    } else {
      onChange([...selected, target]);
    }
  };
  const summary =
    selected.length === 0
      ? "请选择节点或节点组"
      : selected.length <= 2
        ? selected.join("、")
        : `${selected.slice(0, 2).join("、")} 等 ${selected.length} 项`;

  return (
    <details className="relative sm:w-96">
      <summary className={`${inputCls} cursor-pointer list-none pr-8`}>
        <span className="block truncate">{summary}</span>
        <span className="pointer-events-none absolute right-3 top-2.5 text-zinc-400">⌄</span>
      </summary>
      <div className="right-0 z-30 mt-2 w-full rounded-lg border border-zinc-700 bg-zinc-900 p-3 shadow-2xl sm:absolute sm:min-w-96">
        <div className="flex items-center gap-2">
          <input
            className={inputCls}
            placeholder="搜索节点或节点组…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <button
            type="button"
            className={`${btnGhost} shrink-0 !px-3`}
            onClick={() => onChange([])}
            disabled={selected.length === 0}
          >
            清空
          </button>
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          已选 {selected.length} 项。节点组只是筛选工具，生成时会展开成组内真实节点。
        </p>
        <button
          type="button"
          className={`${btnGhost} mt-2 w-full !py-1 text-xs`}
          onClick={() => onChange(nodeNames)}
          disabled={nodeNames.length === 0}
        >
          选择全部 {nodeNames.length} 个真实节点
        </button>
        <div className="mt-2 max-h-72 space-y-3 overflow-y-auto pr-1">
          {invalidTargets.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-medium text-amber-400">已失效目标</div>
              {invalidTargets.map((target) => (
                <label key={target} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-zinc-800">
                  <input
                    type="checkbox"
                    checked
                    onChange={() => toggle(target)}
                    className="accent-sky-500"
                  />
                  <span className="truncate text-amber-300">{target}</span>
                </label>
              ))}
            </div>
          )}
          {visibleSections.map((section) => (
            <div key={section.label}>
              <div className="mb-1 text-xs font-medium text-zinc-500">{section.label}</div>
              {section.options.map((option) => (
                <label key={option.value} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-zinc-800">
                  <input
                    type="checkbox"
                    checked={selectedSet.has(option.value)}
                    onChange={() => toggle(option.value)}
                    className="accent-sky-500"
                  />
                  <span className="truncate">{option.label}</span>
                </label>
              ))}
            </div>
          ))}
          {visibleSections.length === 0 && invalidTargets.length === 0 && (
            <p className="py-4 text-center text-sm text-zinc-500">没有匹配项</p>
          )}
        </div>
      </div>
    </details>
  );
}

function RuleTargetOptions({
  currentValue,
  sourceGroupNames,
  groupNames,
  nodeNames,
}: {
  currentValue: string;
  sourceGroupNames: string[];
  groupNames: string[];
  nodeNames: string[];
}) {
  const knownTargets = new Set([
    ...ALWAYS_AVAILABLE_TARGETS,
    ...sourceGroupNames,
    ...groupNames,
    ...nodeNames,
  ]);

  return (
    <>
      {currentValue && !knownTargets.has(currentValue) && (
        <option value={currentValue}>⚠️ 已失效：{currentValue}</option>
      )}
      <optgroup label="内置策略">
        <option value={DIRECT_TARGET}>直连（DIRECT）</option>
        <option value={REJECT_TARGET}>拒绝（REJECT）</option>
      </optgroup>
      {sourceGroupNames.length > 0 && (
        <optgroup label="导入的订阅节点组">
          {sourceGroupNames.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </optgroup>
      )}
      {groupNames.length > 0 && (
        <optgroup label="自定义筛选节点组">
          {groupNames.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </optgroup>
      )}
      {nodeNames.length > 0 && (
        <optgroup label={`自动识别的单个节点（${nodeNames.length}）`}>
          {nodeNames.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </optgroup>
      )}
    </>
  );
}

/* ---------- 预设节点组 ---------- */

const GROUP_PRESETS: { label: string; def: () => NodeGroup }[] = [
  {
    label: "新加坡",
    def: () => ({
      id: "sg",
      name: "数据库-新加坡",
      type: "auto",
      pattern: "新加坡|🇸🇬|[-.]sg\\d",
    }),
  },
  {
    label: "美国",
    def: () => ({
      id: "us",
      name: "ChatGPT-美国",
      type: "auto",
      pattern: "美国|🇺🇸|🇺🇲|[-.]sv[-.\\d]|[-.]us\\d",
    }),
  },
  {
    label: "台湾",
    def: () => ({
      id: "tw",
      name: "台湾节点",
      type: "auto",
      pattern: "台湾|🇨🇳台湾|🇹🇼|[-.]tw\\d",
    }),
  },
  {
    label: "日本",
    def: () => ({
      id: "jp",
      name: "日本节点",
      type: "auto",
      pattern: "日本|🇯🇵|[-.]jp\\d",
    }),
  },
  {
    label: "香港",
    def: () => ({
      id: "hk",
      name: "香港节点",
      type: "auto",
      pattern: "香港|🇭🇰|[-.]hk\\d",
    }),
  },
  {
    label: "全部节点",
    def: () => ({ id: "all", name: "全部节点", type: "all" }),
  },
];

const RULE_TYPES = ["DOMAIN-SUFFIX", "DOMAIN", "DOMAIN-KEYWORD", "IP-CIDR", "RAW"];

/* ---------- 页面 ---------- */

export default function Home() {
  const [config, setConfig] = useState<AppConfig>(buildDefaultConfig);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [transitionLoading, startTransition] = useTransition();
  const [cloudLoading, setCloudLoading] = useState(false);
  const loading = transitionLoading || cloudLoading;
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saved, setSaved] = useState<{
    id: string;
    editKey: string;
    url: string;
  } | null>(null);
  const [savedConfig, setSavedConfig] = useState<AppConfig | null>(null);
  const [loadInput, setLoadInput] = useState("");

  // 从 localStorage 恢复
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const raw = localStorage.getItem(LS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.version === 1) {
            // v1 曾把 DIRECT / REJECT 误建成“节点组”；它们现在是规则的内置目标。
            const groups = Array.isArray(parsed.groups)
              ? parsed.groups.filter(
                  (group: NodeGroup) =>
                    !(
                      (group.id === "direct" && group.name === "直连") ||
                      (group.id === "reject" && group.name === "拒绝")
                    ),
                )
              : [];
            setConfig({ ...parsed, groups });
          }
        }
        const rawSaved = localStorage.getItem(LS_SAVED_KEY);
        if (rawSaved) {
          const parsedSaved = JSON.parse(rawSaved);
          if (
            typeof parsedSaved?.id === "string" &&
            typeof parsedSaved?.editKey === "string" &&
            typeof parsedSaved?.url === "string"
          ) {
            setSaved(parsedSaved);
            if (parsedSaved.config?.version === 1) {
              setSavedConfig(parsedSaved.config);
            }
          }
        }
      } catch {}
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  // 持久化
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(config));
    } catch {}
  }, [config]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (saved) {
        localStorage.setItem(
          LS_SAVED_KEY,
          JSON.stringify({ ...saved, config: savedConfig }),
        );
      }
      else localStorage.removeItem(LS_SAVED_KEY);
    } catch {}
  }, [saved, savedConfig]);

  /* --- 订阅 --- */
  const setSub = (i: number, k: "url" | "label", v: string) => {
    setConfig((c) => {
      const subscriptions = c.subscriptions.map((s, idx) =>
        idx === i ? { ...s, [k]: v } : s,
      );
      return { ...c, subscriptions };
    });
  };
  const addSub = () =>
    setConfig((c) => ({
      ...c,
      subscriptions: [...c.subscriptions, { url: "", label: "" }],
    }));
  const removeSub = (i: number) =>
    setConfig((c) => ({
      ...c,
      subscriptions: c.subscriptions.filter((_, idx) => idx !== i),
    }));

  /* --- 节点组 --- */
  const updateGroup = (i: number, p: Partial<NodeGroup>) =>
    setConfig((c) => ({
      ...c,
      groups: c.groups.map((g, idx) => (idx === i ? { ...g, ...p } : g)),
    }));
  const removeGroup = (i: number) =>
    setConfig((c) => ({
      ...c,
      groups: c.groups.filter((_, idx) => idx !== i),
    }));
  const addPreset = (preset: (typeof GROUP_PRESETS)[number]) =>
    setConfig((c) => {
      const def = preset.def();
      if (c.groups.some((g) => g.name === def.name)) return c;
      const id = `${def.id}-${Date.now()}`;
      return { ...c, groups: [...c.groups, { ...def, id }] };
    });
  const addManualGroup = () =>
    setConfig((c) => {
      const names = new Set(c.groups.map((group) => group.name));
      const baseName = "新节点组";
      let name = baseName;
      let suffix = 2;
      while (names.has(name)) {
        name = `${baseName} ${suffix}`;
        suffix += 1;
      }
      return {
        ...c,
        groups: [
          ...c.groups,
          {
            id: `manual-${Date.now()}`,
            name,
            type: "manual",
            nodes: [],
          },
        ],
      };
    });

  /* --- 规则映射 --- */
  const upsertMapping = (category: string, targets: string[]) =>
    setConfig((c) => {
      const uniqueTargets = Array.from(new Set(targets));
      const group = uniqueTargets[0] ?? "";
      const exists = c.ruleMapping.some((m) => m.category === category);
      const ruleMapping = exists
        ? c.ruleMapping.map((m) =>
            m.category === category
              ? { ...m, group, targets: uniqueTargets }
              : m,
          )
        : [...c.ruleMapping, { category, group, targets: uniqueTargets }];
      return { ...c, ruleMapping };
    });

  /* --- 自定义规则 --- */
  const updateCustom = (i: number, p: Partial<CustomRule>) =>
    setConfig((c) => ({
      ...c,
      customRules: c.customRules.map((r, idx) => (idx === i ? { ...r, ...p } : r)),
    }));
  const removeCustom = (i: number) =>
    setConfig((c) => ({
      ...c,
      customRules: c.customRules.filter((_, idx) => idx !== i),
    }));
  const addCustom = () =>
    setConfig((c) => ({
      ...c,
      customRules: [
        ...c.customRules,
        {
          type: "DOMAIN-SUFFIX",
          value: "",
          group:
            c.groups.find((group) => group.type === "all")?.name ??
            c.groups[0]?.name ??
            DIRECT_TARGET,
        },
      ],
    }));

  /* --- 预览 --- */
  const runPreview = () => {
    setError("");
    setNotice("");
    startTransition(async () => {
      try {
        const res = await fetch("/api/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ config }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "预览失败");
          return;
        }
        setPreview(data as PreviewResult);
        // 把新类别补进映射（用默认推荐值）
        setConfig((c) => {
          const existing = new Set(c.ruleMapping.map((m) => m.category));
          const toAdd = (data.categories as string[])
            .filter((cat) => !existing.has(cat))
            .map((cat) => {
              const targets = suggestTargets(
                cat,
                c.groups,
                data.allNodes as string[],
              );
              return { category: cat, group: targets[0] ?? "", targets };
            })
            .filter((m) => m.group);
          return {
            ...c,
            ruleMapping:
              toAdd.length > 0
                ? [...c.ruleMapping, ...toAdd]
                : c.ruleMapping,
          };
        });
      } catch (error: unknown) {
        setError(`预览失败：${getErrorMessage(error)}`);
      }
    });
  };

  // 打开页面后自动提取一次规则类别（订阅地址非空且还没预览过时）
  const subKey = config.subscriptions.map((s) => s.url).join("|");
  useEffect(() => {
    if (!subKey || preview || loading) return;
    const timer = window.setTimeout(runPreview, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subKey]);

  /* --- 保存到云端：首次生成固定链接，以后原链接更新 --- */
  const saveConfig = async () => {
    setCloudLoading(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "保存失败");
        return;
      }
      if (typeof data.id !== "string" || typeof data.editKey !== "string") {
        setError("保存服务返回的数据无效");
        return;
      }
      const nextSaved = {
        id: data.id,
        editKey: data.editKey,
        url: `/api/sub?id=${data.id}`,
      };
      setSaved(nextSaved);
      setSavedConfig(config);
      setNotice("订阅链接已生成。以后修改后点“更新已保存配置”，链接不会变化。");
    } catch (error: unknown) {
      setError(`保存失败：${getErrorMessage(error)}`);
    } finally {
      setCloudLoading(false);
    }
  };

  const updateSaved = async () => {
    if (!saved) return;
    setCloudLoading(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: saved.id,
          editKey: saved.editKey,
          config,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "更新失败");
        return;
      }
      setSavedConfig(config);
      setNotice("已更新云端保存的配置，刷新 Clash 订阅即可生效。");
    } catch (error: unknown) {
      setError(`更新失败：${getErrorMessage(error)}`);
    } finally {
      setCloudLoading(false);
    }
  };

  /** 从“UUID 编辑凭证”解析可编辑配置。 */
  const parseConfigReference = (input: string) => {
    const value = input.trim();
    const [id, editKey = ""] = value.split(/\s+/, 2);
    return /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)
      ? { id, editKey }
      : null;
  };

  const loadConfig = async () => {
    setCloudLoading(true);
    setError("");
    setNotice("");
    const reference = parseConfigReference(loadInput);
    if (!reference) {
      setError("无法解析：请粘贴备份的“UUID 编辑凭证”");
      setCloudLoading(false);
      return;
    }
    if (reference.editKey.length < 32) {
      setError("加载并编辑配置需要“UUID 编辑凭证”；单独的订阅链接只能给 Clash 使用");
      setCloudLoading(false);
      return;
    }
    try {
      const res = await fetch(
        `/api/config?id=${encodeURIComponent(reference.id)}`,
        { headers: { "X-RouteX-Edit-Key": reference.editKey } },
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "加载失败");
        return;
      }
      setConfig(data.config);
      setSaved({
        id: data.id,
        editKey: reference.editKey,
        url: `/api/sub?id=${data.id}`,
      });
      setSavedConfig(data.config);
      setNotice("已加载配置，可以继续更新原订阅链接。");
    } catch (error: unknown) {
      setError(`加载失败：${getErrorMessage(error)}`);
    } finally {
      setCloudLoading(false);
    }
  };

  const groupNames = useMemo(
    () => {
      const reserved = new Set<string>(ALWAYS_AVAILABLE_TARGETS);
      return Array.from(
        new Set(config.groups.map((g) => g.name.trim()).filter(Boolean)),
      ).filter((name) => !reserved.has(name));
    },
    [config.groups],
  );
  const sourceGroupNames = useMemo(
    () => (preview?.sourceGroups ?? []).map((group) => group.name),
    [preview?.sourceGroups],
  );
  const nodeNames = useMemo(() => {
    const reserved = new Set<string>([
      ...ALWAYS_AVAILABLE_TARGETS,
      ...sourceGroupNames,
      ...groupNames,
    ]);
    return Array.from(new Set(preview?.allNodes ?? [])).filter(
      (name) => !reserved.has(name),
    );
  }, [groupNames, preview?.allNodes, sourceGroupNames]);
  const mappedTargets = (cat: string) => {
    const mapping = config.ruleMapping.find((item) => item.category === cat);
    if (!mapping) return [];
    const targets = mapping.targets?.length
      ? mapping.targets
      : mapping.group
        ? [mapping.group]
        : [];
    return targets.some((target) =>
      (LEGACY_POLICY_TARGETS as readonly string[]).includes(target),
    )
      ? nodeNames
      : targets;
  };
  const applyRecommendedTargets = () => {
    if (!preview) return;
    setConfig((c) => ({
      ...c,
      ruleMapping: preview.categories.map((category) => {
        const targets = suggestTargets(category, c.groups, nodeNames);
        return { category, group: targets[0] ?? "", targets };
      }),
    }));
  };
  const savedConfigIsCurrent =
    savedConfig !== null &&
    JSON.stringify(savedConfig) === JSON.stringify(config);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-4xl px-4 py-10">
        <header className="mb-8">
          <h1 className="text-2xl font-bold">RouteX · 订阅聚合 · 规则可视化配置</h1>
          <p className="mt-1 text-sm text-zinc-400">
            保留 iKuuu 原始规则，自动识别所有导入节点；每个策略组可同时选择多个节点或节点组。
          </p>
        </header>

        <div className="space-y-6">
          {/* 订阅设置 */}
          <Section
            title="① 订阅来源"
            desc="所有订阅的节点会合并去重。规则使用内置的 iKuuu 基础规则集，不依赖任何订阅。"
          >
            <div className="space-y-3">
              {config.subscriptions.map((s, i) => (
                <div
                  key={i}
                  className="flex flex-col gap-2 rounded-lg border border-zinc-800 p-3 sm:flex-row sm:items-center"
                >
                  <input
                    className={inputCls}
                    placeholder="订阅 URL（带 token）"
                    value={s.url}
                    onChange={(e) => setSub(i, "url", e.target.value)}
                  />
                  <input
                    className={`${inputCls} sm:w-40`}
                    placeholder="备注（可选）"
                    value={s.label ?? ""}
                    onChange={(e) => setSub(i, "label", e.target.value)}
                  />
                  <button
                    className="shrink-0 text-zinc-500 transition-colors hover:text-red-400"
                    onClick={() => removeSub(i)}
                    disabled={config.subscriptions.length <= 1}
                  >
                    删除
                  </button>
                </div>
              ))}
              <button className={btnGhost} onClick={addSub}>
                + 添加订阅
              </button>
            </div>
          </Section>

          {/* 节点组 */}
          <Section
            title="② 节点管理"
            desc="每个导入订阅会自动成为一个节点组。下面也可以按名称筛选或手动勾选节点，供后面的规则选择。"
          >
            {preview && preview.sourceGroups.length > 0 && (
              <div className="mb-5">
                <h3 className="text-sm font-medium text-zinc-200">
                  导入的订阅节点组
                </h3>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {preview.sourceGroups.map((group) => (
                    <div
                      key={group.name}
                      className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm"
                    >
                      <span className="truncate text-zinc-300">{group.name}</span>
                      <span className="shrink-0 text-xs text-zinc-500">
                        {group.nodes.length} 个节点
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h3 className="mr-auto text-sm font-medium text-zinc-200">
                自定义节点组（可选）
              </h3>
              <button
                type="button"
                className={btnPrimary}
                onClick={addManualGroup}
              >
                + 新建节点组
              </button>
            </div>
            <div className="mb-3 flex flex-wrap gap-2">
              <span className="self-center text-sm text-zinc-500">快捷添加：</span>
              {GROUP_PRESETS.map((p) => (
                <button
                  key={p.label}
                  className={`${btnGhost} !px-3 !py-1 text-xs`}
                  onClick={() => addPreset(p)}
                >
                  + {p.label}
                </button>
              ))}
            </div>
            <div className="space-y-2">
              {config.groups.map((g, i) => {
                const matched = preview?.groups.find(
                  (x) => x.name === g.name,
                )?.nodes;
                return (
                  <div key={g.id} className="rounded-lg border border-zinc-800 p-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <input
                        className={`${inputCls} sm:w-44`}
                        value={g.name}
                        onChange={(e) => updateGroup(i, { name: e.target.value })}
                        placeholder="组名"
                      />
                      <select
                        className={`${inputCls} sm:w-32`}
                        value={g.type}
                        onChange={(e) =>
                          updateGroup(i, { type: e.target.value as GroupType })
                        }
                      >
                        <option value="auto">按名称筛选</option>
                        <option value="manual">手动选择</option>
                        <option value="all">全部节点</option>
                      </select>
                      {g.type === "auto" && (
                        <input
                          className={`${inputCls} flex-1 font-mono`}
                          value={g.pattern ?? ""}
                          onChange={(e) =>
                            updateGroup(i, { pattern: e.target.value })
                          }
                          placeholder="正则，如 新加坡|🇸🇬|[-.]sg\d"
                        />
                      )}
                      {matched !== undefined && (
                        <span className="shrink-0 text-xs text-zinc-500">
                          匹配 {matched.length} 个节点
                        </span>
                      )}
                      <button
                        className="shrink-0 text-zinc-500 transition-colors hover:text-red-400"
                        onClick={() => removeGroup(i)}
                      >
                        删除
                      </button>
                    </div>
                    {g.type === "manual" && (
                      <div className="mt-3 border-t border-zinc-800 pt-3">
                        {!preview ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm text-zinc-500">
                              先识别订阅节点，再勾选这个组包含的节点。
                            </p>
                            <button
                              type="button"
                              className={`${btnGhost} !px-3 !py-1 text-xs`}
                              onClick={runPreview}
                              disabled={loading}
                            >
                              {loading ? "识别中…" : "识别节点"}
                            </button>
                          </div>
                        ) : (
                          <NodePicker
                            allNodes={preview.allNodes}
                            selected={g.nodes ?? []}
                            onChange={(nodes) => updateGroup(i, { nodes })}
                          />
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Section>

          {/* 规则管理 */}
          <Section
            title="③ 规则管理"
            desc="基础规则和新加规则统一在这里管理；每一类规则都在右侧选择要走的节点、节点组、直连或拒绝。"
          >
            <h3 className="text-sm font-semibold text-zinc-100">
              A. iKuuu 基础规则
            </h3>
            <p className="mt-1 text-sm text-zinc-500">
              使用项目内置的 iKuuu 规则集，包括动画疯、爱奇艺&哔哩哔哩、选择节点、国内网站等；这些名称会保留为 Clash 策略组，这里选择各组内部使用的节点目标。
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              每个规则策略组可以同时选择多个单节点、导入订阅组或自定义节点组；生成后可在 Clash 中切换。
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className={btnPrimary} onClick={runPreview} disabled={loading}>
                {loading
                  ? "识别中…"
                  : preview
                    ? "重新识别节点 / 读取规则"
                    : "自动识别节点 / 读取规则"}
              </button>
              {preview && (
                <button className={btnGhost} onClick={applyRecommendedTargets}>
                  应用推荐默认值
                </button>
              )}
            </div>

            {preview && (
              <>
                <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-800/40 p-3 text-sm">
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    <span>
                      节点{" "}
                      <b className="text-zinc-100">{preview.allNodes.length}</b>
                    </span>
                    <span>
                      内置基础规则{" "}
                      <b className="text-zinc-100">{preview.baseRuleCount}</b> 条
                    </span>
                    <span>
                      规则类别{" "}
                      <b className="text-zinc-100">{preview.categories.length}</b>
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
                    {preview.subscriptions.map((s) => (
                      <span key={s.index}>
                        订阅 {s.index + 1}
                        {s.label ? `（${s.label}）` : ""}：{s.nodeCount} 节点
                      </span>
                    ))}
                  </div>
                </div>

                {preview.allNodes.length > 0 && (
                  <details className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
                    <summary className="cursor-pointer text-sm text-zinc-300">
                      查看识别到的 {preview.allNodes.length} 个节点
                    </summary>
                    <div className="mt-3 flex max-h-48 flex-wrap gap-2 overflow-y-auto">
                      {preview.allNodes.map((name) => (
                        <span
                          key={name}
                          className="rounded-md bg-zinc-800 px-2 py-1 text-xs text-zinc-300"
                        >
                          {name}
                        </span>
                      ))}
                    </div>
                  </details>
                )}

                {preview.categories.length > 0 ? (
                  <div className="mt-4 space-y-2">
                    {preview.categories.map((cat) => (
                      <div
                        key={cat}
                        className="flex flex-col gap-2 rounded-lg border border-zinc-800 p-3 sm:flex-row sm:items-center"
                      >
                        <div className="flex-1 truncate text-sm text-zinc-200">
                          {cat}
                        </div>
                        <MultiRuleTargetPicker
                          selected={mappedTargets(cat)}
                          sourceGroups={preview.sourceGroups}
                          customGroups={preview.groups}
                          nodeNames={nodeNames}
                          onChange={(targets) => upsertMapping(cat, targets)}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-4 text-sm text-zinc-500">
                    内置基础规则里没有提取到规则类别（可能规则集格式有变化）。
                  </p>
                )}
              </>
            )}

            <div className="mt-8 border-t border-zinc-800 pt-6">
              <h3 className="text-sm font-semibold text-zinc-100">
                B. 新加 Host / IP 规则（最高优先级）
              </h3>
              <p className="mt-1 text-sm text-zinc-500">
                可以一次粘贴多个 Host、域名或 IP；每行一个，整批共用右侧选择的节点目标。IP-CIDR 会自动补 /32 和 no-resolve。
              </p>
              <div className="mt-4 space-y-2">
              {config.customRules.map((r, i) => (
                <div
                  key={i}
                  className="flex flex-col gap-2 rounded-lg border border-zinc-800 p-3 sm:flex-row sm:items-center"
                >
                  <select
                    className={`${inputCls} sm:w-40`}
                    value={r.type}
                    onChange={(e) =>
                      updateCustom(i, {
                        type: e.target.value as CustomRule["type"],
                      })
                    }
                  >
                    {RULE_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <textarea
                    rows={2}
                    className={`${inputCls} flex-1 font-mono`}
                    value={r.value}
                    placeholder={
                      r.type === "RAW"
                        ? "完整规则行，每行一条"
                        : "可批量粘贴域名 / IP，每行一个（也支持空格或逗号）"
                    }
                    onChange={(e) => updateCustom(i, { value: e.target.value })}
                  />
                  <select
                    className={`${inputCls} sm:w-72`}
                    value={r.group}
                    onChange={(e) => updateCustom(i, { group: e.target.value })}
                  >
                    <option value="" disabled>
                      选择节点 / 节点组 / 直连
                    </option>
                    <RuleTargetOptions
                      currentValue={r.group}
                      sourceGroupNames={sourceGroupNames}
                      groupNames={groupNames}
                      nodeNames={nodeNames}
                    />
                  </select>
                  <button
                    className="shrink-0 text-zinc-500 transition-colors hover:text-red-400"
                    onClick={() => removeCustom(i)}
                  >
                    删除
                  </button>
                </div>
              ))}
              <button className={btnGhost} onClick={addCustom}>
                + 添加一批规则
              </button>
              </div>
            </div>
          </Section>

          {/* 生成 */}
          <Section
            title="④ 生成订阅链接"
            desc="首次保存生成固定链接；以后修改规则或节点后更新同一份配置，Clash 中的订阅链接不会变化。"
          >
            <div>
              <div className="flex flex-col gap-2 sm:flex-row">
                {saved ? (
                  <button
                    className={btnPrimary}
                    onClick={updateSaved}
                    disabled={loading || savedConfigIsCurrent}
                  >
                    {loading
                      ? "更新中…"
                      : savedConfigIsCurrent
                        ? "已是最新配置（链接不变）"
                        : "更新已保存配置（链接不变）"}
                  </button>
                ) : (
                  <button
                    className={btnPrimary}
                    onClick={saveConfig}
                    disabled={loading}
                  >
                    {loading ? "保存中…" : "保存并生成订阅链接"}
                  </button>
                )}
                {saved && (
                  <button
                    className={btnGhost}
                    onClick={saveConfig}
                    disabled={loading}
                  >
                    另存为新链接
                  </button>
                )}
              </div>

              {saved && (
                <div className="mt-3 space-y-2">
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      readOnly
                      className={`${inputCls} flex-1 font-mono text-xs`}
                      value={`${window.location.origin}${saved.url}`}
                      onFocus={(e) => e.currentTarget.select()}
                    />
                    <button
                      className={btnGhost}
                      onClick={() =>
                        navigator.clipboard.writeText(
                          `${window.location.origin}${saved.url}`,
                        )
                      }
                    >
                      复制短链
                    </button>
                  </div>
                  <p className="text-xs text-zinc-500">
                    把这个固定链接填进 Clash。更新配置后只需在 Clash 刷新订阅。
                  </p>
                  <details className="text-xs text-zinc-500">
                    <summary className="cursor-pointer">备份配置编辑凭证</summary>
                    <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                      <input
                        readOnly
                        className={`${inputCls} flex-1 font-mono text-xs`}
                        value={`${saved.id} ${saved.editKey}`}
                        onFocus={(event) => event.currentTarget.select()}
                      />
                      <button
                        className={btnGhost}
                        onClick={() =>
                          navigator.clipboard.writeText(
                            `${saved.id} ${saved.editKey}`,
                          )
                        }
                      >
                        复制编辑凭证
                      </button>
                    </div>
                  </details>
                </div>
              )}

              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <input
                  className={`${inputCls} flex-1 font-mono text-xs`}
                  placeholder="粘贴“UUID 编辑凭证”"
                  value={loadInput}
                  onChange={(e) => setLoadInput(e.target.value)}
                />
                <button className={btnGhost} onClick={loadConfig} disabled={loading}>
                  从编辑凭证加载
                </button>
              </div>
            </div>

            {notice && (
              <p className="mt-4 rounded-lg border border-amber-900 bg-amber-950/40 p-3 text-sm text-amber-300">
                {notice}
              </p>
            )}
            {error && (
              <p className="mt-4 rounded-lg border border-red-900 bg-red-950/40 p-3 text-sm text-red-300">
                {error}
              </p>
            )}
            {preview?.warnings && preview.warnings.length > 0 && (
              <ul className="mt-4 space-y-1 text-sm text-amber-300">
                {preview.warnings.map((w, i) => (
                  <li key={i}>⚠️ {w}</li>
                ))}
              </ul>
            )}
          </Section>
        </div>

        <footer className="mt-10 text-center text-xs text-zinc-600">
          编辑草稿保存在浏览器本地；配置可保存到 Supabase，订阅拉取由 /api/sub 在服务端完成。
        </footer>
      </div>
    </div>
  );
}
