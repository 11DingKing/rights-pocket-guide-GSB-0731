# 验证证据（可复现）

本文档用表格列出键盘路径、屏幕阅读器公告、离线更新与回滚的测试证据。
所有证据均可通过下面的命令复现。

## 复现命令

| 步骤 | 命令 | 预期结果 |
| --- | --- | --- |
| 安装依赖 | `npm install` | 安装 React/Vite/Vitest 等（无 UI 组件库、无检索库、无状态管理库） |
| 自动化测试 | `npm test` | 5 个测试文件、45 个用例全部通过 |
| 类型检查 + 构建 | `npm run build` | `tsc --noEmit`（strict）零错误，Vite 产出 `dist/` |
| 本地运行 | `npm run dev` | `predev` 生成 `public/materials/manifest.json`（真实 SHA-256），服务起于 `http://localhost:5173/` |

测试直接使用 `materials/content-pack-v1.json`（全量包）与 `materials/content-pack-v2.json`
（增量包：REVISE / WITHDRAW→替代条目 / ADD）这两份真实 fixture；
“更新服务器”由测试内的 manifest（真实 SHA-256）+ 可注入中断的下载器模拟。

## 分层与约束（有自动化守护）

| 约束 | 实现 | 守护测试（tests/architecture.test.ts） |
| --- | --- | --- |
| 解析 / 索引 / 存储 / 视图分层 | `src/core`（纯函数）→ `src/storage`（IndexedDB）→ `src/services`（编排与仓储）→ `src/ui`（React） | ui 层不直接依赖 storage 层或 IndexedDB API |
| 视图不直接读写 IndexedDB | 视图只经 `Repository`（src/services/repository.ts）读写 | 同上，源码扫描断言 |
| 不用 `any` / 非空断言 | `JSON.parse` 一律收敛为 `unknown` 再经类型守卫收窄 | 源码扫描四类模式，命中即失败 |

## 原子切换设计

内容按 `packageVersion` 整体切换，任何时候用户只看到“完整旧包”或“完整新包”：

1. 更新管线七阶段：下载 → 校验（下载字节 SHA-256 对照清单权威值）→ 解析 →
   物化（增量应用，`succeeds` 必须等于当前版本）→ 建索引（随包整体落库，不跨版本复用）→
   暂存（`staged`）→ 原子切换。
2. 切换是**单个 IndexedDB 事务**：新包 `staged→active`、旧包 `active→retained`、
   激活指针翻转，三者同生同死；提交前崩溃/失败 ⇒ 事务回滚 ⇒ 旧版本完整。
3. 启动引导：清理所有未激活的暂存包，只读 `active` 指针指向的完整记录；
   指针损坏时回退到 `retained` 版本，再不行则用应用内捆绑的种子包（v1）重新播种。
4. 阅读设置存放在独立的 `settings` 仓，不参与内容包事务，跨版本保留。

## 离线更新与回滚证据

| 场景（中断/故障注入点） | 预期行为 | 自动化测试证据 |
| --- | --- | --- |
| 首次启动完全离线 | 捆绑种子包播种，渲染完整 v1（主题/检索可用） | updateFlow › 首次离线启动；ui › 首次离线启动（UI） |
| 下载清单中断 | `failed@download`，继续完整使用 v1 | updateFlow › 下载清单中断 |
| 下载内容包字节中断 | `failed@download`，继续完整使用 v1 | updateFlow › 下载内容包字节中断 |
| 字节被篡改（SHA-256 不匹配） | `failed@checksum`，继续完整使用 v1 | updateFlow › 校验和不匹配；core › 字节被篡改时校验失败 |
| 包体非法 JSON | `failed@parse`，继续完整使用 v1 | updateFlow › 包体非法 JSON |
| 增量基线 `succeeds` 不匹配 | `failed@materialize`，拒绝跨版本混合 | updateFlow › 增量基线不匹配；core › succeeds 与当前版本不一致时拒绝物化 |
| 索引构建中断 | `failed@index`，继续完整使用 v1 | indexFailure › 建索引崩溃 |
| IndexedDB 配额不足（暂存写入抛 `QuotaExceededError`） | 映射为“存储空间不足”，`failed@staging`，旧包完整、无残留 | updateFlow › IndexedDB 配额不足（暂存阶段）；错误映射 › QuotaExceededError 映射 |
| 切换事务提交前崩溃 | `failed@switch`，重启后旧包完整、暂存被清理 | updateFlow › 切换事务提交前崩溃 |
| 进程在“暂存完成、切换未发生”之间崩溃 | 重启后只见完整旧包，暂存包被启动引导清理 | updateFlow › 进程在暂存完成、切换未发生之间崩溃 |
| 更新成功 | 七阶段按序发生，切换后为完整 v2，旧版进入 `retained` | updateFlow › 更新成功路径（断言阶段序列与完整 v2） |
| 已是最新 | 不重复安装 | updateFlow › 已经是最新版本时不重复安装 |
| 手动回滚 | 单事务交换 `active/retained`，回到完整旧版本；无可回滚版本时为空操作 | updateFlow › 回滚；ui › 回滚（UI） |
| 完整性判定方式 | 失败后激活包与 v1 物化结果**深度相等**（非抽样） | helpers.expectCompleteV1 / expectCompleteV2 被上述全部用例调用 |

