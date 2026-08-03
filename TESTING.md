# 测试与验收说明

本文件给出**可复现**的验收流程与证据，覆盖键盘路径、屏幕阅读器公告、离线更新（含各阶段中断与配额不足）、回滚、首次离线启动、深链接迁移、全文检索确定性、阅读设置与焦点恢复。

## 1. 一键命令

```bash
npm install
npm run typecheck   # tsc -b --noEmit，strict + noUncheckedIndexedAccess
npm test            # vitest run，11 个测试文件 / 101 个用例（含两标签页并发、设置迁移、成环检测、配额降级）
npm run build       # tsc -b && vite build
npm run dev         # 原生浏览器验收：http://localhost:5173/
```

所有断言均在**无 UI 组件库 / 无全文检索库 / 无状态管理库**的前提下完成；IndexedDB 在 Node 中由 `fake-indexeddb` 提供，在浏览器中使用原生实现。

## 2. 分层与原子性保证

| 层 | 文件 | 职责 | 视图是否直接接触 |
|---|---|---|---|
| 解析/校验 | [parser.ts](src/content/parser.ts) | JSON→类型化完整包/增量包，结构校验 | 否 |
| 归并 | [resolver.ts](src/content/resolver.ts) | 把 v2 增量物化（REVISE/WITHDRAW/ADD）为完整包 | 否 |
| 完整性 | [checksum.ts](src/content/checksum.ts) | SHA-256 校验（Web Crypto + 纯回退） | 否 |
| 检索 | [search/index.ts](src/search/index.ts) | 自研中文一元/二元分词 + TF-IDF 倒排索引 | 否 |
| 存储 | [storage/db.ts](src/storage/db.ts)、[repository.ts](src/storage/repository.ts) | IndexedDB 暂存区、原子提交、回滚、设置 | **否** |
| 编排 | [services/contentService.ts](src/services/contentService.ts) | 下载→校验→归并→暂存→建索引→原子切换；阶段公告 | 仅通过此层 |
| 视图 | [App.tsx](src/App.tsx)、[components/](src/components) | React 视图、路由、a11y、焦点 | 不直接读写 IndexedDB |

原子切换的关键：`commit` 在**单个 `readwrite` 事务**内写入 `activeVersion`、`previousVersion` 并删除 `stagedVersion`；v2 提交时还在**同一事务**内写入迁移后的 `PersistedSettings`（schemaVersion 2）。视图持有的 `pack/index` 只在 `await commit()` 成功后才替换。暂存失败、校验失败、下载失败或任何阶段中断都不会改动 `activeVersion`，也不会留下跨版本混搭的设置。若事务在提交过程中被强制中止（模拟强制重启），IndexedDB 原子回滚整个事务，保证恢复后只能是「完整旧包 + 旧设置」或「完整新包 + 新设置」。

## 3. 自动化测试证据

> 所有用例均可通过 `npx vitest run <文件>` 单独复现。结果列来自最近一次 `npm test`：`Tests 101 passed (101)`。

### 3.1 键盘路径

| # | 场景 | 复现（测试名 / 文件） | 关键断言 | 结果 |
|---|---|---|---|---|
| K1 | 跳过链接是首个 Tab 目标 | `navigates topics and articles entirely by keyboard`  [app.test.tsx](tests/app.test.tsx) | 首次 `Tab` 聚焦“跳到主要内容” | ✅ |
| K2 | Tab 顺序覆盖返回首页/搜索/设置/更新/主题 | 同上 | 依次 `aria-label` 为 返回首页、打开搜索、阅读设置、检查更新、法律援助 | ✅ |
| K3 | 键盘 Enter 进入主题 | 同上 | 焦点移至主题 `<h1>`，URL 变为 `#/topic/TOPIC-AID` | ✅ |
| K4 | 键盘 Enter 打开文章 | 同上 | URL 变为 `#/article/ART-AID-1`，焦点移至文章 `<h1>` | ✅ |
| K5 | 浏览器后退恢复焦点 | 同上 | 后退后活动元素 `href="#/article/ART-AID-1"`（列表项重建后仍可重新定位） | ✅ |
| K6 | 所有图标按钮具可访问名称 | `exposes accessible names for all icon buttons` [app.test.tsx](tests/app.test.tsx) | 通过 `getByRole('button',{name})` 找到搜索/设置/更新按钮 | ✅ |

