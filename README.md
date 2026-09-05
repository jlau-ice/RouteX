# RouteX

多订阅聚合与 Clash / Mihomo 分流工作区。把多个订阅汇成一个固定链接，沿用 iKuuu 的 9,816 条基础规则，为 ChatGPT、工作服务等选择独立线路。

## 使用

1. 在「订阅来源」添加 Clash YAML 订阅，也可每行一个批量导入；刷新后显示节点数、流量及到期信息。
2. 在「节点与策略组」选择来源，使用手动勾选、名称正则或全部节点建立组。组内支持手选默认节点、自动测速、故障转移。
3. 「分流规则」保留 iKuuu 原始顺序与默认目标；自定义域名 / IP 规则优先执行，可通过上移按钮调整优先级。ChatGPT 快捷配置会建立专线域名规则。
4. 「发布与同步」生成固定订阅链接，导入 Clash。以后发布更新，客户端刷新同一链接即可。刷新会应用网页设定的默认节点；运行期间仍可在客户端临时切换。
5. 使用右上角导出配置备份。新设备可导入 JSON，或凭「配置 ID 编辑凭证」恢复云端配置。

订阅地址和编辑凭证不会出现在公开默认配置中。备份与聚合链接包含使用节点的权限，请妥善保管。

## 聚合行为

- 支持含 `proxies` 的 Clash YAML，保留 SS、VMess、VLESS、Trojan、Hysteria2 等节点的协议参数。
- 每个节点使用 `[订阅名称] 节点名`，不同来源的同名节点互不覆盖。相同来源的完全重复记录、明确的流量与到期提示会被过滤。
- 停用或失败的来源保留策略组身份，其他来源仍可用。专用组没有节点时回退到 `REJECT`，不会悄悄改走别的线路。
- 节点组重命名会同步更新引用。订阅重命名后刷新节点。旧版无前缀节点只在能唯一识别时自动迁移；同名歧义需要重新选择。
- iKuuu 默认国内、哔哩哔哩、Steam 登录下载、学术网站走直连；广告拦截；其他类别跟随主策略组。
- 自定义规则支持域名、完整网址、IPv4/IPv6 CIDR、有限的 RAW 类型。空白规则、重复组名、危险正则、循环引用会明确报错。
- 暂不支持 Base64 URI 订阅或仅含 `proxy-providers` 的配置，界面会提示格式要求。
- 自动测速与故障转移在 Clash 客户端执行。网页无法直接判断节点是否可连通或是否解锁 ChatGPT。

## 开发与验证

```sh
npm ci
npm run dev
npm test
npm run lint
npm run build
```

本项目使用 Next.js 16.3；修改前参考 `node_modules/next/dist/docs/`。测试使用隔离的订阅样本，验证整个配置生成过程，不依赖个人订阅或在线数据库。

`lib/base-rules.json` 是 iKuuu 规则副本。`scripts/extract-base-rules.mjs` 可从本机 Clash 配置提取更新。`scripts/selftest.mjs` 是早期手工联调脚本，当前自动回归入口是 `npm test`。

## 配置存储

### 本地 PostgreSQL

本地运行可以直接连接 PostgreSQL 16，不需要 Supabase。先创建项目独立数据库：

```sh
createdb -h 127.0.0.1 routex
```

在 `.env.local` 中设置连接地址（用户名按本机 PG 账户填写）：

```sh
DATABASE_URL=postgresql://your_username@127.0.0.1:5432/routex
```

初始化表并启动（Node.js 22.9+）：

```sh
npm run db:init
npm run dev -- --hostname 127.0.0.1
```

打开 `http://127.0.0.1:3000`。本地模式的配置保存在 PostgreSQL，iKuuu 基础规则使用仓库副本，不请求 Supabase。数据库初始化可以重复执行，已有配置会保留。更新和恢复配置仍校验编辑凭证。

本地聚合链接供同一电脑的 Clash 使用，刷新订阅时需保持 RouteX 和 PostgreSQL 运行。下载的 YAML 可直接导入其他设备。网站和数据库放在不同电脑时，请使用可达的服务地址。

本地与 Supabase 的已发布配置分开保存，浏览器草稿继续保留。可用 JSON 备份转移配置；切换存储后导入另一模式的备份会生成新的链接，不复用原数据库的 ID。已有 Supabase 配置不会自动复制到本机。

### Supabase / Vercel

Vercel 部署时不设置 `DATABASE_URL`，继续使用 Supabase。`.env.local` 不提交到 Git，也不要把本机数据库地址配置到 Vercel。

生产域名：`https://routex-amber.vercel.app`。

新建数据库时，执行 `supabase/schema.sql` 初始化项目专用表、RLS 和 RPC。该脚本支持空数据库初始化，不需要预先存在 `routex_configs` 表。原 RouteX 项目已具备所需表和接口，恢复后可直接使用。配置存储与编辑校验均通过 `security invoker` RPC；不使用 service role 访问当前版本的配置。

环境变量可覆盖项目中现有的 Supabase 公开地址与 publishable key：

```sh
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

不要把 service role key 设置成 `NEXT_PUBLIC_` 变量。旧版 `/api/save` 等兼容接口才需要额外的服务端 `SUPABASE_SERVICE_ROLE_KEY` 和旧 `configs` 表。原数据库暂停时，先恢复项目；缺少云端存储时仍可以预览并下载 YAML。

```sh
vercel link --project routex
vercel deploy
vercel deploy --prod
```

## 接口

| 接口                                         | 用途                                       |
| -------------------------------------------- | ------------------------------------------ |
| `POST /api/preview`，`{ config }`            | 节点、来源状态、用量、分组、规则统计与警告 |
| `POST /api/render`，`{ config }`             | 生成当前草稿的 Clash YAML，无需保存        |
| `POST /api/config`，`{ config }`             | 创建配置，返回 `id` 与 `editKey`           |
| `PUT /api/config`，`{ id, editKey, config }` | 原链接更新，校验编辑凭证                   |
| `GET /api/config?id=…`，`X-RouteX-Edit-Key`  | 恢复可编辑配置                             |
| `GET /api/sub?id=…`                          | 获取保存配置的最新聚合 YAML                |
| `GET /api/sub?c=…`                           | 兼容旧版压缩配置链接                       |

订阅请求限定 HTTP / HTTPS 公网地址，每次重定向重新校验并固定 DNS 地址，限制时间与响应大小。在 Clash TUN fake-IP 环境中，会通过加密 DNS 解析真实公网地址后继续校验。