## 确定性保证证据

| 保证 | 机制 | 自动化测试证据 |
| --- | --- | --- |
| 全文检索排序跨版本确定 | 自研 CJK 二元切分 + 词权重（标题 3 / 法条 2 / 正文 1），得分相同按 articleId 升序；索引随包落库 | core › 检索（确定性重建、排序、tie-break、AND 语义）；updateFlow › 失败后的确定性行为 |
| 撤下条目替代深链接跨版本确定 | 撤下链在物化时归一化到最终有效条目；v1 直达、v2 跳转、回滚后再次直达 | updateFlow › 撤下条目的替代深链接跨版本确定；ui › 撤下条目深链接 |
| 阅读设置跨版本保持 | 独立 `settings` 仓，不随内容包事务变化 | updateFlow › 阅读设置存放在独立仓；ui › 阅读设置跨版本保持 |
| 焦点恢复跨版本确定 | 路由切换聚焦主标题；更新/回滚完成后焦点恢复到当前页主标题；撤下跳转后焦点落在替代条目标题 | ui › 更新成功 / 撤下条目深链接 / 回滚（UI）中的 `toHaveFocus()` 断言 |

## 键盘路径证据

| 路径 | 按键序列 | 期望焦点落点 | 自动化测试证据 |
| --- | --- | --- | --- |
| 跳到主要内容 | Tab（页首）→ Enter | “跳到主要内容”链接 → `#main-content` 容器 | ui › 完整键盘路径 › Tab/Enter 走通 |
| 主题浏览 → 主题 → 条目 | Tab → Enter（法律援助）→ Tab → Enter（首条目） | 主题主标题 → 条目链接 → 条目标题 | 同上 |
| 反向回到页头 | Shift+Tab ×6 | 检查更新按钮 → 设置 → 法律依据 → 检索 → 主题 → 跳到主要内容 | 同上 |
| 键盘检索 | Enter（检索导航）→ Tab → 输入关键词 → Tab×3 → Enter | 检索主标题 → 搜索框 → 清除按钮 → 搜索按钮 → 首条结果 → 条目标题 | ui › 键盘完成检索并进入结果条目 |
| 设置页控件 | Tab 遍历，方向键切换 radio | 原生 radio 组（字号/主题/行距）与按钮均可达 | ui › 阅读设置相关用例（`getByRole('radio')` 驱动） |
| 图标按钮 | Tab 至“清除搜索”→ Enter/空格 | 按钮有可访问名称“清除搜索”，激活后焦点回到输入框 | ui › 图标按钮与状态表达 |

## 屏幕阅读器公告证据

双通道 live region：`role="status"`（polite）用于一般状态，`role="alert"`（assertive）用于失败与撤下跳转；
状态同时以可见文本呈现，不只靠颜色表达。

| 事件 | 通道 | 公告文案 | 自动化测试证据 |
| --- | --- | --- | --- |
| 更新成功 | polite | 已更新到内容版本 2026.09.01 | ui › 屏幕阅读器公告 › 更新成功 |
| 更新失败（断网） | assertive | 更新失败，继续使用旧版本 2026.07.31（另有可见状态文本） | ui › 更新失败（断网） |
| 已是最新 | polite | 当前已是最新版本 {version} | UpdateControl 文案（announcements.alreadyCurrent） |
| 撤下条目跳转 | assertive | 原条目已撤下，已为你跳转到替代条目 | ui › 撤下条目深链接 |
| 检索有结果 | polite | 找到 N 条结果（另有可见“共 N 条结果”） | ui › 检索结果数量公告 |
| 检索无结果 | polite | 未找到匹配结果（另有可见“共 0 条结果”） | 同上 |
| 设置已保存 | polite | 阅读设置已保存 | ui › 阅读设置保存有 polite 公告 |
| 回滚成功 | polite | 已回滚到内容版本 2026.07.31 | ui › 回滚（UI） |
| 无可回滚版本 | assertive | 没有可回滚的版本 | SettingsView.onRollback 分支（announcements.rollbackUnavailable） |

## 真实浏览器冒烟（`npm run dev`，真实 IndexedDB / fetch / WebCrypto）

| 步骤 | 结果 |
| --- | --- |
| 打开 `http://localhost:5173/` | 首屏渲染：跳转链接、主导航（aria-current）、主题列表、版本徽标 `当前版本 2026.07.31` |
| 点击“检查更新” | 页面出现 `2026.09.01`（下载→真实 SHA-256 校验→原子切换成功） |
| 访问 `#/article/ART-AID-2` | 地址被替换为 `#/article/ART-SERVICE-3`（撤下条目深链接迁移生效） |