### 3.2 屏幕阅读器公告

| # | 场景 | 复现（测试名 / 文件） | 公告位置 | 结果 |
|---|---|---|---|---|
| A1 | 路由变更公告标题 | `announces route changes through the polite live region` [app.test.tsx](tests/app.test.tsx) | `role=status` 区域（`data-testid=live-region`）出现主题/文章标题 | ✅ |
| A2 | 更新进度与成功公告 | `announces update progress and success via a status region` [app.test.tsx](tests/app.test.tsx) | 顶部状态栏 `data-testid=update-status` 出现“已更新到版本 2026.09.01” | ✅ |
| A3 | 离线/失败公告且保留旧内容 | `announces failure and keeps old content when offline` [app.test.tsx](tests/app.test.tsx) | 状态栏出现“更新失败”，旧文章仍在文档中 | ✅ |
| A4 | 撤下文章跳转替代条目公告 | `redirects a withdrawn article deep link to its replacement after update` [app.test.tsx](tests/app.test.tsx) | `data-testid=notice-region` 出现"内容已更新，已为您跳转到替代文章：行动不便时的上门服务"；跳转后焦点移至替代文章 `<h1>` | ✅ |
| A5 | 状态不只靠颜色 | `communicates update status with text, not color alone` [app.test.tsx](tests/app.test.tsx) | 同时断言 `data-tone=status-success` 与文本内容；圆点 `aria-hidden` | ✅ |

实时区域实现见 [LiveRegion.tsx](src/components/LiveRegion.tsx)：`aria-live` + `aria-atomic`，通过 rAF 清空再赋值以保证重复文本也能被二次播报。

### 3.3 离线更新、阶段中断与配额

