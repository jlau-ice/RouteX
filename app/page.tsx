"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  AppConfig,
  CustomRule,
  GroupType,
  NodeGroup,
  PreviewResult,
} from "@/lib/types";
import { buildDefaultConfig } from "@/lib/defaults";

const LS_KEY = "clash-agg-config-v1";

/* ---------- 工具 ---------- */

/** 把配置编码成可放进 URL 的 base64url（deflate 压缩） */
async function encodeConfig(config: AppConfig): Promise<string> {
  const json = JSON.stringify(config);
  const stream = new Blob([json])
    .stream()
    .pipeThrough(new CompressionStream("deflate"));
  const buf = await new Response(stream).arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 给某个基础规则类别推荐一个默认承接组 */
function suggestGroupName(category: string, groups: NodeGroup[]): string {
  const byType = (t: GroupType) => groups.find((g) => g.type === t)?.name;
  const byName = (re: RegExp) => groups.find((g) => re.test(g.name))?.name;
  if (/国内|直连/.test(category))
    return byType("direct") ?? byName(/直连/) ?? groups[0]?.name ?? "";
  if (/广告|拦截/.test(category))
    return byType("reject") ?? byType("direct") ?? byName(/拒绝/) ?? "";
  if (/动画疯|巴哈|台湾/.test(category))
    return byName(/台湾/) ?? byType("all") ?? groups[0]?.name ?? "";
  if (/选择节点|漏网|全局/.test(category))
    return byType("all") ?? groups[0]?.name ?? "";
  return byType("all") ?? groups[0]?.name ?? "";
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
  return (
    <div>
      <div className="flex items-center gap-2">
        <input
          className={inputCls}
          placeholder="搜索节点…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="shrink-0 text-xs text-zinc-500">
          已选 {selected.length} / {allNodes.length}
        </span>
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
  {
    label: "直连",
    def: () => ({ id: "direct", name: "直连", type: "direct" }),
  },
  {
    label: "拒绝",
    def: () => ({ id: "reject", name: "拒绝", type: "reject" }),
  },
];

const RULE_TYPES = ["DOMAIN-SUFFIX", "DOMAIN", "DOMAIN-KEYWORD", "IP-CIDR", "RAW"];

/* ---------- 页面 ---------- */

export default function Home() {
  const [config, setConfig] = useState<AppConfig>(buildDefaultConfig);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [subUrl, setSubUrl] = useState("");
  const [notice, setNotice] = useState("");
  const [saved, setSaved] = useState<{
    id: string;
    k: string;
    url: string;
    loadUrl: string;
  } | null>(null);
  const [loadInput, setLoadInput] = useState("");

  // 从 localStorage 恢复
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.version === 1) setConfig(parsed);
      }
    } catch {}
  }, []);

  // 持久化
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(config));
    } catch {}
  }, [config]);

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

  /* --- 规则映射 --- */
  const upsertMapping = (category: string, group: string) =>
    setConfig((c) => {
      const exists = c.ruleMapping.some((m) => m.category === category);
      const ruleMapping = exists
        ? c.ruleMapping.map((m) =>
            m.category === category ? { ...m, group } : m,
          )
        : [...c.ruleMapping, { category, group }];
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
        { type: "DOMAIN-SUFFIX", value: "", group: c.groups[0]?.name ?? "" },
      ],
    }));

  /* --- 预览 --- */
  const runPreview = async () => {
    setLoading(true);
    setError("");
    setNotice("");
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
          .map((cat) => ({
            category: cat,
            group: suggestGroupName(cat, c.groups),
          }))
          .filter((m) => m.group);
        if (toAdd.length === 0) return c;
        return { ...c, ruleMapping: [...c.ruleMapping, ...toAdd] };
      });
    } catch (e: any) {
      setError(`预览失败：${e?.message ?? e}`);
    } finally {
      setLoading(false);
    }
  };

  // 打开页面后自动提取一次规则类别（订阅地址非空且还没预览过时）
  const subKey = config.subscriptions.map((s) => s.url).join("|");
  useEffect(() => {
    if (!subKey || preview || loading) return;
    runPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subKey]);

  /* --- 生成订阅链接 --- */
  const generate = async () => {
    setLoading(true);
    setError("");
    setNotice("");
    if (config.ruleMapping.length === 0) {
      setNotice(
        "基础规则尚未映射：所有基础规则将落到默认「🚀 选择节点」组。建议先点「预览/提取规则」为每个类别选承接组，再生成。",
      );
    }
    try {
      const encoded = await encodeConfig(config);
      setSubUrl(`${window.location.origin}/api/sub?c=${encoded}`);
    } catch (e: any) {
      setError(`生成失败：${e?.message ?? e}`);
    } finally {
      setLoading(false);
    }
  };

  /* --- 保存到云端 --- */
  const saveConfig = async () => {
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "保存失败");
        return;
      }
      setSaved(data);
    } catch (e: any) {
      setError(`保存失败：${e?.message ?? e}`);
    } finally {
      setLoading(false);
    }
  };

  const updateSaved = async () => {
    if (!saved) return;
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const res = await fetch("/api/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: saved.id, k: saved.k, config }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "更新失败");
        return;
      }
      setNotice("已更新云端保存的配置，刷新 Clash 订阅即可生效。");
    } catch (e: any) {
      setError(`更新失败：${e?.message ?? e}`);
    } finally {
      setLoading(false);
    }
  };

  /** 从链接 / 或 “id k” 解析出 id 与 secret */
  const parseIdKey = (input: string) => {
    const urlMatch = input.match(/[?&]id=([^&]+)&[^]*?k=([^&]+)/);
    if (urlMatch) return { id: urlMatch[1], k: urlMatch[2] };
    const bare = input.trim().split(/\s+/);
    if (bare.length === 2) return { id: bare[0], k: bare[1] };
    return null;
  };

  const loadConfig = async () => {
    setLoading(true);
    setError("");
    setNotice("");
    const parsed = parseIdKey(loadInput);
    if (!parsed) {
      setError("无法解析：请粘贴 /api/sub?id=..&k=.. 链接，或输入 “id k”");
      setLoading(false);
      return;
    }
    try {
      const res = await fetch(`/api/load?id=${encodeURIComponent(parsed.id)}&k=${encodeURIComponent(parsed.k)}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "加载失败");
        return;
      }
      setConfig(data.config);
      setSaved({
        id: data.id,
        k: parsed.k,
        url: `${window.location.origin}/api/sub?id=${data.id}&k=${parsed.k}`,
        loadUrl: `${window.location.origin}/api/load?id=${data.id}&k=${parsed.k}`,
      });
      setNotice(`已加载配置“${data.name ?? "未命名"}”。`);
    } catch (e: any) {
      setError(`加载失败：${e?.message ?? e}`);
    } finally {
      setLoading(false);
    }
  };

  const groupNames = useMemo(
    () => config.groups.map((g) => g.name),
    [config.groups],
  );
  const mappedGroup = (cat: string) =>
    config.ruleMapping.find((m) => m.category === cat)?.group ?? "";

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-4xl px-4 py-10">
        <header className="mb-8">
          <h1 className="text-2xl font-bold">RouteX · 订阅聚合 · 规则可视化配置</h1>
          <p className="mt-1 text-sm text-zinc-400">
            多个订阅合并成一个；基础规则按类别承接节点组；配置编码进订阅链接，无需数据库。
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
            title="② 节点组"
            desc="“自动”用正则挑节点；“手动”可逐个打勾选节点。生成后可在 Clash 里手动切换具体节点。"
          >
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
                        <option value="auto">自动识别</option>
                        <option value="manual">手动选择</option>
                        <option value="all">全部节点</option>
                        <option value="direct">直连</option>
                        <option value="reject">拒绝</option>
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
                          <p className="text-sm text-zinc-500">
                            先点击下方「预览 / 提取规则」加载节点列表，再手动勾选要承接的节点。
                          </p>
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

          {/* 基础规则映射 */}
          <Section
            title="③ 内置基础规则 → 节点组"
            desc="基础规则来自内置的 iKuuu 规则集（自动提取类别）。为每个类别选择承接的节点组；未选中的类别会落到默认组。"
          >
            <button className={btnPrimary} onClick={runPreview} disabled={loading}>
              {loading
                ? "处理中…"
                : preview
                  ? "重新预览 / 提取规则"
                  : "预览 / 提取规则"}
            </button>

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
                        <select
                          className={`${inputCls} sm:w-52`}
                          value={mappedGroup(cat)}
                          onChange={(e) => upsertMapping(cat, e.target.value)}
                        >
                          <option value="" disabled>
                            选择承接节点组
                          </option>
                          {groupNames.map((n) => (
                            <option key={n} value={n}>
                              {n}
                            </option>
                          ))}
                        </select>
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
          </Section>

          {/* 自定义规则 */}
          <Section
            title="④ 自定义规则（最高优先级）"
            desc="新增的规则会排在所有规则最前面。IP-CIDR 会自动补 /32 并加 no-resolve。"
          >
            <div className="space-y-2">
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
                  <input
                    className={`${inputCls} flex-1 font-mono`}
                    value={r.value}
                    placeholder={
                      r.type === "RAW"
                        ? "完整规则行，如 DOMAIN-KEYWORD,openai,组名"
                        : "域名 / IP"
                    }
                    onChange={(e) => updateCustom(i, { value: e.target.value })}
                  />
                  <select
                    className={`${inputCls} sm:w-44`}
                    value={r.group}
                    onChange={(e) => updateCustom(i, { group: e.target.value })}
                  >
                    <option value="" disabled>
                      选择节点组
                    </option>
                    {groupNames.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
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
                + 添加规则
              </button>
            </div>
          </Section>

          {/* 生成 */}
          <Section
            title="⑤ 生成订阅链接"
            desc="两种方式：base64 链接（离线可用）或保存到 Supabase 生成短链。基础订阅更新节点时，Clash 刷新该地址即可拿到最新合并结果。"
          >
            <button className={btnPrimary} onClick={generate} disabled={loading}>
              生成订阅链接
            </button>

            {subUrl && (
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <input
                  readOnly
                  className={`${inputCls} flex-1 font-mono text-xs`}
                  value={subUrl}
                  onFocus={(e) => e.currentTarget.select()}
                />
                <button
                  className={btnGhost}
                  onClick={() => navigator.clipboard.writeText(subUrl)}
                >
                  复制
                </button>
                <a className={btnGhost} href={subUrl} target="_blank" rel="noreferrer">
                  查看 YAML
                </a>
              </div>
            )}

            <div className="mt-6 border-t border-zinc-800 pt-4">
              <p className="text-sm text-zinc-400">
                保存到 Supabase 生成短链；改完配置点「更新」即可。
              </p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <button
                  className={btnPrimary}
                  onClick={saveConfig}
                  disabled={loading}
                >
                  💾 保存配置 / 生成短链
                </button>
                {saved && (
                  <button
                    className={btnGhost}
                    onClick={updateSaved}
                    disabled={loading}
                  >
                    更新已保存配置
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
                    把这个短链填进 Clash 订阅即可。链接里的 k
                    是访问密钥，请勿公开分享。
                  </p>
                </div>
              )}

              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <input
                  className={`${inputCls} flex-1 font-mono text-xs`}
                  placeholder="粘贴已保存的链接，或输入 “id k”"
                  value={loadInput}
                  onChange={(e) => setLoadInput(e.target.value)}
                />
                <button className={btnGhost} onClick={loadConfig} disabled={loading}>
                  从链接加载
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
          配置可保存到 Supabase（短链）或编码进链接（离线）；订阅拉取由 /api/sub 在服务端完成。
        </footer>
      </div>
    </div>
  );
}
