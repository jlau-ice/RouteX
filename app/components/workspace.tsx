"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AppConfig,
  NodeGroup,
  PreviewResult,
  SubscriptionSource,
  StorageMode,
} from "@/lib/types";
import { buildDefaultConfig } from "@/lib/defaults";
import { publishChanges } from "@/lib/routing-editor";
import RulesWorkspace from "./rules-workspace";
import { isDraftConfig, validateAppConfig } from "@/lib/config-validation";
import {
  AUTO_GROUP,
  MAIN_GROUP,
  defaultCategoryTarget,
  matchGroupNodes,
  sourceGroupNames,
  sourceId,
} from "@/lib/policies";
import {
  Empty,
  Field,
  Icon,
  MultiTarget,
  NodePicker,
  type IconName,
  type TargetSection,
} from "./ui";

const DRAFT_KEY = "clash-agg-config-v1";
const SAVED_KEY = "routex-saved-config-v1";
type Saved = {
  id: string;
  editKey: string;
  url: string;
  config: AppConfig;
  storage?: StorageMode;
};
type View = "sources" | "nodes" | "rules" | "publish";
const VIEWS: { id: View; title: string; en: string; icon: IconName }[] = [
  { id: "sources", title: "订阅来源", en: "SUBSCRIPTIONS", icon: "layers" },
  { id: "nodes", title: "节点与策略组", en: "PROXY GROUPS", icon: "nodes" },
  { id: "rules", title: "分流规则", en: "ROUTING RULES", icon: "rules" },
  { id: "publish", title: "发布与同步", en: "PUBLISH", icon: "send" },
];
const REGIONS = [
  { name: "香港节点", pattern: "香港|🇭🇰|(?:^|[-. ])hk" },
  { name: "日本节点", pattern: "日本|🇯🇵|(?:^|[-. ])jp" },
  { name: "台湾节点", pattern: "台湾|🇹🇼|(?:^|[-. ])tw" },
  { name: "新加坡节点", pattern: "新加坡|🇸🇬|(?:^|[-. ])sg" },
  { name: "美国节点", pattern: "美国|🇺🇸|🇺🇲|(?:^|[-. ])(?:us|sv)" },
];
const formatNumber = (value: number) => value.toLocaleString("en-US");
const fingerprint = (config: AppConfig) => JSON.stringify(config.subscriptions);
function withIds(config: AppConfig): AppConfig {
  return {
    ...config,
    subscriptions: config.subscriptions.map((source, index) => ({
      ...source,
      id: sourceId(source, index),
    })),
  };
}
function validSaved(value: unknown): value is Saved {
  if (!value || typeof value !== "object") return false;
  const saved = value as Saved;
  return (
    typeof saved.id === "string" &&
    /^[0-9a-f-]{36}$/i.test(saved.id) &&
    typeof saved.editKey === "string" &&
    saved.editKey.length >= 32
  );
}
async function jsonRequest<T>(url: string, options: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(55_000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "请求失败，请重试");
  return data as T;
}
function downloadFile(name: string, value: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([value], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function replaceTargets(
  config: AppConfig,
  rename: (target: string) => string,
): AppConfig {
  return {
    ...config,
    groups: config.groups.map((group) => ({
      ...group,
      nodes: group.nodes?.map(rename),
      preferred: group.preferred ? rename(group.preferred) : undefined,
    })),
    ruleMapping: config.ruleMapping.map((rule) => ({
      ...rule,
      group: rename(rule.group),
      targets: rule.targets?.map(rename),
    })),
    customRules: config.customRules.map((rule) =>
      rule.type !== "RAW"
        ? { ...rule, group: rename(rule.group) }
        : {
            ...rule,
            group: rename(rule.group),
            value: rule.value
              .split("\n")
              .map((line) => {
                const parts = line.split(",");
                const index =
                  parts.at(-1)?.trim() === "no-resolve"
                    ? parts.length - 2
                    : parts.length - 1;
                if (index > 0) parts[index] = rename(parts[index].trim());
                return parts.join(",");
              })
              .join("\n"),
          },
    ),
  };
}

export default function Workspace({
  baseCounts,
  baseCount,
  storageMode,
}: {
  baseCounts: Record<string, number>;
  baseCount: number;
  storageMode: StorageMode;
}) {
  const localDatabase = storageMode === "postgres";
  const savedKey = localDatabase ? `${SAVED_KEY}-postgres` : SAVED_KEY;
  const storageLabel = localDatabase ? "本机数据库" : "云端";
  const [config, setConfig] = useState<AppConfig>(buildDefaultConfig);
  const [ready, setReady] = useState(false);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [preview, setPreview] = useState<{
    key: string;
    data: PreviewResult;
  } | null>(null);
  const [view, setView] = useState<View>("sources");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState<{
    text: string;
    error?: boolean;
  } | null>(null);
  const [bulk, setBulk] = useState("");
  const [importing, setImporting] = useState(false);
  const [loadInput, setLoadInput] = useState("");
  const [origin, setOrigin] = useState("");
  const [yamlText, setYamlText] = useState("");
  const [storageFailed, setStorageFailed] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);

  const fetchPreview = useCallback(async (draft: AppConfig) => {
    const issue = validateAppConfig(draft);
    if (issue) throw new Error(issue);
    const id = ++requestId.current;
    const data = await jsonRequest<PreviewResult>("/api/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: draft }),
    });
    if (requestId.current === id) setPreview({ key: fingerprint(draft), data });
    return data;
  }, []);
  const restoreSaved = useCallback(
    async (id: string, editKey: string) => {
      const data = await jsonRequest<{ id: string; config: AppConfig }>(
        `/api/config?id=${encodeURIComponent(id)}`,
        { headers: { "X-RouteX-Edit-Key": editKey } },
      );
      const issue = validateAppConfig(data.config);
      if (issue) throw new Error(issue);
      const draft = withIds(data.config);
      setConfig(draft);
      setSaved({
        id: data.id,
        editKey,
        url: `/api/sub?id=${data.id}`,
        config: draft,
        storage: storageMode,
      });
      setPreview(null);
      setLoadInput("");
      setMessage({ text: "已恢复配置，可以继续更新原订阅链接。" });
      await fetchPreview(draft);
    },
    [fetchPreview, storageMode],
  );

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      setOrigin(window.location.origin);
      let draft = buildDefaultConfig();
      try {
        const raw = localStorage.getItem(DRAFT_KEY);
        if (raw) {
          const parsed: unknown = JSON.parse(raw);
          // 空白草稿允许恢复；其余结构必须完整，防止旧数据导致页面崩溃。
          if (isDraftConfig(parsed)) draft = withIds(parsed);
          else
            setMessage({
              text: "本地草稿格式已损坏，请从备份恢复。",
              error: true,
            });
        }
        const savedRaw = localStorage.getItem(savedKey);
        if (savedRaw) {
          const parsedSaved = JSON.parse(savedRaw);
          if (
            validSaved(parsedSaved) &&
            (parsedSaved.storage ?? "supabase") === storageMode
          )
            setSaved({
              ...parsedSaved,
              url: `/api/sub?id=${parsedSaved.id}`,
              config: isDraftConfig(parsedSaved.config)
                ? withIds(parsedSaved.config)
                : draft,
            });
        }
      } catch {
        setMessage({ text: "本地草稿无法读取，可从备份恢复。", error: true });
      }
      setConfig(draft);
      setReady(true);
      const edit = new URLSearchParams(window.location.hash.slice(1)).get(
        "edit",
      );
      if (edit) {
        const [id, key] = edit.split(".");
        window.history.replaceState(null, "", window.location.pathname);
        if (id && key) {
          setBusy("正在恢复配置");
          try {
            await restoreSaved(id, key);
          } catch (error) {
            setMessage({ text: (error as Error).message, error: true });
          } finally {
            setBusy("");
          }
        }
      } else if (!validateAppConfig(draft)) {
        setBusy("正在刷新节点");
        try {
          await fetchPreview(draft);
        } catch (error) {
          setMessage({ text: (error as Error).message, error: true });
        } finally {
          setBusy("");
        }
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchPreview, restoreSaved, savedKey, storageMode]);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(config));
      if (saved) localStorage.setItem(savedKey, JSON.stringify(saved));
      else localStorage.removeItem(savedKey);
    } catch {
      window.setTimeout(() => setStorageFailed(true), 0);
    }
  }, [config, saved, ready, savedKey]);

  const sourceKey = fingerprint(config);
  const currentPreview = preview?.key === sourceKey ? preview.data : null;
  const nodeNames = currentPreview?.allNodes ?? [];
  const sourceNames = sourceGroupNames(config.subscriptions);
  const sources =
    currentPreview?.sourceGroups ??
    config.subscriptions.map((source, index) => ({
      name: sourceNames[index],
      sourceId: sourceId(source, index),
      nodes: [],
    }));
  const groupMatches = useMemo(
    () =>
      config.groups.map((group) => ({
        name: group.name,
        nodes: matchGroupNodes(
          group,
          currentPreview?.allNodes ?? [],
          currentPreview?.sourceGroups ?? [],
        ),
      })),
    [config.groups, currentPreview],
  );
  const counts = currentPreview?.categoryCounts ?? baseCounts;
  const categories = Object.keys(counts);
  const sections: TargetSection[] = [
    { label: "内置策略", values: [MAIN_GROUP, AUTO_GROUP, "DIRECT", "REJECT"] },
    {
      label: "我的节点组",
      values: config.groups.map((group) => group.name).filter(Boolean),
    },
    { label: "订阅来源", values: sourceNames },
    { label: "单个节点", values: nodeNames },
  ];
  const dirty =
    !saved || JSON.stringify(config) !== JSON.stringify(saved.config);
  const subUrl = saved ? `${origin}/api/sub?id=${saved.id}` : "";
  const activeCount = config.subscriptions.filter(
    (source) => source.enabled !== false,
  ).length;

  const run = async (label: string, action: () => Promise<void>) => {
    if (busy) return;
    setBusy(label);
    setMessage(null);
    try {
      await action();
    } catch (error) {
      setMessage({
        text: error instanceof Error ? error.message : "操作失败，请重试",
        error: true,
      });
    } finally {
      setBusy("");
    }
  };
  const refresh = () =>
    run("正在刷新节点", async () => {
      const data = await fetchPreview(config);
      setMessage({
        text: data.allNodes.length
          ? `刷新完成，共识别 ${data.allNodes.length} 个节点。`
          : "没有获得节点，请检查下方订阅状态。",
        error: !data.allNodes.length,
      });
    });
  const copy = (text: string, label: string) =>
    run("正在复制", async () => {
      await navigator.clipboard.writeText(text);
      setMessage({ text: `${label}已复制。` });
    });
  const publish = (newLink = false) =>
    run("正在验证并发布", async () => {
      const draft = structuredClone(config);
      const result = await fetchPreview(draft);
      if (!result.allNodes.length)
        throw new Error("没有可用节点，请先检查订阅来源");
      const update = saved && !newLink;
      const data = await jsonRequest<{ id: string; editKey?: string }>(
        "/api/config",
        {
          method: update ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            update
              ? { config: draft, id: saved.id, editKey: saved.editKey }
              : { config: draft },
          ),
        },
      );
      const editKey = update ? saved.editKey : data.editKey;
      if (!editKey) throw new Error("保存服务未返回有效的编辑凭证");
      setSaved({
        id: data.id,
        editKey,
        url: `/api/sub?id=${data.id}`,
        config: draft,
        storage: storageMode,
      });
      setView("publish");
      setMessage({
        text: update
          ? "原链接已更新，在 Clash 中刷新订阅即可应用本次修改。"
          : "订阅链接已生成，可以导入 Clash 了。",
      });
    });
  const inspectYaml = () =>
    run("正在生成配置", async () => {
      const issue = validateAppConfig(config);
      if (issue) throw new Error(issue);
      const response = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config }),
        signal: AbortSignal.timeout(55_000),
      });
      const value = await response.text();
      if (!response.ok) throw new Error(value);
      setYamlText(value);
      setMessage({ text: "Clash 配置已生成，可预览或下载。" });
    });
  const patchSource = (index: number, patch: Partial<SubscriptionSource>) =>
    setConfig((previous) => {
      const before = sourceGroupNames(previous.subscriptions);
      const subscriptions = previous.subscriptions.map((source, i) =>
        i === index ? { ...source, ...patch } : source,
      );
      const after = sourceGroupNames(subscriptions);
      let next = { ...previous, subscriptions };
      if (patch.label !== undefined)
        next = replaceTargets(next, (target) => {
          for (let i = 0; i < before.length; i++) {
            if (target === before[i]) return after[i];
            const prefix = `[${before[i].replace(/^📦 /, "")}] `;
            if (target.startsWith(prefix))
              return `[${after[i].replace(/^📦 /, "")}] ${target.slice(prefix.length)}`;
          }
          return target;
        });
      return next;
    });
  const addSource = () =>
    setConfig((previous) => ({
      ...previous,
      subscriptions: [
        ...previous.subscriptions,
        {
          id: crypto.randomUUID(),
          label: `订阅 ${previous.subscriptions.length + 1}`,
          url: "",
          enabled: true,
        },
      ],
    }));
  const importSources = () => {
    const urls = bulk
      .split(/\s+/)
      .map((url) => url.trim())
      .filter(Boolean);
    if (
      !urls.length ||
      urls.some((url) => {
        try {
          return !["http:", "https:"].includes(new URL(url).protocol);
        } catch {
          return true;
        }
      })
    ) {
      setMessage({
        text: "请粘贴完整的 HTTP / HTTPS 订阅链接，每行一个。",
        error: true,
      });
      return;
    }
    const existing = new Set(config.subscriptions.map((source) => source.url));
    const added = [...new Set(urls)]
      .filter((url) => !existing.has(url))
      .map((url, index) => ({
        id: crypto.randomUUID(),
        url,
        label: `订阅 ${config.subscriptions.length + index + 1}`,
        enabled: true,
      }));
    if (config.subscriptions.length + added.length > 20) {
      setMessage({ text: "最多支持 20 个订阅来源。", error: true });
      return;
    }
    setConfig({
      ...config,
      subscriptions: [...config.subscriptions, ...added],
    });
    setBulk("");
    setImporting(false);
    setMessage({
      text: `已添加 ${added.length} 个订阅，点击“刷新节点”查看结果。`,
    });
  };
  const patchGroup = (index: number, patch: Partial<NodeGroup>) =>
    setConfig((previous) => {
      const old = previous.groups[index].name;
      const next = {
        ...previous,
        groups: previous.groups.map((group, i) =>
          i === index ? { ...group, ...patch } : group,
        ),
      };
      return patch.name !== undefined && patch.name !== old
        ? replaceTargets(next, (target) =>
            target === old ? patch.name! : target,
          )
        : next;
    });
  const addGroup = (preset?: { name: string; pattern: string }) =>
    setConfig((previous) => {
      let name = preset?.name ?? "自定义节点组";
      const base = name;
      let suffix = 2;
      while (previous.groups.some((group) => group.name === name))
        name = `${base} ${suffix++}`;
      return {
        ...previous,
        groups: [
          ...previous.groups,
          {
            id: crypto.randomUUID(),
            name,
            type: preset ? "auto" : "manual",
            pattern: preset?.pattern,
            nodes: [],
            strategy: "select",
          },
        ],
      };
    });
  const mapping = (category: string) =>
    config.ruleMapping.find((entry) => entry.category === category);
  const mapped = (category: string) => {
    const entry = mapping(category);
    return entry
      ? (entry.targets ?? (entry.group ? [entry.group] : []))
      : category === MAIN_GROUP
        ? sources
            .filter((source) =>
              currentPreview
                ? source.nodes.length > 0
                : config.subscriptions.some(
                    (item, index) =>
                      sourceId(item, index) === source.sourceId &&
                      item.enabled !== false,
                  ),
            )
            .map((source) => source.name)
        : [defaultCategoryTarget(category)];
  };
  const setMapping = (category: string, targets: string[]) =>
    setConfig((previous) => ({
      ...previous,
      ruleMapping: [
        ...previous.ruleMapping.filter((entry) => entry.category !== category),
        { category, group: targets[0] ?? "", targets },
      ],
    }));
  const importBackup = async (file?: File) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setMessage({ text: "备份文件不能超过 2 MiB。", error: true });
      return;
    }
    await run("正在导入备份", async () => {
      const value = JSON.parse(await file.text());
      const draft = value.config ?? value;
      const issue = validateAppConfig(draft);
      if (issue) throw new Error(issue);
      const next = withIds(draft);
      setConfig(next);
      setSaved(
        validSaved(value.saved) &&
          (value.saved.storage ?? "supabase") === storageMode
          ? {
              ...value.saved,
              url: `/api/sub?id=${value.saved.id}`,
              config: withIds(value.saved.config ?? draft),
            }
          : null,
      );
      setPreview(null);
      setYamlText("");
      setMessage({ text: "备份已导入。刷新节点后，可以继续编辑和发布。" });
    });
  };

  const currentView = VIEWS.find((item) => item.id === view)!;
  return (
    <div className="workspace">
      <a className="skip-link" href="#main">
        跳转到内容
      </a>
      <aside className="sidebar">
        <Link className="brand" href="/" aria-label="RouteX 首页">
          <span className="brand-mark">
            <Icon name="route" />
          </span>
          Route<span className="brand-x">X</span>
          <span className="brand-dot" />
        </Link>
        <div className="workspace-label">PERSONAL WORKSPACE</div>
        <nav aria-label="工作区导航">
          {VIEWS.map((item, index) => (
            <button
              key={item.id}
              className={`nav-item ${view === item.id ? "active" : ""}`}
              aria-current={view === item.id ? "page" : undefined}
              onClick={() => {
                setView(item.id);
                setYamlText("");
              }}
            >
              <Icon name={item.icon} />
              <span>{item.title}</span>
              <small>0{index + 1}</small>
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <div>
            <span className="status-dot" />
            默认规则模板
          </div>
          <p>
            参考 iKuuu · {formatNumber(baseCount)} 条
            <br />
            你的线路，由你决定。
          </p>
          <span className="engine-line" />
        </div>
        <div className="sidebar-bottom">
          <span className="avatar">RX</span>
          <div>
            个人配置空间
            <small>
              {localDatabase
                ? "LOCAL DRAFT + LOCAL DATABASE"
                : "LOCAL DRAFT + CLOUD SYNC"}
            </small>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            工作区 <span>/</span> <strong>{currentView.title}</strong>
          </div>
          <div className="top-actions">
            <span
              className={`draft-status ${storageFailed ? "danger-text" : ""}`}
            >
              <span className="status-dot" />
              {!ready
                ? "恢复草稿中"
                : storageFailed
                  ? "草稿未能保存"
                  : "草稿自动保存"}
            </span>
            <button
              className="icon-button"
              title="导入配置备份"
              aria-label="导入配置备份"
              onClick={() => fileInput.current?.click()}
              disabled={!!busy || !ready}
            >
              <Icon name="upload" />
            </button>
            <button
              className="icon-button"
              title="导出配置备份"
              aria-label="导出配置备份"
              disabled={!!busy || !ready}
              onClick={() => {
                downloadFile(
                  "routex-backup.json",
                  JSON.stringify({ version: 1, config, saved }, null, 2),
                );
                setMessage({
                  text: "备份已下载，包含订阅和编辑凭证，请妥善保管。",
                });
              }}
            >
              <Icon name="download" />
            </button>
            <input
              className="visually-hidden"
              type="file"
              accept=".json,application/json"
              ref={fileInput}
              aria-label="选择配置备份文件"
              onChange={(event) => {
                void importBackup(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </div>
        </header>
        <main id="main">
          {message && (
            <div
              role={message.error ? "alert" : "status"}
              className={`notice ${message.error ? "error" : ""}`}
            >
              <Icon name={message.error ? "shield" : "check"} />
              <span>{message.text}</span>
              <button
                aria-label="关闭提示"
                className="icon-button"
                onClick={() => setMessage(null)}
              >
                <Icon name="close" />
              </button>
            </div>
          )}
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {currentView.en} <span> / ROUTEX</span>
              </div>
              <h1>
                {currentView.title}
                <span className="heading-dot">.</span>
              </h1>
              <p>
                {view === "sources"
                  ? "把多个订阅汇成一个入口，让每一条线路各得其所。"
                  : view === "nodes"
                    ? "选择喜欢的节点，为不同用途建立专属线路。"
                    : view === "rules"
                      ? "先写下需要特殊处理的地址，其余流量交给默认分流模板。"
                      : "一个固定链接，让所有修改有处可达。"}
              </p>
            </div>
            <div className="heading-actions">
              <button
                className="button"
                disabled={!!busy || !ready || !activeCount}
                onClick={refresh}
              >
                <Icon
                  name="refresh"
                  className={busy === "正在刷新节点" ? "spinning" : ""}
                />
                {busy === "正在刷新节点" ? "刷新中…" : "刷新节点"}
              </button>
              <button
                className="button primary"
                disabled={!!busy || !ready || !activeCount}
                onClick={() => void publish()}
              >
                <Icon name="send" />
                {saved ? "发布更新" : "生成订阅"}
              </button>
            </div>
          </div>
          {busy && (
            <div className="busy-line" role="status">
              <span className="spinner" />
              {busy}…
            </div>
          )}
          <fieldset disabled={!!busy || !ready} className="workspace-fields">
            {view === "sources" && (
              <>
                <section className="connection-banner">
                  <div>
                    <span className="pill">
                      <span className="status-dot" /> ONE LINK. YOUR ROUTES.
                    </span>
                    <h2>
                      好线路，
                      <br />
                      在这里<span>汇合。</span>
                    </h2>
                    <p>
                      默认分流，按需定制。
                      <br />
                      聚合你的订阅，保留你的选择。
                    </p>
                    <button
                      className="text-button"
                      onClick={() => setView("rules")}
                    >
                      添加我的规则 <Icon name="arrow" />
                    </button>
                  </div>
                  <div className="route-visual" aria-hidden="true">
                    <div className="route-source source-one">
                      <Icon name="layers" />
                      <span>日常订阅</span>
                      <i />
                    </div>
                    <div className="route-source source-two">
                      <Icon name="spark" />
                      <span>备用订阅</span>
                      <i />
                    </div>
                    <div className="route-source source-three">
                      <Icon name="shield" />
                      <span>备用线路</span>
                      <i />
                    </div>
                    <svg className="route-wires" viewBox="0 0 480 230">
                      <path d="M120 40H160Q190 40 190 70V90Q190 115 220 115H340M120 115H340M120 190H160Q190 190 190 160V140Q190 115 220 115" />
                      <path className="route-active" d="M120 115H340" />
                    </svg>
                    <div className="route-hub">
                      <Icon name="route" />
                      <small>RouteX</small>
                    </div>
                    <div className="route-output">
                      <span className="status-dot" />
                      统一订阅
                    </div>
                    <span className="visual-caption">
                      MULTIPLE SOURCES → ONE SUBSCRIPTION
                    </span>
                  </div>
                </section>
                <div className="metrics">
                  <div>
                    <span>
                      订阅来源 <Icon name="layers" />
                    </span>
                    <strong>
                      {String(config.subscriptions.length).padStart(2, "0")}
                    </strong>
                    <small>{activeCount} 个已启用</small>
                  </div>
                  <div>
                    <span>
                      可选节点 <Icon name="nodes" />
                    </span>
                    <strong>
                      {currentPreview ? formatNumber(nodeNames.length) : "—"}
                    </strong>
                    <small>
                      {currentPreview
                        ? "已过滤流量提示与重复项"
                        : "刷新订阅后自动识别"}
                    </small>
                  </div>
                  <div>
                    <span>
                      基础分流规则 <Icon name="rules" />
                    </span>
                    <strong>
                      {formatNumber(currentPreview?.baseRuleCount ?? baseCount)}
                    </strong>
                    <small>iKuuu · {categories.length} 个策略类别</small>
                  </div>
                  <div>
                    <span>
                      专属节点组 <Icon name="spark" />
                    </span>
                    <strong>
                      {String(config.groups.length).padStart(2, "0")}
                    </strong>
                    <small>支持手选 / 测速 / 故障转移</small>
                  </div>
                </div>
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>
                        我的订阅{" "}
                        <span className="count-badge">
                          {config.subscriptions.length}
                        </span>
                      </h2>
                      <p>所有订阅一起提供节点，地址怎么走由你的规则决定。</p>
                    </div>
                    <div className="button-row">
                      <button
                        className="button small-button"
                        onClick={() => setImporting(!importing)}
                      >
                        <Icon name="upload" />
                        批量导入
                      </button>
                      <button
                        className="button small-button"
                        onClick={addSource}
                        disabled={config.subscriptions.length >= 20}
                      >
                        <Icon name="plus" />
                        添加订阅
                      </button>
                    </div>
                  </div>
                  {importing && (
                    <div className="bulk-import">
                      <Field label="订阅链接 · 每行一个">
                        <textarea
                          rows={4}
                          value={bulk}
                          onChange={(event) => setBulk(event.target.value)}
                          placeholder="https://example.com/subscribe?token=…"
                          spellCheck={false}
                        />
                      </Field>
                      <div className="button-row">
                        <button
                          className="button primary"
                          onClick={importSources}
                        >
                          导入订阅
                        </button>
                        <button
                          className="button"
                          onClick={() => setImporting(false)}
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  )}
                  {!config.subscriptions.length ? (
                    <Empty
                      title="从你的第一个订阅开始"
                      description="粘贴已有的 Clash 订阅链接，RouteX 会为你汇集其中的节点。"
                    >
                      <button className="button primary" onClick={addSource}>
                        <Icon name="plus" />
                        添加订阅来源
                      </button>
                    </Empty>
                  ) : (
                    <div className="subscription-list">
                      {config.subscriptions.map((source, index) => {
                        const info = currentPreview?.subscriptions[index];
                        return (
                          <article
                            className={`subscription-row ${source.enabled === false ? "is-disabled" : ""}`}
                            key={source.id ?? index}
                          >
                            <div
                              className={`source-symbol symbol-${index % 3}`}
                            >
                              <Icon name={index === 1 ? "spark" : "layers"} />
                            </div>
                            <div className="subscription-main">
                              <div className="source-title">
                                <input
                                  aria-label={`订阅 ${index + 1} 名称`}
                                  value={source.label ?? ""}
                                  onChange={(event) =>
                                    patchSource(index, {
                                      label: event.target.value,
                                    })
                                  }
                                  placeholder={`订阅 ${index + 1}`}
                                />
                                <span
                                  className={`state-badge ${source.enabled === false ? "neutral" : info?.status === "ok" ? "success" : info?.status === "error" ? "failed" : "neutral"}`}
                                >
                                  <span className="status-dot" />
                                  {source.enabled === false
                                    ? "已停用"
                                    : info?.status === "ok"
                                      ? "已连接"
                                      : info?.status === "error"
                                        ? "拉取失败"
                                        : "待刷新"}
                                </span>
                              </div>
                              <input
                                className="subscription-url"
                                type="password"
                                autoComplete="off"
                                aria-label={`订阅 ${index + 1} 地址`}
                                placeholder="粘贴订阅链接（https://…）"
                                value={source.url}
                                onChange={(event) =>
                                  patchSource(index, {
                                    url: event.target.value.trim(),
                                  })
                                }
                              />
                              {info?.error && (
                                <p className="small danger-text">
                                  {info.error}
                                </p>
                              )}
                              {info?.usage && (
                                <div className="usage">
                                  <span
                                    style={{
                                      width: `${Math.min(100, (info.usage.used / info.usage.total) * 100)}%`,
                                    }}
                                  />
                                  <small>
                                    {(info.usage.used / 1024 ** 3).toFixed(1)} /{" "}
                                    {(info.usage.total / 1024 ** 3).toFixed(0)}{" "}
                                    GB
                                    {info.usage.expire
                                      ? ` · ${new Date(info.usage.expire * 1000).toLocaleDateString("zh-CN")} 到期`
                                      : ""}
                                  </small>
                                </div>
                              )}
                            </div>
                            <div className="source-node-count">
                              <strong>
                                {info?.status === "ok" ? info.nodeCount : "—"}
                              </strong>
                              <small>个节点</small>
                            </div>
                            <label
                              className="switch"
                              title={
                                source.enabled === false
                                  ? "启用订阅"
                                  : "停用订阅"
                              }
                            >
                              <input
                                type="checkbox"
                                aria-label={`启用订阅 ${index + 1}`}
                                checked={source.enabled !== false}
                                onChange={(event) =>
                                  patchSource(index, {
                                    enabled: event.target.checked,
                                  })
                                }
                              />
                              <span />
                            </label>
                            <button
                              className="icon-button remove-button"
                              aria-label={`删除订阅 ${index + 1}`}
                              onClick={() =>
                                setConfig((previous) => ({
                                  ...previous,
                                  subscriptions: previous.subscriptions.filter(
                                    (_, i) => i !== index,
                                  ),
                                }))
                              }
                            >
                              <Icon name="close" />
                            </button>
                          </article>
                        );
                      })}
                    </div>
                  )}
                  <div className="panel-footer">
                    <Icon name="shield" />
                    <span>
                      订阅地址仅用于服务端拉取；分享时请使用生成的聚合链接。
                    </span>
                    <span className="mono">CLASH / MIHOMO</span>
                  </div>
                </section>
                <div className="next-step">
                  <span>订阅准备好了？继续选择节点和分流方式。</span>
                  <button
                    className="text-button"
                    onClick={() => setView("nodes")}
                  >
                    管理节点与策略组 <Icon name="arrow" />
                  </button>
                </div>
              </>
            )}
            {view === "nodes" && (
              <>
                <section className="panel default-egress">
                  <div>
                    <span className="eyebrow">EVERYDAY CONNECTION</span>
                    <h2>日常上网，跟随这个出口</h2>
                    <p>
                      选择订阅组，会跟随组里当前的节点；也可以直接选择任意订阅的单个节点。专用地址会优先使用自己的规则。
                    </p>
                  </div>
                  <div>
                    <MultiTarget
                      selected={mapped(MAIN_GROUP)}
                      sections={sections.map((section) => ({
                        ...section,
                        values: section.values.filter(
                          (value) => value !== MAIN_GROUP,
                        ),
                      }))}
                      onChange={(targets) => setMapping(MAIN_GROUP, targets)}
                    />
                    <div className="egress-actions">
                      <button
                        className="text-button"
                        onClick={() =>
                          setConfig((previous) => ({
                            ...previous,
                            ruleMapping: previous.ruleMapping.filter(
                              (entry) => entry.category !== MAIN_GROUP,
                            ),
                          }))
                        }
                      >
                        恢复订阅组选择
                      </button>
                      <button
                        className="text-button"
                        onClick={() => setMapping(MAIN_GROUP, [AUTO_GROUP])}
                      >
                        使用自动测速
                      </button>
                    </div>
                  </div>
                </section>
                <div className="feature-note">
                  <span className="feature-icon">
                    <Icon name="spark" />
                  </span>
                  <div>
                    <h3>按需建立自己的节点组</h3>
                    <p>
                      从任意订阅挑选节点，组成自己的线路，再为需要的地址指定出口。
                    </p>
                  </div>
                  <button className="button" onClick={() => setView("rules")}>
                    添加我的规则 <Icon name="arrow" />
                  </button>
                </div>
                {!currentPreview && (
                  <div className="inline-note">
                    {preview
                      ? "订阅已更改，请刷新节点以更新可选列表。"
                      : "添加订阅并刷新节点后，即可选择真实节点。"}
                  </div>
                )}
                <div className="section-heading">
                  <h2>
                    我的节点组{" "}
                    <span className="count-badge">{config.groups.length}</span>
                  </h2>
                  <button className="button primary" onClick={() => addGroup()}>
                    <Icon name="plus" />
                    新建节点组
                  </button>
                </div>
                <div className="preset-row">
                  <span>快速添加</span>
                  {REGIONS.map((region) => (
                    <button
                      key={region.name}
                      className="chip"
                      onClick={() => addGroup(region)}
                    >
                      {region.name.replace("节点", "")} +
                    </button>
                  ))}
                </div>
                <div className="group-grid">
                  {config.groups.map((group, index) => {
                    const matched = groupMatches[index].nodes;
                    const pool = group.sourceId
                      ? (sources.find(
                          (source) => source.sourceId === group.sourceId,
                        )?.nodes ?? [])
                      : nodeNames;
                    const knownSources = config.subscriptions.map((source, i) =>
                      sourceId(source, i),
                    );
                    return (
                      <section
                        key={group.id}
                        className={`panel group-card ${/gpt/i.test(group.name) ? "gpt-card" : ""}`}
                      >
                        <div className="group-top">
                          <span className="group-icon">
                            <Icon
                              name={/gpt/i.test(group.name) ? "spark" : "nodes"}
                            />
                          </span>
                          <input
                            aria-label={`节点组 ${index + 1} 名称`}
                            value={group.name}
                            onChange={(event) =>
                              patchGroup(index, { name: event.target.value })
                            }
                          />
                          <span
                            className={`state-badge ${matched.length ? "success" : "neutral"}`}
                          >
                            {currentPreview
                              ? `${matched.length} 节点`
                              : "待刷新"}
                          </span>
                          <button
                            aria-label={`删除节点组 ${group.name}`}
                            className="icon-button remove-button"
                            onClick={() =>
                              setConfig((previous) => ({
                                ...previous,
                                groups: previous.groups.filter(
                                  (_, i) => i !== index,
                                ),
                              }))
                            }
                          >
                            <Icon name="close" />
                          </button>
                        </div>
                        <div className="form-grid">
                          <Field label="节点来源">
                            <select
                              value={group.sourceId ?? ""}
                              onChange={(event) =>
                                patchGroup(index, {
                                  sourceId: event.target.value || undefined,
                                })
                              }
                            >
                              <option value="">所有已启用订阅</option>
                              {group.sourceId &&
                                !knownSources.includes(group.sourceId) && (
                                  <option value={group.sourceId}>
                                    已移除的订阅
                                  </option>
                                )}
                              {config.subscriptions.map((source, i) => (
                                <option
                                  value={sourceId(source, i)}
                                  key={sourceId(source, i)}
                                >
                                  {source.label || `订阅 ${i + 1}`}
                                  {source.enabled === false ? "（已停用）" : ""}
                                </option>
                              ))}
                            </select>
                          </Field>
                          <Field label="筛选方式">
                            <select
                              value={group.type}
                              onChange={(event) =>
                                patchGroup(index, {
                                  type: event.target.value as NodeGroup["type"],
                                })
                              }
                            >
                              <option value="manual">手动勾选</option>
                              <option value="auto">按名称 / 正则</option>
                              <option value="all">全部节点</option>
                              {["direct", "reject"].includes(group.type) && (
                                <option value={group.type}>
                                  {group.type === "direct" ? "直连" : "拦截"}
                                </option>
                              )}
                            </select>
                          </Field>
                          <Field label="切换方式">
                            <select
                              value={group.strategy ?? "select"}
                              onChange={(event) =>
                                patchGroup(index, {
                                  strategy: event.target
                                    .value as NodeGroup["strategy"],
                                })
                              }
                            >
                              <option value="select">手动选择</option>
                              <option value="url-test">自动测速</option>
                              <option value="fallback">故障转移</option>
                            </select>
                          </Field>
                          <Field
                            label={
                              group.strategy === "fallback"
                                ? "优先节点"
                                : "默认节点"
                            }
                          >
                            <select
                              value={group.preferred ?? ""}
                              disabled={
                                group.strategy === "url-test" || !matched.length
                              }
                              onChange={(event) =>
                                patchGroup(index, {
                                  preferred: event.target.value || undefined,
                                })
                              }
                            >
                              <option value="">
                                {group.strategy === "url-test"
                                  ? "由 Clash 自动测速选择"
                                  : "使用组内第一个节点"}
                              </option>
                              {group.preferred &&
                                !matched.includes(group.preferred) && (
                                  <option value={group.preferred}>
                                    已失效：{group.preferred}
                                  </option>
                                )}
                              {matched.map((node) => (
                                <option key={node} value={node}>
                                  {node}
                                </option>
                              ))}
                            </select>
                          </Field>
                        </div>
                        {group.type === "auto" && (
                          <Field
                            label="节点名称匹配"
                            hint="可用 | 分隔关键词，例如 美国|🇺🇸|SV。"
                          >
                            <input
                              value={group.pattern ?? ""}
                              onChange={(event) =>
                                patchGroup(index, {
                                  pattern: event.target.value,
                                })
                              }
                              placeholder="美国|🇺🇸|SV"
                              spellCheck={false}
                            />
                          </Field>
                        )}
                        {group.type === "manual" ? (
                          <NodePicker
                            nodes={pool}
                            selected={group.nodes ?? []}
                            onChange={(nodes) => patchGroup(index, { nodes })}
                          />
                        ) : (
                          <details className="matched-details">
                            <summary>
                              查看匹配节点 <span>{matched.length}</span>
                            </summary>
                            <div>
                              {matched.slice(0, 200).map((node) => (
                                <p key={node}>{node}</p>
                              ))}
                              {!matched.length && <p>当前没有匹配节点。</p>}
                            </div>
                          </details>
                        )}
                        {currentPreview && !matched.length && (
                          <p className="small warning-text">
                            此组没有匹配节点，相关流量将拦截。请调整来源或筛选条件。
                          </p>
                        )}
                      </section>
                    );
                  })}
                </div>
                <p className="help-line">
                  <Icon name="link" />
                  网页选择的默认节点会在发布并刷新 Clash
                  订阅后生效。测速和故障转移由 Clash 客户端执行。
                </p>
              </>
            )}
            {view === "rules" && (
              <RulesWorkspace
                config={config}
                setConfig={setConfig}
                sections={sections}
                counts={counts}
                mapped={mapped}
                onMapping={setMapping}
                onNotice={(text, error = false) => setMessage({ text, error })}
                onManageGroups={() => setView("nodes")}
              />
            )}
            {view === "publish" && (
              <>
                {dirty && (
                  <section className="panel publish-changes">
                    <div>
                      <span className="eyebrow">READY TO SYNC</span>
                      <h3>本次待发布</h3>
                      <p>发布后，在 Clash 刷新原订阅链接即可应用。</p>
                    </div>
                    <ul>
                      {publishChanges(saved?.config, config).map(
                        (change, index) => (
                          <li key={index}>{change}</li>
                        ),
                      )}
                    </ul>
                  </section>
                )}
                <div className="publish-grid">
                  <section className="panel publish-card">
                    <span className="publish-symbol">
                      <Icon name="send" />
                    </span>
                    <span className="eyebrow">YOUR SINGLE ENTRY POINT</span>
                    <h2>
                      {saved
                        ? "一条链接，持续更新。"
                        : "让所有线路，归于一个入口。"}
                    </h2>
                    <p>
                      发布配置后，将聚合链接添加到 Clash。
                      <br />
                      以后修改节点或规则，更新原链接即可。
                    </p>
                    {localDatabase && (
                      <p>
                        配置保存在本机 PostgreSQL 中。客户端刷新订阅时，
                        请保持这台电脑上的 RouteX 运行。
                      </p>
                    )}
                    <div className={`publish-status ${dirty ? "pending" : ""}`}>
                      <span className="status-dot" />
                      {saved
                        ? dirty
                          ? "有尚未发布的修改"
                          : `已与${storageLabel}同步`
                        : "当前配置尚未发布"}
                    </div>
                    {saved && (
                      <div className="publish-url">
                        <input
                          aria-label="聚合订阅链接"
                          value={subUrl}
                          readOnly
                          onFocus={(event) => event.currentTarget.select()}
                        />
                        <button
                          className="icon-button"
                          aria-label="复制聚合订阅链接"
                          onClick={() => void copy(subUrl, "聚合链接")}
                        >
                          <Icon name="copy" />
                        </button>
                      </div>
                    )}
                    <div className="button-row">
                      <button
                        className="button primary"
                        disabled={!activeCount || (!!saved && !dirty)}
                        onClick={() => void publish()}
                      >
                        <Icon name="send" />
                        {saved
                          ? dirty
                            ? "发布更新 · 链接不变"
                            : "已是最新配置"
                          : "保存并生成订阅链接"}
                      </button>
                      {saved && (
                        <button
                          className="button"
                          onClick={() => void publish(true)}
                        >
                          另存为新链接
                        </button>
                      )}
                    </div>
                    {saved && (
                      <p className="small muted">
                        聚合链接可访问你的节点配置，请仅在自己的设备中使用。
                      </p>
                    )}
                  </section>
                  <section className="panel use-guide">
                    <span className="eyebrow">QUICK START</span>
                    <h2>在 Clash 中使用</h2>
                    <ol>
                      <li>
                        <span>01</span>
                        <div>
                          <strong>复制聚合链接</strong>
                          <p>发布后，复制左侧生成的订阅地址。</p>
                        </div>
                      </li>
                      <li>
                        <span>02</span>
                        <div>
                          <strong>导入 Clash Verge / Mihomo</strong>
                          <p>在客户端的订阅页面添加远程订阅。</p>
                        </div>
                      </li>
                      <li>
                        <span>03</span>
                        <div>
                          <strong>按需切换，随时更新</strong>
                          <p>
                            网页修改后先发布，再刷新客户端订阅。客户端也可以临时切换节点。
                          </p>
                        </div>
                      </li>
                    </ol>
                    <div className="inline-note">
                      刷新订阅会应用网页设定的默认节点，覆盖客户端上一次的临时选择。
                    </div>
                  </section>
                </div>
                <section className="panel">
                  <div className="panel-heading">
                    <div>
                      <h2>配置预览与恢复</h2>
                      <p>查看生成的 Clash YAML，或在新设备恢复你的编辑空间。</p>
                    </div>
                    <button
                      className="button small-button"
                      onClick={inspectYaml}
                      disabled={!activeCount}
                    >
                      <Icon name="eye" />
                      预览当前 YAML
                    </button>
                  </div>
                  {yamlText && (
                    <div className="yaml-preview">
                      <div className="button-row">
                        <span className="mono">routex.yaml</span>
                        <button
                          className="text-button"
                          onClick={() =>
                            downloadFile("routex.yaml", yamlText, "text/yaml")
                          }
                        >
                          <Icon name="download" />
                          下载 YAML
                        </button>
                      </div>
                      <pre>
                        {yamlText.length > 25000
                          ? `${yamlText.slice(0, 25000)}\n\n… 预览已折叠，下载可查看完整配置。`
                          : yamlText}
                      </pre>
                    </div>
                  )}
                  <div className="recovery">
                    <div>
                      <h3>在其他设备继续编辑</h3>
                      <p>备份包含订阅地址及编辑权限，请妥善保管。</p>
                    </div>
                    {saved && (
                      <button
                        className="button small-button"
                        onClick={() =>
                          void copy(`${saved.id} ${saved.editKey}`, "编辑凭证")
                        }
                      >
                        <Icon name="copy" />
                        复制编辑凭证
                      </button>
                    )}
                    <div className="recovery-input">
                      <input
                        aria-label="配置编辑凭证"
                        type="password"
                        autoComplete="off"
                        placeholder="粘贴配置 ID 和编辑凭证，以空格分隔"
                        value={loadInput}
                        onChange={(event) => setLoadInput(event.target.value)}
                      />
                      <button
                        className="button"
                        onClick={() =>
                          void run("正在恢复配置", async () => {
                            const [id, key] = loadInput.trim().split(/\s+/, 2);
                            if (!id || !key)
                              throw new Error("请填写完整的配置 ID 和编辑凭证");
                            await restoreSaved(id, key);
                          })
                        }
                        disabled={!loadInput.trim()}
                      >
                        恢复配置 <Icon name="arrow" />
                      </button>
                    </div>
                  </div>
                </section>
              </>
            )}
          </fieldset>
          {currentPreview && currentPreview.warnings.length > 0 && (
            <details className="warnings">
              <summary>
                <Icon name="shield" />
                {currentPreview.warnings.length} 项配置提示
              </summary>
              <ul>
                {currentPreview.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </details>
          )}
          <footer className="page-footer">
            <span>
              RouteX <span className="muted">/</span> Make every route yours.
            </span>
            <span>
              本地草稿 · {storageLabel}同步 <span className="status-dot" />
            </span>
          </footer>
        </main>
      </div>
    </div>
  );
}