| # | 场景 | 复现（测试名 / 文件） | 旧版本保持完整的证据 | 结果 |
|---|---|---|---|---|
| U1 | 首次离线启动（无网络） | `boots offline from the bundled seed without any network` [atomic-update.test.ts](tests/atomic-update.test.ts) | 用捆绑种子初始化后 `fetch` 未被调用；更新失败后仍为 v1 | ✅ |
| U2 | **下载阶段中断**（onPhase 注入） | `discards staged data and keeps the complete v1 when interrupted at downloading` [atomic-update.test.ts](tests/atomic-update.test.ts) | `onPhase('downloading')` 抛 `UpdateAbortedError`；`activeVersion` 仍为 v1，无新包 | ✅ |
| U3 | 下载中途 `AbortSignal` 中断 | `keeps the complete v1 when the download is aborted mid-flight via AbortSignal` [atomic-update.test.ts](tests/atomic-update.test.ts) | 下载器以 `AbortError` reject；phase=failed，v1 不变，无 `stagedVersion` | ✅ |
| U4 | **签名/哈希校验阶段中断** | `…interrupted at verifying` [atomic-update.test.ts](tests/atomic-update.test.ts) | `onPhase('verifying')` 中断；校验前终止，无暂存、无新包 | ✅ |
| U5 | 校验和不符（哈希校验失败） | `keeps the complete old version when checksum mismatches` [atomic-update.test.ts](tests/atomic-update.test.ts) | 状态 phase=`failed` 且消息含“完整性”；v1 文章可检索 | ✅ |
| U6 | **暂存阶段中断** | `…interrupted at staging` [atomic-update.test.ts](tests/atomic-update.test.ts) | `onPhase('staging')` 在写入前中断；活动版本仍为 v1，无新包 | ✅ |
| U7 | **索引构建阶段中断**（已暂存后） | `…interrupted at indexing` [atomic-update.test.ts](tests/atomic-update.test.ts) | 候选包已写入暂存；中断后 `discardStagedCandidate` 删除，`getPack('2026.09.01')` 为 `null` | ✅ |
| U8 | **原子切换阶段中断** | `…interrupted at committing` [atomic-update.test.ts](tests/atomic-update.test.ts) | `onPhase('committing')` 在提交前中断；候选被丢弃，活动版本仍为 v1 | ✅ |
| U9 | IndexedDB 配额不足（暂存期间） | `keeps the complete old version when IndexedDB quota is exceeded during staging` [atomic-update.test.ts](tests/atomic-update.test.ts) | 注入 `QuotaExceededStorageError`；phase=failed，消息含“存储空间”，v1 不变 | ✅ |
| U10 | 提交前一刻视图仍只见旧包 | `exposes only the old pack right up to the atomic commit` [atomic-update.test.ts](tests/atomic-update.test.ts) | 在 `committing` 回调内读取 state，`packageVersion` 仍为 `2026.07.31` | ✅ |
| U11 | 模拟崩溃/重启后清理暂存与孤儿包 | `cleans up interrupted staging on restart and shows only the complete old pack` [atomic-update.test.ts](tests/atomic-update.test.ts)、storage `cleans up an interrupted staging on initialize` | 新 `ContentService.initialize` 后 `stagedVersion=null`、暂存/孤儿包被删除，只呈现完整旧包 | ✅ |
| U12 | 成功原子切换并重建索引 | `switches from v1 to v2 atomically and rebuilds the index` [atomic-update.test.ts](tests/atomic-update.test.ts) | v2 中 `ART-AID-2` 消失、`ART-SERVICE-3` 可检索，撤下映射保留 | ✅ |
| U13 | 阶段顺序确定 | `emits phase announcements in order` [atomic-update.test.ts](tests/atomic-update.test.ts) | 阶段严格为 downloading→verifying→resolving→staging→indexing→committing | ✅ |
| U14 | 仓储原子提交/丢弃/孤儿清理 | storage [storage.test.ts](tests/storage.test.ts) | 9 个用例覆盖 seed、stage+commit(带基础版本校验)、discard、rollback、设置持久化、重启清理 | ✅ |

> 中断注入方式：服务 `checkUpdate(url, { onPhase, signal, downloader })` 允许在任意阶段回调中抛出 `UpdateAbortedError`，或让 `downloader` reject，或用 `AbortController.abort()` 中断下载。配额不足通过在仓储 `stage` 抛出 `QuotaExceededStorageError` 模拟。重启通过新建 `ContentService` 并重新 `initialize` 复现；`initialize` 会清理未完成的暂存和任何孤儿包（非 active/previous/staged 的版本记录）。下载与校验通过后才会写入 IndexedDB，因此失败的下载不会留下任何分块。

### 3.4 两标签页并发

乐观并发控制：`commit(pack, expectedBaseVersion)` 在单个 `readwrite` 事务内读取当前 `activeVersion`，若不等于 `expectedBaseVersion` 则中止事务并抛 `UpdateConflictError`。IndexedDB 对同一 store 的读写事务串行化，因此只有一个标签页能提交；败者的候选包通过 `discardStagedCandidate` 安全删除（仅当它不是活动版本时），绝不可能被搜索或深链接读取。

