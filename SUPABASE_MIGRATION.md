# RouteX → Supabase 迁移文档

> 给 Codex（或任何执行者）看的工作文档。目标是：把配置存储从「编码进订阅 URL + 浏览器 localStorage」升级为「存进 Supabase 数据库」，支持一键保存配置、生成短分享链接、从链接加载配置继续编辑。

## 1. 目标

- 新增「保存配置」→ 生成短链接 `https://<vercel>.vercel.app/api/sub?id=<uuid>&k=<secret>`，替代超长 base64 URL
- 新增「从链接加载」→ 读取已保存配置到页面继续编辑
- 基础规则（`lib/base-rules.json`）可选入库，规则更新无需重新部署
- **不改变**现有的「编码进 URL」方式，保留为离线兜底

## 2. 现状（改动前关键文件）

| 文件 | 职责 |
|------|------|
| `lib/types.ts` | `AppConfig` 配置类型、`PreviewResult` |
| `lib/defaults.ts` | `buildDefaultConfig()`，含预填的数据库 IP / ChatGPT 域名 |
| `lib/core.ts` | `generateConfig(config)` / `previewConfig(config)`，纯函数，与存储无关 |
| `lib/base-rules.json` | 内置 iKuuu 规则集（9816 条） |
| `app/api/sub/route.ts` | `GET /api/sub?c=<base64url>`，`decodeConfig(c)` 解码后调 `generateConfig` |
| `app/api/preview/route.ts` | `POST /api/preview`，body 为 `{ config }` |
| `app/page.tsx` | 前端（client component），localStorage 读写 `clash-agg-config-v1` |

**关键结论**：`generateConfig(config: AppConfig): Promise<string>` 只依赖传入的 config 对象。接数据库的本质是「换一个 config 来源」，`lib/core.ts` 的生成逻辑一行都不用改。

## 3. 安全模型（重要，别跳过）

订阅地址含 token。配置一旦公开可读，token 就泄漏。因此：

- 采用**密链模型**：每个配置生成一个 `secret`（≥24 字节随机串），`/api/sub?id=..&k=<secret>` 携带 secret 才能读到配置。
- 所有数据库访问都在 Vercel 服务端完成（用 **service_role key**，绕过 RLS），secret 校验在应用代码里做（`where id = ? and secret = ?`）。
- 前端**绝不能**用 service_role key，也不直接连 Supabase；一律走自己封装的 `/api/*` 路由。
- `supabase/schema.sql` 里 RLS 全部 deny anon，防止有人用公开的 anon key 直查表。

环境变量（Vercel → Settings → Environment Variables；本地 `.env.local`）：
```
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<service_role_key>   # 只存在于服务端
```

## 4. 数据库

在 Supabase Dashboard → SQL Editor 执行仓库内的 `supabase/schema.sql`（已建好 `public.configs` 表、索引、updated_at 触发器、RLS）。

## 5. 依赖

```bash
npm install @supabase/supabase-js
```

## 6. 后端改动

### 6.1 新增 `lib/supabase.ts`（仅服务端引用）

```ts
import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
```

> 该文件只能被 `app/api/**` 引用。任何 `"use client"` 文件 import 它都会泄漏 service key，要避免。

### 6.2 新增 4 个 API 路由

统一约定：所有返回值 `Content-Type: application/json`；secret 一律用参数 `k` 传递。

1. **`POST /api/save`** — 保存配置
   - body: `{ config: AppConfig, name?: string }`
   - 逻辑：`slug = crypto.randomBytes(6).toString("base64url")`（短 ID，可重试直到唯一）；`secret = crypto.randomBytes(24).toString("base64url")`；`insert` 到 `configs`。
   - 返回：`{ id, slug, secret, url: "/api/sub?id=<id>&k=<secret>", loadUrl: "/api/load?id=<id>&k=<secret>" }`

2. **`GET /api/load`** — 读配置
   - query: `id`, `k`
   - 逻辑：`select config, name, slug from configs where id = <id> and secret = <k>.single()`；无记录返回 404。
   - 返回：`{ id, slug, name, config }`

