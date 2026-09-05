"use client";

import { useState } from "react";

export type IconName =
  | "route"
  | "layers"
  | "nodes"
  | "rules"
  | "send"
  | "plus"
  | "refresh"
  | "arrow"
  | "copy"
  | "download"
  | "upload"
  | "check"
  | "close"
  | "search"
  | "spark"
  | "link"
  | "eye"
  | "shield";
const paths: Record<IconName, React.ReactNode> = {
  route: (
    <>
      <path d="M5 4h5a4 4 0 0 1 0 8H5m5 0 8 8M5 4v16M15 4l4 4-4 4" />
    </>
  ),
  layers: (
    <>
      <path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5" />
    </>
  ),
  nodes: (
    <>
      <circle cx="5" cy="5" r="2" />
      <circle cx="19" cy="6" r="2" />
      <circle cx="12" cy="19" r="2" />
      <path d="m7 5 10 1M6 7l5 10m7-9-5 9" />
    </>
  ),
  rules: (
    <>
      <path d="M4 6h16M4 12h16M4 18h16" />
      <circle cx="9" cy="6" r="2" />
      <circle cx="16" cy="12" r="2" />
      <circle cx="8" cy="18" r="2" />
    </>
  ),
  send: (
    <>
      <path d="m3 10 18-7-7 18-4-7-7-4Zm7 4L21 3" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  refresh: (
    <>
      <path d="M20 7a9 9 0 0 0-15-2L3 8m0-5v5h5M4 17a9 9 0 0 0 15 2l2-3m0 5v-5h-5" />
    </>
  ),
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  copy: (
    <>
      <rect x="8" y="8" width="12" height="13" rx="2" />
      <path d="M16 8V3H3v13h5" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  search: (
    <>
      <circle cx="10" cy="10" r="6" />
      <path d="m15 15 5 5" />
    </>
  ),
  spark: (
    <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z" />
  ),
  link: (
    <>
      <path
        d="m10 13 4-4m-6 7-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 10a4 4 0 0 0 6 0l4-4a4 4 0 0 0-6-6l-1 1"
        transform="translate(1 -1) scale(.9)"
      />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  shield: (
    <>
      <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
};
export function Icon({
  name,
  className = "",
}: {
  name: IconName;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      className={`icon ${className}`}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </svg>
  );
}
export function Empty({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon name="layers" />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {children}
    </div>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function NodePicker({
  nodes,
  selected,
  onChange,
}: {
  nodes: string[];
  selected: string[];
  onChange: (nodes: string[]) => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = nodes.filter((node) =>
    node.toLowerCase().includes(search.toLowerCase()),
  );
  const chosen = new Set(selected);
  const missing = selected.filter((node) => !nodes.includes(node));
  return (
    <div className="node-picker">
      <div className="picker-toolbar">
        <div className="search-input">
          <Icon name="search" />
          <input
            aria-label="搜索节点"
            placeholder="搜索地区或节点名称…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <button
          className="text-button"
          onClick={() => onChange([...new Set([...selected, ...filtered])])}
          disabled={!filtered.length}
        >
          全选结果
        </button>
        <button
          className="text-button"
          onClick={() => onChange([])}
          disabled={!selected.length}
        >
          清空
        </button>
      </div>
      <div className="node-list">
        {[...missing, ...filtered].map((node) => (
          <label
            className={`node-option ${chosen.has(node) ? "chosen" : ""}`}
            key={node}
          >
            <input
              type="checkbox"
              checked={chosen.has(node)}
              onChange={() =>
                onChange(
                  chosen.has(node)
                    ? selected.filter((item) => item !== node)
                    : [...selected, node],
                )
              }
            />
            <span title={node}>{node}</span>
            {missing.includes(node) && (
              <small className="danger-text">已失效</small>
            )}
          </label>
        ))}
      </div>
      {!filtered.length && (
        <p className="muted small">
          {nodes.length
            ? "没有匹配的节点，试试其他关键词。"
            : "先添加订阅并刷新节点，即可在这里选择。"}
        </p>
      )}
      <p className="muted small">
        已选 {selected.length} / {nodes.length} 个节点 ·
        组内默认节点可在上方选择
      </p>
    </div>
  );
}
export type TargetSection = { label: string; values: string[] };
export function TargetOptions({
  sections,
  current = "",
}: {
  sections: TargetSection[];
  current?: string;
}) {
  const known = sections.flatMap((section) => section.values);
  return (
    <>
      {current && !known.includes(current) && (
        <option value={current}>已失效：{current}</option>
      )}
      {sections
        .filter((section) => section.values.length)
        .map((section) => (
          <optgroup label={section.label} key={section.label}>
            {section.values.map((value) => (
              <option value={value} key={value}>
                {value === "DIRECT"
                  ? "直连 · DIRECT"
                  : value === "REJECT"
                    ? "拦截 · REJECT"
                    : value}
              </option>
            ))}
          </optgroup>
        ))}
    </>
  );
}
export function MultiTarget({
  selected,
  sections,
  onChange,
}: {
  selected: string[];
  sections: TargetSection[];
  onChange: (targets: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const all = sections.flatMap((section) => section.values);
  const missing = selected.filter((item) => !all.includes(item));
  return (
    <details className="target-picker">
      <summary>
        <span>
          {selected.length
            ? `${selected[0]}${selected.length > 1 ? ` +${selected.length - 1}` : ""}`
            : "未选择 · 将拦截"}
        </span>
        <span aria-hidden="true">⌄</span>
      </summary>
      <div className="target-panel">
        <input
          aria-label="搜索规则目标"
          placeholder="搜索节点或节点组…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <p className="small muted">
          第一项为默认目标；取消后重新勾选可调整顺序。
        </p>
        <div className="target-list">
          {[{ label: "已失效", values: missing }, ...sections].map(
            (section) => {
              const values = section.values.filter((value) =>
                value.toLowerCase().includes(query.toLowerCase()),
              );
              return values.length ? (
                <div key={section.label}>
                  <h4>{section.label}</h4>
                  {values.map((value) => (
                    <label key={value}>
                      <input
                        type="checkbox"
                        checked={selected.includes(value)}
                        onChange={() =>
                          onChange(
                            selected.includes(value)
                              ? selected.filter((item) => item !== value)
                              : [...selected, value],
                          )
                        }
                      />
                      <span>{value}</span>
                      {selected[0] === value && <small>默认</small>}
                    </label>
                  ))}
                </div>
              ) : null;
            },
          )}
        </div>
      </div>
    </details>
  );
}