| # | 场景 | 复现（测试名 / 文件） | 证据 | 结果 |
|---|---|---|---|---|
| C1 | 两标签页同时更新到**同一 v2** | `lets exactly one tab commit; both converge on v2 with no orphan data` [concurrency.test.ts](tests/concurrency.test.ts) | `Promise.allSettled` 两个 `checkUpdate`；只有一个事务提交，败者检测到活动版本已为 v2 并收敛；两标签页 `packageVersion` 均为 `2026.09.01`，无 stagedVersion，v1/v2 包各留存一份用于回滚 | ✅ |
| C2 | 两标签页更新到**不同版本** | `only one version becomes active; the failed candidate is deleted and unsearchable` [concurrency.test.ts](tests/concurrency.test.ts) | A 提交 v2 后 B 才提交其专属版本 → `UpdateConflictError`；B 的候选包 `2026.10.01` 被删除，B 收敛到 v2；两标签页搜索“替代版本专属文章”均 0 条命中；`getPack('2026.10.01')` 为 null | ✅ |
| C3 | 并发冲突后重启只可见完整胜者版本 | `shows only the complete winning version after restart with no leftover chunks or temp metadata` [concurrency.test.ts](tests/concurrency.test.ts) | 冲突后关闭连接并重启服务；活动版本为 v2，无 staged、无 `2026.10.01` 包，可见文章集合严格为 `[ART-AID-1, ART-NOTARY-1, ART-SERVICE-3]`，搜索不含败者内容 | ✅ |

> 复现要点：测试用两个 `ContentRepository.open()` 连接到同一个 fake-indexeddb（模拟两个浏览器标签页共享同一 IndexedDB）。不同版本场景通过让 B 的下载器等待 A 提交完成（`deferred` 屏障）来确定性地让 A 先提交，从而稳定触发冲突分支。

### 3.5 回滚

| # | 场景 | 复现（测试名 / 文件） | 证据 | 结果 |
|---|---|---|---|---|
| R1 | 服务层回滚到上一完整版本 | `rolls back to the previous complete version` [atomic-update.test.ts](tests/atomic-update.test.ts) | 更新到 v2 后 `rollback()` 返回 `2026.07.31`，活动包与索引恢复为 v1 | ✅ |
| R2 | UI 回滚按钮可回滚 | `updates to v2, shows new content, and can rollback to v1` [app.test.tsx](tests/app.test.tsx) | 点击“回滚到上一版本”后旧文章“行动不便时的服务方式”重新出现、新文章消失 | ✅ |
| R3 | 回滚历史版本留存 | `stages and atomically commits a new version` / `keeps the previous version for rollback` [storage.test.ts](tests/storage.test.ts) | 提交后 `previousVersion` 指向旧版，`rollback` 原子地改回指针 | ✅ |
| R4 | 重载后仍可回滚 | 浏览器原生验收（见 §4） | 重载后服务从 DB 读取 `previousVersion`，回滚按钮仍可见并可用 | ✅ |

### 3.6 跨版本确定性与深链接

