"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import type { AppConfig, CustomRule } from "@/lib/types";
import { MAIN_GROUP } from "@/lib/policies";
import {
  addressRules,
  baseRuleOverride,
  prependRules,
  retargetRaw,
} from "@/lib/routing-editor";
import {
  Empty,
  Field,
  Icon,
  MultiTarget,
  TargetOptions,
  type TargetSection,
} from "./ui";

const TYPES = [
  ["DOMAIN-SUFFIX", "域名及子域名"],
  ["DOMAIN", "精确域名"],
  ["DOMAIN-KEYWORD", "域名关键词"],
  ["IP-CIDR", "IP / 网段"],
  ["RAW", "完整规则"],
] as const;
type Props = {
  config: AppConfig;
  setConfig: Dispatch<SetStateAction<AppConfig>>;
  sections: TargetSection[];
  counts: Record<string, number>;
  mapped: (category: string) => string[];
  onMapping: (category: string, targets: string[]) => void;
  onNotice: (text: string, error?: boolean) => void;
  onManageGroups: () => void;
};

function BaseRuleBrowser({
  config,
  setConfig,
  sections,
  onNotice,
}: Pick<Props, "config" | "setConfig" | "sections" | "onNotice">) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{
    rules: { raw: string; type: string; value: string; target: string }[];
    total: number;
    page: number;
    pages: number;
  } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(
          `/api/rules?q=${encodeURIComponent(query)}&page=${page}`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error("默认规则读取失败，请稍后重试");
        const result = await response.json();
        if (!controller.signal.aborted) setData(result);
      } catch (error) {
        if (!controller.signal.aborted) setError((error as Error).message);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, page]);
  return (
    <section className="panel rule-library">
      <div className="panel-heading">
        <div>
          <h2>默认规则明细</h2>
          <p>
            参考 iKuuu
            的分流模板。选中一条规则的出口，会在「我的规则」里添加优先覆盖。
          </p>
        </div>
        <span className="state-badge">
          {data?.total.toLocaleString() ?? "…"} 条
        </span>
      </div>
      <div className="search-input">
        <Icon name="search" />
        <input
          aria-label="搜索默认规则"
          placeholder="搜索域名、IP 或类别，例如 github.com"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(1);
          }}
        />
      </div>
      {error && (
        <p role="alert" className="inline-note">
          {error}
        </p>
      )}
      <div className="base-rule-list" aria-busy={loading}>
        {loading ? (
          <p role="status" className="muted">
            正在查找规则…
          </p>
        ) : (
          data?.rules.map((rule, index) => {
            const override = config.customRules.find(
              (item) =>
                item.enabled !== false &&
                item.type === "RAW" &&
                retargetRaw(item.value, rule.target) === rule.raw,
            );
            return (
              <article className="base-rule-item" key={`${rule.raw}-${index}`}>
                <div>
                  <span className="rule-type-tag">{rule.type}</span>
                  <strong>{rule.value}</strong>
                  <small>
                    {override
                      ? `已覆盖 → ${override.group}`
                      : `默认 → ${rule.target}`}
                  </small>
                </div>
                {rule.type === "MATCH" ? (
                  <span className="muted small">在下方分类策略调整</span>
                ) : (
                  <select
                    aria-label={`覆盖规则 ${rule.value}`}
                    value=""
                    onChange={(event) => {
                      const next = baseRuleOverride(
                        rule.raw,
                        event.target.value,
                      );
                      const updated = prependRules(config, [next]);
                      if (updated.customRules.length > 2000) {
                        onNotice("个人规则最多支持 2,000 条", true);
                        return;
                      }
                      setConfig(updated);
                      onNotice(`已为 ${rule.value} 添加优先规则，发布后生效。`);
                    }}
                  >
                    <option value="" disabled>
                      指定其他出口…
                    </option>
                    <TargetOptions sections={sections} />
                  </select>
                )}
              </article>
            );
          })
        )}
        {!loading && data?.total === 0 && (
          <Empty
            title="默认模板没有这条记录"
            description="可以在「我的规则」粘贴地址，单独指定出口。"
          />
        )}
      </div>
      <div className="rule-pagination">
        <span className="muted small">
          第 {data?.page ?? 1} / {data?.pages ?? 1} 页 · 每页 30 条
        </span>
        <div>
          <button
            className="button small-button"
            disabled={loading || page <= 1}
            onClick={() => setPage(page - 1)}
          >
            上一页
          </button>
          <button
            className="button small-button"
            disabled={loading || !data || page >= data.pages}
            onClick={() => setPage(page + 1)}
          >
            下一页
          </button>
        </div>
      </div>
    </section>
  );
}