3. **`POST /api/update`** — 更新配置
   - body: `{ id, k, config, name? }`
   - 逻辑：`update configs set config = <config>, name = coalesce(name, <name>) where id = <id> and secret = <k>`；affectedRows 为 0 返回 404。
   - 返回：`{ ok: true }`

4. **`POST /api/delete`** — 删除配置
   - body: `{ id, k }`
   - 逻辑：`delete from configs where id = <id> and secret = <k>`；为 0 返回 404。
   - 返回：`{ ok: true }`

所有路由加 `export const runtime = "nodejs"; export const maxDuration = 60;`

### 6.3 修改 `app/api/sub/route.ts`

保留现有 `?c=` base64 分支不动；在入口增加 `id`/`k` 分支：

```ts
const id = req.nextUrl.searchParams.get("id");
const k = req.nextUrl.searchParams.get("k");
if (id && k) {
  const { data } = await supabase
    .from("configs")
    .select("config")
    .eq("id", id)
    .eq("secret", k)
    .single();
  if (!data) return new Response("配置不存在或密钥错误", { status: 404 });
  config = data.config as AppConfig;
} else {
  // 原 decodeConfig(c) 逻辑
}
```

### 6.4 修改 `app/api/preview/route.ts`

不需要改动 —— 它本来就是 `POST { config }`，配置来自前端状态。

## 7. 前端改动（`app/page.tsx`）

1. 新增状态：`saved: { url: string; loadUrl: string } | null`，`loadInput: string`。
2. 在「⑤ 生成订阅链接」区域新增两个按钮：
   - **保存配置 / 生成短链**：`POST /api/save` → 展示 `saved.url` + 复制按钮；提示「把这个短链填进 Clash 订阅即可，以后改配置点『更新』」
   - **从链接加载**：输入框粘贴 `/api/sub?id=..&k=..`（或 `id&k`）→ 解析出 id/k → `GET /api/load` → `setConfig(data.config)`（并写入 localStorage）
3. 若 `saved` 非空，显示第三个按钮 **更新已保存的配置**：`POST /api/update`（带上保存时记下的 id/k）。
4. 现有 base64「生成订阅链接」保留，作为离线/兼容兜底。
5. localStorage 继续用作缓存，不删除。

## 8. 可选阶段：基础规则入库

目标：改 `lib/base-rules.json` 不用重新部署。

1. `supabase/schema.sql` 里取消 `base_rules` 单行表的注释并执行。
2. `lib/core.ts` 中 `BASE_RULES` 改为异步懒加载：
   - 优先查 `base_rules` 表（`select rules from base_rules where id = 1`），带模块级内存缓存；
   - 表里为空/查询失败时回退到 `import baseRulesJson from "./base-rules.json"`（现有逻辑）。
   - 注意：`BASE_RULES` 目前是模块级 `const`，`generateConfig`/`previewConfig` 直接引用。改为 `async function getBaseRules(): Promise<string[]>` 后，两个函数里 `const baseRules = await getBaseRules()`。
3. 新增 `scripts/upload-base-rules.mjs`：用 service key 把 `lib/base-rules.json` upsert 进 `base_rules(id=1)`；本地运行，或做成 Vercel Cron。

## 9. 测试

1. `npm run build` 通过。
2. `npm run dev`：
   - 保存配置 → 拿到短链 → 浏览器打开 `/api/sub?id=..&k=..` 返回合法 YAML（可用 `scripts/selftest.mjs` 的校验思路）；
   - `k` 错误时返回 404；
   - 从短链加载 → 页面状态与保存一致；
   - 更新后再加载，取到最新。
3. `scripts/selftest.mjs` 仍通过（它走 `?c=` 分支，验证回归）。

## 10. 部署

Vercel 项目 → Settings → Environment Variables 添加 `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY` → 重新部署。

## 11. 回滚

未配置环境变量时，`/api/save` 等新路由返回 501/500；base64「生成订阅链接」完全不受影响。删除环境变量或回滚提交即可回到纯 URL 模式。