| # | 场景 | 复现（测试名 / 文件） | 证据 | 结果 |
|---|---|---|---|---|
| D1 | 深链接直接打开文章 | `loads a topic and article directly from the hash` [app.test.tsx](tests/app.test.tsx) | `#/article/ART-NOTARY-1` 直接渲染标题与法律依据 | ✅ |
| D2 | 深链接打开搜索 | `loads search results from a deep link` [app.test.tsx](tests/app.test.tsx) | `#/search?q=公证` 渲染结果列表与计数 | ✅ |
| D3 | 撤下文章深链接自动迁移替代条目 | `redirects a withdrawn article deep link to its replacement after update` [app.test.tsx](tests/app.test.tsx) | 更新后访问 `#/article/ART-AID-2` 被替换为 `#/article/ART-SERVICE-3` 并公告 | ✅ |
| D4 | v1/v2 内同查询排序重复构建确定 | `produces deterministic search rankings for identical queries within each version` [atomic-update.test.ts](tests/atomic-update.test.ts) | v1、v2 各建两个独立索引，对“服务/法律援助/上门/公证”返回完全相同顺序 | ✅ |
| D5 | 撤下条目离开排名、替代条目进入排名 | `removes the withdrawn article from rankings and surfaces the replacement` [atomic-update.test.ts](tests/atomic-update.test.ts) | v1 搜“行动不便”含 ART-AID-2；v2 不含 ART-AID-2 且含 ART-SERVICE-3；`withdrawals` 映射正确 | ✅ |
| D6 | 离线重启后可见集合完整且确定 | `exposes a complete and deterministic visible set after an offline restart` [atomic-update.test.ts](tests/atomic-update.test.ts) | v2 重启后可见文章严格为 `[ART-AID-1, ART-NOTARY-1, ART-SERVICE-3]`，无 staged、无孤儿，检索一致 | ✅ |
| D7 | 回滚后可见集合完整回到 v1 | `rolls back to a complete v1 visible set after v2 was active` [atomic-update.test.ts](tests/atomic-update.test.ts) | 回滚后文章集合与种子完全一致，搜“行动不便”命中 ART-AID-2 且不含 ART-SERVICE-3 | ✅ |
| D8 | 检索排序在重复构建下确定 | `produces deterministic ordering across repeated queries and rebuilds` [search.test.ts](tests/search.test.ts) | 两个独立索引对同一查询返回相同顺序 | ✅ |
| D9 | 撤下条目不可检索、替代条目可检索 | `reflects withdrawn articles removed and new articles searchable in v2` [search.test.ts](tests/search.test.ts) | v2 搜“行动不便”不返回 ART-AID-2，搜“上门服务”首条为 ART-SERVICE-3 | ✅ |
| D10 | 阅读设置（含行距）跨更新保留 | `preserves reading settings across a version update` [atomic-update.test.ts](tests/atomic-update.test.ts) | 设为 large/dark/spacious 后更新到 v2，设置不变；UI 测试验证写入 `data-font-size`/`data-theme`/`data-line-spacing` 并持久化 | ✅ |
| D11 | REVISE/WITHDRAW/ADD 物化正确 | resolver [resolver.test.ts](tests/resolver.test.ts) | 9 个用例覆盖三类变更、基线不符、缺失替代条目、缺失主题、替代链成环、自引用成环 | ✅ |

### 3.7 设置 Schema 升级与原子迁移（第 3 轮）

阅读设置从 v1（`fontSize`、`theme`）升级到 v2（新增 `lineSpacing`）。`PersistedSettings` 以 `{schemaVersion, settings}` 包装；`commit` 在切换包版本的**同一事务**内写入迁移后的设置，确保包版本与设置 schema 始终一致。

| # | 场景 | 复现（测试名 / 文件） | 证据 | 结果 |
|---|---|---|---|---|
| S1 | v1 旧格式（无 wrapper）自动迁移 | `migrates legacy unwrapped v1 settings` [settings-migration.test.ts](tests/settings-migration.test.ts) | `{fontSize, theme}` → `{schemaVersion:1, settings:{...lineSpacing:'normal'}}` | ✅ |
| S2 | 已包装 v1 设置保留 schemaVersion | `preserves schema version for already-wrapped v1 settings` [settings-migration.test.ts](tests/settings-migration.test.ts) | `migrateSettings` 不把 v1 强制提升为 v2，保留原始版本号以匹配活动包 | ✅ |
| S3 | 无效枚举值被替换为默认值 | `sanitizes invalid enum values` / `partially sanitizes` [settings-migration.test.ts](tests/settings-migration.test.ts) | `fontSize:'huge'` 等非法值回退到默认；合法字段保留 | ✅ |
| S4 | schema 不匹配时安全降级 | `falls back when schema version does not match` [settings-migration.test.ts](tests/settings-migration.test.ts)、`v2 settings stored but v1 pack active` [round3-integration.test.ts](tests/round3-integration.test.ts) | v2 设置 + v1 包（或反之）时返回 fallback，不跨版本混搭 | ✅ |
| S5 | **提交事务同时写入包指针和设置** | `writes v2 settings and v2 pack pointer in the same commit transaction` [round3-integration.test.ts](tests/round3-integration.test.ts) | `commit(v2, base, migratedSettings)` 后 activeVersion=v2 且 settings.schemaVersion=2 | ✅ |
| S6 | **事务中止后完整恢复旧包+旧设置** | `preserves v1 settings + v1 pack when commit is interrupted` [round3-integration.test.ts](tests/round3-integration.test.ts) | 手动 abort 事务后 activeVersion 仍为 v1、settings.schemaVersion 仍为 1，无混搭 | ✅ |
| S7 | 重启清理暂存后设置不丢失 | `recovers to complete old pack + old settings after restart` [round3-integration.test.ts](tests/round3-integration.test.ts) | staged v2 被清理，v1 设置完整保留 | ✅ |
| S8 | saveSettings 按活动包自动选择 schema | `saves v1 schema when v1 pack is active` / `saves v2 schema when v2 pack is active` [round3-integration.test.ts](tests/round3-integration.test.ts) | v1 包下保存为 schemaVersion=1，v2 包下保存为 schemaVersion=2 | ✅ |
| S9 | 垃圾输入返回默认设置 | `returns default settings for null/garbage input` [settings-migration.test.ts](tests/settings-migration.test.ts) | null/undefined/string/number/array 均返回 CURRENT schema + 默认值 | ✅ |

