# RouteX

多订阅聚合 + 规则可视化配置，输出单一订阅链接给 Clash 使用。

把多个机场订阅合并成一个；使用项目内置的 iKuuu 原始规则，为每个规则类别选择实际节点、节点组、直连或拒绝；
支持自定义规则（最高优先级）。配置通过前端页面编辑，生成时保存到 Supabase，订阅链接只携带不可猜测的 UUID。

## 功能

- **订阅聚合**：可填多个订阅地址，节点全部合并去重（按节点名）；订阅只提供节点
- **内置基础规则**：iKuuu 规则集内置在项目里（`lib/base-rules.json`），不依赖任何订阅，自动提取规则类别（动画疯 / Steam / 国内网站 / 广告拦截…）
- **自动识别节点**：每个导入订阅自动成为一个节点组，规则也可以直接选择任意单个节点
- **可选筛选组**：可以用正则或手动勾选节点，建立台湾 / 日本 / 香港等自定义节点组
- **规则映射**：每个 iKuuu 规则类别可以指向单个节点、导入订阅组、自定义组、Clash“选择节点”、自动测速、`DIRECT` 或 `REJECT`
- **批量新增规则**：Host / 域名 / IP 可以一次粘贴多个并指定同一个目标，最高优先级
- **个人配置快照**：规则映射、批量新增规则和节点选择可以保存到 Supabase，每个生成链接互不影响
- **规则可更新**：iKuuu 规则更新后，运行 `node scripts/extract-base-rules.mjs` 重新生成内置规则集

## Supabase 云存储（可选）

把配置保存到 Supabase、生成短链（`/api/sub?id=&k=`），改配置后一键更新。

- SQL：执行 `supabase/schema.sql`（Supabase SQL Editor）
- 环境变量：`SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`（Vercel → Settings → Environment Variables）
- 完整迁移方案见 `SUPABASE_MIGRATION.md`
- 未配置 Supabase 时相关接口返回 501，base64 链接不受影响

## 本地运行

```bash
npm install
npm run dev
```

打开 http://localhost:3000 即可使用。

## 接口

| 接口 | 说明 |
|------|------|
| `GET /api/sub?c=<配置>` | 拉取订阅 → 合并 → 按配置重写规则 → 返回 Clash YAML（填进 Clash 的订阅地址） |
| `GET /api/sub?id=&k=` | 从 Supabase 读取已保存配置生成 YAML（短链） |
| `POST /api/config` | body `{ config }`，把不可变配置快照保存到 Supabase，返回 UUID |
| `GET /api/sub?id=<UUID>` | 从 Supabase 读取配置 → 拉取订阅 → 合并 → 返回 Clash YAML |
| `POST /api/preview` | body `{ config }`，返回总节点 / 各节点组匹配数 / 基础规则类别 |
| `POST /api/save` / `GET /api/load` / `POST /api/update` / `POST /api/delete` | 配置云端存储（密链模型），需配置 Supabase |

## 部署到 Vercel

**方式 A：Vercel CLI**

```bash
npm i -g vercel
vercel        # 首次会要求登录并选择项目
vercel --prod # 部署到生产
```

**方式 B：GitHub 导入**

把本项目推送到 GitHub 仓库，然后在 [vercel.com/new](https://vercel.com/new) 导入该仓库即可。仓库内置当前 Supabase 项目的公开 URL 与 publishable key；也可以通过 `SUPABASE_URL` 和 `SUPABASE_PUBLISHABLE_KEY` 环境变量覆盖它们。

## 在 Clash Verge Rev 中使用

1. 打开 RouteX 页面，填入订阅地址（只提供节点；规则用内置的 iKuuu 规则集）
2. 页面会自动提取规则类别；为每个类别选择承接的节点组（可自动识别 / 手动逐节点选择）
3. 点击「生成订阅链接」，复制生成的地址
4. Clash Verge Rev → 订阅 → 添加订阅，粘贴地址即可
5. 之后机场更新节点时，Clash 按设定的刷新周期拉取该地址，自动拿到最新合并结果

## 安全说明

- 订阅地址（含 token）只在 `/api/sub` 的服务端拉取，浏览器不会直接访问机场接口（有 CORS 限制）
- Supabase 表启用了 RLS；匿名请求不能直接枚举或插入数据，只能通过受限 RPC 保存配置，并凭完整 UUID 读取单条配置
- UUID 订阅链接仍属于“能力链接”：拿到链接的人可以使用其中保存的订阅配置，请勿公开分享
- 使用的是 Supabase publishable key，不是 `service_role` / secret key；管理员密钥不会进入代码或浏览器

## 目录结构

```
app/
  page.tsx           # 配置界面（纯前端 React）
  api/sub/route.ts   # 订阅生成接口
  api/config/route.ts # Supabase 配置持久化接口
  api/preview/route.ts # 预览接口
lib/
  types.ts           # 配置类型
  defaults.ts        # 默认配置（含预填的数据库 IP / ChatGPT 域名）
  core.ts            # 合并 / 正则识别 / 规则重写 / YAML 生成
  base-rules.json    # 内置的 iKuuu 基础规则集
  config-validation.ts # 不可信配置的运行时校验与大小限制
  supabase-storage.ts # 通过 Supabase Data API 调用受限 RPC
scripts/
  selftest.mjs       # 端到端自测脚本
  extract-base-rules.mjs # 重新生成内置规则集
  Script-v2.js       # 兼容双订阅的全局扩展脚本（备用）
```