export default function RulesWorkspace({
  config,
  setConfig,
  sections,
  counts,
  mapped,
  onMapping,
  onNotice,
  onManageGroups,
}: Props) {
  const [tab, setTab] = useState<"mine" | "base">("mine");
  const [purpose, setPurpose] = useState<"direct" | "custom" | "reject">(
    "direct",
  );
  const [addresses, setAddresses] = useState("");
  const [note, setNote] = useState("");
  const [target, setTarget] = useState(MAIN_GROUP);
  const [query, setQuery] = useState("");
  const [categoryQuery, setCategoryQuery] = useState("");
  const allSections = [
    ...sections,
    {
      label: "默认分类策略",
      values: Object.keys(counts).filter((category) => category !== MAIN_GROUP),
    },
  ];
  const patch = (index: number, next: Partial<CustomRule>) =>
    setConfig((previous) => ({
      ...previous,
      customRules: previous.customRules.map((rule, i) =>
        i === index ? { ...rule, ...next } : rule,
      ),
    }));
  const move = (index: number, direction: number) =>
    setConfig((previous) => {
      const rules = [...previous.customRules];
      [rules[index], rules[index + direction]] = [
        rules[index + direction],
        rules[index],
      ];
      return { ...previous, customRules: rules };
    });
  const add = () => {
    try {
      const name =
        purpose === "direct"
          ? "DIRECT"
          : purpose === "reject"
            ? "REJECT"
            : target;
      const additions = addressRules(addresses, name, note);
      const next = prependRules(config, additions);
      if (next.customRules.length > 2000)
        throw new Error("个人规则最多支持 2,000 条");
      setConfig(next);
      setAddresses("");
      setNote("");
      setQuery("");
      onNotice(
        `已添加 ${additions.length} 条优先规则 → ${name === "DIRECT" ? "直连" : name === "REJECT" ? "拦截" : name}。发布后，在 Clash 刷新原订阅即可。`,
      );
    } catch (error) {
      onNotice((error as Error).message, true);
    }
  };
  return (
    <div className="routing-workspace">
      <div className="routing-flow" aria-label="规则匹配顺序">
        <span>
          <b>01</b> 我的规则优先
        </span>
        <Icon name="arrow" />
        <span>
          <b>02</b> 默认分流模板
        </span>
        <Icon name="arrow" />
        <span>
          <b>03</b> 未匹配流量使用兜底策略
        </span>
      </div>
      <div
        className="routing-tabs"
        role="tablist"
        aria-label="规则视图"
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
            return;
          event.preventDefault();
          const next =
            event.key === "Home"
              ? "mine"
              : event.key === "End"
                ? "base"
                : tab === "mine"
                  ? "base"
                  : "mine";
          setTab(next);
          event.currentTarget
            .querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)
            ?.focus();
        }}
      >
        <button
          role="tab"
          id="rules-tab-mine"
          data-tab="mine"
          aria-controls="rules-panel-mine"
          tabIndex={tab === "mine" ? 0 : -1}
          aria-selected={tab === "mine"}
          onClick={() => setTab("mine")}
        >
          我的规则 <span>{config.customRules.length}</span>
        </button>
        <button
          role="tab"
          id="rules-tab-base"
          data-tab="base"
          aria-controls="rules-panel-base"
          tabIndex={tab === "base" ? 0 : -1}
          aria-selected={tab === "base"}
          onClick={() => setTab("base")}
        >
          默认规则与分类
        </button>
      </div>
      {tab === "mine" ? (
        <div
          className="routing-workspace"
          role="tabpanel"
          id="rules-panel-mine"
          aria-labelledby="rules-tab-mine"
        >
          <section className="panel quick-route">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">WHERE SHOULD THIS ADDRESS GO?</span>
                <h2>这个地址，走哪条线路？</h2>
                <p>
                  粘贴网址、域名或
                  IP，每行一个。连接地址只保留主机，不保存账号、密码和路径。
                </p>
              </div>
              <Icon name="route" />
            </div>
            <div className="route-purpose" aria-label="快捷分流方式">
              <button
                className={purpose === "direct" ? "selected" : ""}
                aria-pressed={purpose === "direct"}
                onClick={() => setPurpose("direct")}
              >
                <Icon name="shield" />
                <strong>直接连接</strong>
                <small>内网、国内网站、不需要代理</small>
              </button>

              <button
                className={purpose === "custom" ? "selected" : ""}
                aria-pressed={purpose === "custom"}
                onClick={() => setPurpose("custom")}
              >
                <Icon name="route" />
                <strong>指定出口</strong>
                <small>指定节点、节点组或订阅组</small>
              </button>
              <button
                className={purpose === "reject" ? "selected" : ""}
                aria-pressed={purpose === "reject"}
                onClick={() => setPurpose("reject")}
              >
                <Icon name="close" />
                <strong>拦截连接</strong>
                <small>阻止访问指定地址</small>
              </button>
            </div>
            <div className="quick-route-fields">
              <Field label="需要分流的地址">
                <textarea
                  aria-label="快捷分流地址"
                  rows={4}
                  value={addresses}
                  onChange={(event) => setAddresses(event.target.value)}
                  placeholder={
                    "https://example.com\n192.168.0.0/16\n*.internal.example.com"
                  }
                  spellCheck={false}
                />
              </Field>
              <div>
                <Field label="备注（选填）">
                  <input
                    aria-label="快捷规则备注"
                    value={note}
                    maxLength={200}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="例如：公司内网、临时分流"
                  />
                </Field>
                {purpose === "custom" ? (
                  <Field label="使用的出口">
                    <select
                      aria-label="快捷规则出口"
                      value={target}
                      onChange={(event) => setTarget(event.target.value)}
                    >
                      <TargetOptions sections={allSections} current={target} />
                    </select>
                  </Field>
                ) : (
                  <p className="route-hint">
                    {purpose === "direct"
                      ? "这些地址优先直连，其余网站仍按原有规则分流。"
                      : "这些地址会被拒绝连接，其余网站仍按原有规则分流。"}
                  </p>
                )}
                <button
                  className="button primary"
                  onClick={add}
                  disabled={!addresses.trim()}
                >
                  <Icon name="plus" />
                  添加到我的规则
                </button>
              </div>
            </div>
            {purpose === "custom" && (
              <button className="text-button" onClick={onManageGroups}>
                管理我的节点组 <Icon name="arrow" />
              </button>
            )}
          </section>
          <section className="panel custom-panel">
            <div className="panel-heading">
              <div>
                <h2>
                  我的规则 <span className="state-badge warm">优先匹配</span>
                </h2>
                <p>
                  从上到下，第一条匹配生效。临时不用的规则可以暂停，之后再启用。
                </p>
              </div>
              <button
                className="button small-button"
                disabled={config.customRules.length >= 2000}
                onClick={() => {
                  setQuery("");
                  setConfig((previous) => ({
                    ...previous,
                    customRules: [
                      {
                        type: "DOMAIN-SUFFIX",
                        value: "",
                        group: MAIN_GROUP,
                        note: "",
                        enabled: true,
                      },
                      ...previous.customRules,
                    ],
                  }));
                }}
              >
                <Icon name="plus" />
                手动添加规则
              </button>
            </div>
            {!!config.customRules.length && (
              <div className="search-input">
                <Icon name="search" />
                <input
                  aria-label="搜索我的规则"
                  placeholder="搜索地址、备注或出口…"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
            )}
            {config.customRules
              .map((rule, index) => ({ rule, index }))
              .filter(({ rule }) =>
                `${rule.note ?? ""} ${rule.value} ${rule.group}`
                  .toLowerCase()
                  .includes(query.toLowerCase()),
              )
              .map(({ rule, index }) => (
                <article
                  className={`custom-rule personal-rule ${rule.enabled === false ? "rule-paused" : ""}`}
                  key={index}
                >
                  <div className="rule-index">
                    {String(index + 1).padStart(2, "0")}
                    <button
                      className="text-button"
                      aria-label={`上移规则 ${index + 1}`}
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    >
                      ↑
                    </button>
                    <button
                      className="text-button"
                      aria-label={`下移规则 ${index + 1}`}
                      disabled={index === config.customRules.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      ↓
                    </button>
                  </div>
                  <div className="custom-rule-fields">
                    <div className="personal-rule-heading">
                      <input
                        aria-label={`规则 ${index + 1} 备注`}
                        placeholder="给这条规则加个备注…"
                        maxLength={200}
                        value={rule.note ?? ""}
                        onChange={(event) =>
                          patch(index, { note: event.target.value })
                        }
                      />
                      <label className="rule-enabled">
                        <input
                          type="checkbox"
                          aria-label={`启用规则 ${index + 1}`}
                          checked={rule.enabled !== false}
                          onChange={(event) =>
                            patch(index, { enabled: event.target.checked })
                          }
                        />
                        {rule.enabled === false ? "已暂停" : "已启用"}
                      </label>
                    </div>
                    <div className="form-grid">
                      <Field label="匹配方式">
                        <select
                          aria-label={`规则 ${index + 1} 匹配方式`}
                          value={rule.type}
                          onChange={(event) =>
                            patch(index, {
                              type: event.target.value as CustomRule["type"],
                            })
                          }
                        >
                          {TYPES.map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="使用的出口">
                        <select
                          aria-label={`规则 ${index + 1} 出口`}
                          value={rule.group}
                          onChange={(event) =>
                            patch(index, {
                              group: event.target.value,
                              ...(rule.type === "RAW"
                                ? {
                                    value: retargetRaw(
                                      rule.value,
                                      event.target.value,
                                    ),
                                  }
                                : {}),
                            })
                          }
                        >
                          <TargetOptions
                            sections={allSections}
                            current={rule.group}
                          />
                        </select>
                      </Field>
                    </div>
                    <Field
                      label={
                        rule.type === "RAW"
                          ? "完整规则 · 每行一条"
                          : "匹配地址 · 每行一项"
                      }
                    >
                      <textarea
                        aria-label={`规则 ${index + 1} 内容`}
                        value={rule.value}
                        rows={Math.min(
                          4,
                          Math.max(2, rule.value.split("\n").length),
                        )}
                        onChange={(event) =>
                          patch(index, { value: event.target.value })
                        }
                        spellCheck={false}
                      />
                    </Field>
                  </div>
                  <button
                    className="icon-button remove-button"
                    aria-label={`删除规则 ${index + 1}`}
                    onClick={() =>
                      setConfig((previous) => ({
                        ...previous,
                        customRules: previous.customRules.filter(
                          (_, i) => i !== index,
                        ),
                      }))
                    }
                  >
                    <Icon name="close" />
                  </button>
                </article>
              ))}
            {!config.customRules.length && (
              <Empty
                title="默认规则已经就绪"
                description="目前全部流量按 iKuuu 模板分流。遇到需要特殊处理的地址，再添加个人规则。"
              />
            )}
          </section>
        </div>
      ) : (
        <div
          className="routing-workspace"
          role="tabpanel"
          id="rules-panel-base"
          aria-labelledby="rules-tab-base"
        >
          <BaseRuleBrowser
            config={config}
            setConfig={setConfig}
            sections={allSections}
            onNotice={onNotice}
          />
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>按类别统一调整</h2>
                <p>
                  日常出口可以保留订阅组，也可以选择具体节点。第一项是默认目标。
                </p>
              </div>
              <button
                className="button small-button"
                onClick={() => {
                  setConfig((previous) => ({ ...previous, ruleMapping: [] }));
                  onNotice("分类策略已恢复默认，个人规则保留。");
                }}
              >
                恢复分类默认值
              </button>
            </div>
            <div className="search-input">
              <Icon name="search" />
              <input
                aria-label="搜索规则类别"
                placeholder="搜索类别，例如 Steam、国内…"
                value={categoryQuery}
                onChange={(event) => setCategoryQuery(event.target.value)}
              />
            </div>
            {Object.keys(counts)
              .filter((category) =>
                category.toLowerCase().includes(categoryQuery.toLowerCase()),
              )
              .map((category) => (
                <div className="rule-row" key={category}>
                  <div>
                    <strong>{category}</strong>
                    <small>
                      {config.ruleMapping.some(
                        (entry) => entry.category === category,
                      )
                        ? "已自定义"
                        : "模板默认策略"}
                    </small>
                  </div>
                  <span className="mono muted">
                    {counts[category].toLocaleString()}
                  </span>
                  <MultiTarget
                    selected={mapped(category)}
                    sections={sections.map((section) => ({
                      ...section,
                      values: section.values.filter(
                        (value) => value !== category,
                      ),
                    }))}
                    onChange={(targets) => onMapping(category, targets)}
                  />
                </div>
              ))}
          </section>
        </div>
      )}
    </div>
  );
}