### 3.8 深链接迁移、替代链成环与降级（第 3 轮）

`resolveArticleId` 遍历撤下替代链，支持多步跳转、成环检测和缺失链接检测。视图在焦点移至替代文章后通过 `aria-live=assertive` 区域宣布"内容已更新"。

| # | 场景 | 复现（测试名 / 文件） | 证据 | 结果 |
|---|---|---|---|---|
| L1 | 直接访问存在文章 | `returns available for an existing article` [deep-link.test.ts](tests/deep-link.test.ts) | 返回 `{kind:'available', redirectedFrom:null}` | ✅ |
| L2 | 撤下文章一跳到达替代 | `resolves a withdrawn article to its replacement` [deep-link.test.ts](tests/deep-link.test.ts) | ART-AID-2 → ART-SERVICE-3，redirectedFrom=ART-AID-2 | ✅ |
| L3 | 多步替代链 | `follows a multi-step chain to find available article` [deep-link.test.ts](tests/deep-link.test.ts) | ART-OLD-1 → ART-MIDDLE → ART-AID-1（可用） | ✅ |
| L4 | **替代链成环检测（运行时）** | `detects a cycle in the replacement chain` / `self-referencing cycle` [deep-link.test.ts](tests/deep-link.test.ts) | 返回 `{kind:'cycle', chain:[...]}`，视图渲染 `role="alert"` 降级消息 | ✅ |
| L5 | **物化时拒绝成环包** | `rejects a replacement chain that forms a cycle` / `self-referencing withdrawal cycle` [resolver.test.ts](tests/resolver.test.ts) | `applyDelta` 抛 `PackValidationError`，成环包不可被安装 | ✅ |
| L6 | 撤下但无替代文章 | `returns withdrawn when article was withdrawn without replacement` [deep-link.test.ts](tests/deep-link.test.ts) | 返回 `{kind:'withdrawn', replacementId:null}` | ✅ |
| L7 | 链终止于缺失文章 | `returns missing when a chain leads to a missing article` [deep-link.test.ts](tests/deep-link.test.ts) | 返回 `{kind:'missing'}` | ✅ |
| L8 | **UI 跳转后公告"内容已更新"并保留焦点** | `redirects a withdrawn article deep link to its replacement after update` [app.test.tsx](tests/app.test.tsx) | notice-region 含"内容已更新"+替代文章标题；`document.activeElement` 为替代文章 `<h1>` | ✅ |

### 3.9 IndexedDB 配额耗尽与稳定降级（第 3 轮）

设置保存采用乐观更新：先更新内存并通知视图，再异步写入 IndexedDB。配额不足时新设置仅在当前会话生效，已持久化的最后一次可用设置不被覆盖，并通过可见的 `degraded-banner`（`role="alert"`）公告。

