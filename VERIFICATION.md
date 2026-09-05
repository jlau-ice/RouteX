# RouteX 验证记录

验证日期：2026-09-05。Node.js 22.22.3 / Next.js 16.3.0。

## 已完成

- `npm test`：13 项通过，覆盖真实生成流程、同名节点来源隔离、重复与提示记录过滤、来源限定、手选默认节点、测速/故障转移、失效目标、循环引用、IPv6 和公网地址校验。
- 同一测试命令使用本地 PGlite 验证 SQL：初始化重复执行、保存、按 UUID 读取、凭编辑凭证更新、错误凭证拒绝、匿名枚举与直接写入拒绝。
- `npm run build`：生产构建及 TypeScript 检查通过。
- `npm run lint`：无错误；遗留 `scripts/Script-v2.js` 的 `main` 存在一条未使用变量警告。
- 三个用户订阅真实请求成功：iKuuu 46 个、Qiwu 10 个、FastFly 24 个，共 80 个节点。FastFly 的 4 条流量/到期/官网提示已排除。
- iKuuu 在线规则与内置 9,816 条规则逐条一致。
- 最终生成的 80 节点 / 17 策略组 / 9,826 条规则配置，使用 Mihomo v1.19.30 `-t` 校验通过。节点连通性与 ChatGPT 解锁情况未测试。
- 浏览器检查：桌面与 390px 手机布局，手机内容宽度与视口一致；配置导入、订阅刷新、GPT 默认节点修改、手选节点、重载恢复、规则搜索与目标修改、恢复默认分流。
- 原 Supabase 项目恢复后复查为 `ACTIVE_HEALTHY`，现有 `routex_configs`、`routex_base_rules` 及所需 RPC 均可用，无需执行初始化迁移。
- 使用三个真实订阅通过本地生产服务验证现有云端接口：新建配置、凭编辑凭证恢复、修改 GPT 默认节点且 UUID 不变、缺少/错误凭证读取被拒绝、错误凭证写入被拒绝。
- 云端保存后的 `/api/sub?id=…` 返回 80 节点 / 17 策略组 / 9,826 条规则，采用更新后的 GPT 默认节点；Mihomo v1.19.30 `-t` 再次通过。
- 浏览器成功恢复同一云端配置并发布更新，显示已与云端同步。

## 外部阻塞

- Vercel 原项目：`routex`，团队 `ices-projects-d9a9adc7`。CLI 已关联原项目。部署被 Vercel 拒绝：`Your Team exceeded our fair use limits and has been blocked.`
- 原生产域名 `https://routex-amber.vercel.app` 返回 HTTP 402，`x-vercel-error: DEPLOYMENT_DISABLED`。本次新版本未部署成功。
- 登录后的 Vercel 团队面板仍显示 `Paused`、`Upgrade to resume service`；近 30 天 Fluid Active CPU 为 12 小时 39 秒，额度为 4 小时。登录状态正常，限制来自团队额度。
- 2026-09-05 按用户要求，通过官方暂停接口停用 `mx-space-core`；读取项目确认 `paused: true`。团队 CPU 用量中该项目占 94.9%（11 小时 24 分钟），RouteX 为 16 秒。团队恢复后也应保留 `mx-space-core` 的暂停状态，除非用户另行要求恢复。
- 团队 API 显示 2026-09-04 20:26:38（北京时间）因 `fluidCpuDuration` 触发 `FAIR_USE_LIMITS_EXCEEDED`。用量图从 8 月 13 日起持续累积；暂停项目不会清除近 30 天的历史用量，9 月 6 日不能仅因跨日自动恢复额度。

## 继续完成

1. 恢复 Vercel 团队的部署权限。
2. 将已通过测试和生产构建的当前版本部署至已关联的原项目，检查生产 `/api/preview`、`/api/config` 和 `/api/sub`。

个人订阅测试文件仅在私有临时目录中，未写入源代码。Git 提交包含应用代码、测试和验证记录，不包含个人订阅凭证及本机 IDE 配置。