| # | 场景 | 复现（测试名 / 文件） | 证据 | 结果 |
|---|---|---|---|---|
| Q1 | **配额不足时保留上次已保存设置** | `keeps new settings in-memory but preserves last saved in DB` [round3-integration.test.ts](tests/round3-integration.test.ts) | 注入 `QuotaExceededStorageError`；内存为新设置、DB 仍为旧设置、`degradedNotice` 含"存储空间不足" | ✅ |
| Q2 | 非配额错误回滚内存设置 | `rolls back in-memory settings on non-quota errors` [round3-integration.test.ts](tests/round3-integration.test.ts) | 普通 Error 时内存恢复为旧值，无 degradedNotice | ✅ |
| Q3 | 暂存阶段配额不足保留完整旧包 | `keeps the complete old version when IndexedDB quota is exceeded during staging` [atomic-update.test.ts](tests/atomic-update.test.ts) | phase=failed，消息含"存储空间"，v1 完整可用 | ✅ |

## 4. 原生浏览器验收

`npm run dev` 后在 http://localhost:5173/ 手动复现（已用集成浏览器实测通过）：

1. **首屏**：捆绑 v1 直接渲染“法律援助/公证费用减免”两主题，状态栏显示“当前版本 2026.07.31”。
2. **更新**：点击右上“检查更新”（刷新图标）→ 依次公告“正在下载/校验/归并/暂存/建索引/切换”，完成后出现“行动不便时的上门服务”，旧文“行动不便时的服务方式”消失，状态栏显示“已更新到版本 2026.09.01”，并出现“回滚到上一版本”。
3. **撤下迁移**：在地址栏访问 `http://localhost:5173/#/article/ART-AID-2`（v2 已生效）→ 自动跳到 `#/article/ART-SERVICE-3` 并公告替代。
4. **回滚**：点击“回滚到上一版本”→ 内容恢复为 v1；刷新页面后回滚按钮仍在（上一版本持久化在 IndexedDB）。
5. **阅读设置**：点击齿轮图标进入设置，切换字号/主题/行距，`<html>` 上 `data-font-size`/`data-theme`/`data-line-spacing` 立即变化并持久化。
6. **离线**：DevTools→Network→Offline 后刷新，应用仍从 IndexedDB/捆绑种子正常启动；点击"检查更新"公告失败且仍显示旧版本，无新旧混排。
7. **撤下深链接迁移**：v2 生效后访问 `#/article/ART-AID-2`，自动跳到替代文章，断言区域公告"内容已更新"，焦点移至新文章标题。

IndexedDB 结构（数据库名 `rights-pocket-guide`，版本 3）：

- `packs`（keyPath `packageVersion`）：完整物化包；
- `meta`（keyPath `key`）：`activeVersion`、`previousVersion`、`stagedVersion`；
- `settings`（keyPath `key`）：阅读设置，值为 `PersistedSettings {schemaVersion, settings}`，与活动包版本在同一提交事务中原子写入。

更新流程中，新包先写入 `packs` 并登记 `stagedVersion`；提交在**单个 `readwrite` 事务**内读取 `activeVersion` 并与预期基础版本比较（乐观并发），仅当一致时才改 `activeVersion`/`previousVersion` 并删除 `stagedVersion`。因此：

- 任一阶段失败/中断都不会移动 `activeVersion`，候选包由 `discardStagedCandidate` 删除（仅当它不是活动版本时），或在重启时由 `cleanupOrphanPacks` 清理；
- 两个标签页同时提交时，IndexedDB 串行化事务，只有一个能通过基础版本校验，另一个收到 `UpdateConflictError` 并丢弃自己的候选（或在同版本时收敛到已提交版本）；
- 下载与哈希校验通过后才写入 IndexedDB，失败下载不留下分块；检索索引只在内存中对活动包构建，暂存/失败版本的索引永远不会被视图或深链接读取。

所以用户在任何时刻、任何中断或并发之后，只能看到**完整旧包**或**完整新包**，排序、撤下替代关系与可见集合均确定。
