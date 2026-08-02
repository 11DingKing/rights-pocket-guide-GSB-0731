# 验证证据（可复现）

本文档用表格列出键盘路径、屏幕阅读器公告、离线更新与回滚、深链接迁移与
阅读设置 schema 迁移的测试证据。所有证据均可通过下面的命令复现。

## 复现命令

| 步骤 | 命令 | 预期结果 |
| --- | --- | --- |
| 安装依赖 | `npm install` | 安装 React/Vite/Vitest 等（无 UI 组件库、无检索库、无状态管理库） |
| 自动化测试 | `npm test` | 10 个测试文件、73 个用例全部通过 |
| 类型检查 + 构建 | `npm run build` | `tsc --noEmit`（strict）零错误，Vite 产出 `dist/` |
| 本地运行 | `npm run dev` | `predev` 生成带真实 SHA-256 + ECDSA 签名的 `public/materials/manifest.json` |

测试直接使用 `materials/content-pack-v1.json`（全量包）与 `materials/content-pack-v2.json`
（增量包：REVISE / WITHDRAW→替代条目 / ADD）这两份真实 fixture；
“更新服务器”由测试内的 manifest（真实 SHA-256 + 真实 ECDSA 签名）+
可注入中断的下载器模拟；签名密钥为开发 fixture（`scripts/dev-signing-key.json`，
公钥内置在 `src/services/signingKeys.ts` 作为信任锚）。

## 分层与约束（有自动化守护）

| 约束 | 实现 | 守护测试（tests/architecture.test.ts） |
| --- | --- | --- |
| 解析 / 索引 / 存储 / 视图分层 | `src/core`（纯函数）→ `src/storage`（IndexedDB）→ `src/services`（编排与仓储）→ `src/ui`（React） | ui 层不直接依赖 storage 层或 IndexedDB API |
| 视图不直接读写 IndexedDB | 视图只经 `Repository`（src/services/repository.ts）读写 | 同上，源码扫描断言 |
| 不用 `any` / 非空断言 | `JSON.parse` 一律收敛为 `unknown` 再经类型守卫收窄 | 源码扫描四类模式，命中即失败 |

## 原子切换设计

内容按 `packageVersion` 整体切换，阅读设置 schema 与包版本绑定，
任何时候用户只看到“完整旧包+旧设置”或“完整新包+新设置”：

1. 更新管线八阶段：下载 → 哈希校验（下载字节 SHA-256 对照清单权威值）→
   签名校验（清单签名是对 sha256 的 ECDSA P-256 签名，必须过应用内置公钥）→
   解析 → 物化（增量应用，`succeeds` 必须等于当前版本；替代链归一化，成环即拒绝）→
   建索引（随包整体落库，不跨版本复用）→ 暂存（`staged`）→ 原子切换。
2. 切换是**单个 IndexedDB 事务**（`packages`+`meta`+`settings` 三仓同事务）：
   新包 `staged→active`、旧包 `active→retained`、激活指针翻转、
   **设置 schema 迁移（current=迁移后、backup=更新前）**——四者同生同死；
   提交前崩溃/失败 ⇒ 事务整体回滚 ⇒ 旧包+旧设置完整保留。
3. 并发控制（多标签页）：切换事务内先核对基线版本（乐观并发，不符即抛
   `SwitchConflictError` 整体放弃）；暂存写入不覆盖 `active` 记录
   （`retained` 允许覆盖——回滚后重新更新同一版本的合法路径，有回归测试）；
   落败方若发现目标版本已被对方提交，收敛为 `already-current` 并重载一致视图。
4. 启动引导：清理所有未激活的暂存包，只读 `active` 指针指向的完整记录；
   指针损坏时回退到 `retained` 版本，再不行则用应用内捆绑的种子包（v1）重新播种。
5. 设置抢救（启动/更新/回滚共用同一确定性优先级）：目标 schema 的 current →
   目标 schema 的 backup → 迁移 current（保留偏好）→ 迁移 backup → 默认值；
   抢救结果写回 current 自愈，backup 不动。**最后一次可用设置不会丢失。**
6. 回滚也是**单事务**：包翻转 + 设置恢复（next=更新前备份，backup=当前设置）。
7. 不存在“分块存储”：内容包与索引作为**整条 staged 记录**原子写入；
   视图/搜索/深链接只读 `active` 记录，staged 残留天然不可见（有专项测试）。

## 离线更新与回滚证据

| 场景（中断/故障注入点） | 预期行为 | 自动化测试证据 |
| --- | --- | --- |
| 首次启动完全离线 | 捆绑种子包播种，渲染完整 v1（主题/检索可用） | updateFlow › 首次离线启动；ui › 首次离线启动（UI） |
| 下载清单中断 | `failed@download`，继续完整使用 v1 | updateFlow › 下载清单中断 |
| 下载内容包字节中断 | `failed@download`，继续完整使用 v1 | updateFlow › 下载内容包字节中断 |
| 清单缺少签名字段 | `failed@download`（解析拒绝），旧包完整 | signature › 清单缺少签名字段 |
| 字节被篡改（SHA-256 不匹配） | `failed@checksum`，继续完整使用 v1 | updateFlow › 校验和不匹配；core › 字节被篡改时校验失败 |
| 攻击者换钥重签清单 | `failed@signature`（信任锚不通过），旧包完整 | signature › 攻击者换钥重签清单 |
| 签名对象被篡改 | `failed@signature`，旧包完整 | signature › 签名对象被篡改 |
| 包体非法 JSON | `failed@parse`，继续完整使用 v1 | updateFlow › 包体非法 JSON |
| 增量基线 `succeeds` 不匹配 | `failed@materialize`，拒绝跨版本混合 | updateFlow › 增量基线不匹配；core › succeeds 不一致拒绝物化 |
| 增量包内替代链成环 | `failed@materialize`（“撤下链存在循环”），旧包完整 | schemaMigration › 替代链成环（core + 流程两级） |
| 索引构建中断 | `failed@index`，继续完整使用 v1 | indexFailure › 建索引崩溃 |
| IndexedDB 配额不足（暂存写入抛 `QuotaExceededError`） | 映射为“存储空间不足”，`failed@staging`，旧包完整、无残留 | updateFlow › IndexedDB 配额不足（暂存阶段） |
| 切换事务提交前崩溃 | `failed@switch`，重启后旧包完整、暂存被清理 | updateFlow › 切换事务提交前崩溃 |
| 进程在“暂存完成、切换未发生”之间崩溃 | 重启后只见完整旧包，暂存包被启动引导清理 | updateFlow › 进程在暂存完成、切换未发生之间崩溃 |
| 失败版本的暂存包+索引残留在库中 | 搜索/深链接/法条索引仍只读激活版本；重启后残留被清理 | isolation › 暂存包及其索引物理存在时仍只读激活版本 |
| 两个标签页同时更新 | 只有一个提交成功（基线乐观并发），另一方收敛 `already-current`；双方最终同为完整 v2，无暂存残留 | multiTab › 并发更新；基线校验；迟到的暂存写入不覆盖 active |
| **设置迁移写一半崩溃**（切换事务内 settings 写注入 QuotaExceededError） | 整个切换事务回滚：**完整旧设置+完整旧包**；重试后完整同新 | schemaMigration › 迁移写入一半时崩溃 |
| 半写现场 A：包已 v2、设置仍 v1 schema | 启动迁移恢复为 v2 设置，偏好逐项保留（同新） | schemaMigration › 现场 A |
| 半写现场 B：包仍 v1、设置已 v2 schema | 启动用 backup 恢复 v1 设置（同旧） | schemaMigration › 现场 B |
| 半写现场 C：current/backup 均损坏 | 按包 schema 回退默认值并写回自愈，应用稳定 | schemaMigration › 现场 C；uiSettings › 无效偏好降级 |
| 手动回滚 | 单事务：包翻转 + 设置精确恢复更新前备份；backup 记为回滚前设置 | schemaMigration › 回滚恢复；ui › 回滚（UI） |
| 回滚后再次更新同一版本 | retained 记录可被重新暂存覆盖，切换成功（回归） | schemaMigration › 更新→回滚→再次更新 |
| 更新成功 | 八阶段按序发生；完整 v2 + schema 2 设置；备份为更新前设置 | updateFlow › 更新成功路径；schemaMigration › 更新成功（设置迁移） |
| 已是最新 | 不重复安装 | updateFlow › 已经是最新版本时不重复安装 |
| 完整性判定方式 | 失败后激活包与 v1 物化结果**深度相等**（非抽样） | helpers.expectCompleteV1 / expectCompleteV2 被上述用例调用 |

## 确定性保证证据

| 保证 | 机制 | 自动化测试证据 |
| --- | --- | --- |
| 全文检索排序跨版本确定 | 自研 CJK 二元切分 + 词权重（标题 3 / 法条 2 / 正文 1），同分按 articleId 升序；索引随包落库 | core › 检索；isolation › 同一查询在两个版本中的排序 |
| v1/v2 相同查询排序对比 | v1 `上门服务`→[ART-AID-2]；v2 →[ART-SERVICE-3]；未受影响查询跨版本逐位一致 | isolation › 同一查询在两个版本中的排序各自确定 |
| 撤下条目替代深链接跨版本确定 | 撤下链物化时归一化；v1 无映射、v2 `ART-AID-2→ART-SERVICE-3`、回滚后恢复 | isolation › 撤下替代关系按版本确定；updateFlow › 替代深链接跨版本确定；ui › 撤下条目深链接 |
| 深链接迁移（更新时正在读被撤下条目） | 焦点保留 → 跳替代条目 → 宣布“内容已更新：原条目已撤下…” | uiSettings › 深链接迁移（焦点+公告+地址替换） |
| 替代链成环（存储损坏） | 解析层带环检测返回 broken，UI 渲染稳定降级页（焦点落标题+assertive 公告+可用出路），其余内容不受影响 | schemaMigration › broken 而非死循环；uiSettings › 替代链成环的可访问降级状态 |
| 无效用户偏好 | 启动抢救链回退默认/备份，界面稳定（radio 可点、根属性有效） | schemaMigration › 现场 C；uiSettings › 无效偏好的可访问降级状态 |
| 偏好写入配额耗尽 | updateSettings 落盘失败 → ok:false → 内存/界面保持最后一次可用设置 + assertive 降级公告；恢复后可再写 | schemaMigration › 偏好写入配额耗尽；uiSettings › 配额耗尽写设置 |
| 离线重启后的可见集合完整确定 | 只读 active 记录；成功后=完整 v2 集合；失败后=完整 v1 集合；重复重启逐位相同 | isolation › 更新成功后离线重启 / 更新失败后离线重启 |
| 设置 schema 与包版本绑定 | 迁移随切换同事务；回滚随翻转同事务；界面按 schema 渲染（schema 2 才有字间距） | schemaMigration 全部；uiSettings › 设置 schema 随版本升级/回滚 |
| 阅读设置跨版本保持 | 独立 settings 仓 + backup 记录；跨版本偏好逐项保留 | updateFlow › 阅读设置跨版本；ui › 阅读设置跨版本保持 |
| 焦点恢复跨版本确定 | 路由切换聚焦主标题；更新/回滚后焦点恢复到当前页主标题；撤下跳转后焦点落在替代条目标题 | ui › 更新成功 / 撤下条目深链接 / 回滚（UI）；uiSettings › 深链接迁移 |
| 多标签页结果确定 | 恰好一方 `updated`，另一方 `already-current`；库中仅一份完整 active v2 | multiTab › 并发更新 |

## 键盘路径证据

| 路径 | 按键序列 | 期望焦点落点 | 自动化测试证据 |
| --- | --- | --- | --- |
| 跳到主要内容 | Tab（页首）→ Enter | “跳到主要内容”链接 → `#main-content` 容器 | ui › 完整键盘路径 › Tab/Enter 走通 |
| 主题浏览 → 主题 → 条目 | Tab → Enter（法律援助）→ Tab → Enter（首条目） | 主题主标题 → 条目链接 → 条目标题 | 同上 |
| 反向回到页头 | Shift+Tab ×6 | 检查更新按钮 → 设置 → 法律依据 → 检索 → 主题 → 跳到主要内容 | 同上 |
| 键盘检索 | Enter（检索导航）→ Tab → 输入关键词 → Tab×3 → Enter | 检索主标题 → 搜索框 → 清除按钮 → 搜索按钮 → 首条结果 → 条目标题 | ui › 键盘完成检索并进入结果条目 |
| 设置页控件 | Tab 遍历，方向键切换 radio | 原生 radio 组（字号/主题/行距，schema 2 加字间距）与按钮均可达 | ui / uiSettings › 设置相关用例 |
| 降级页出路 | 替代链成环降级页 → Tab → Enter（返回主题浏览） | 回到主题浏览主标题 | uiSettings › 替代链成环的可访问降级状态 |
| 图标按钮 | Tab 至“清除搜索”→ Enter/空格 | 按钮有可访问名称“清除搜索”，激活后焦点回到输入框 | ui › 图标按钮与状态表达 |

## 屏幕阅读器公告证据

双通道 live region：`role="status"`（polite）用于一般状态，`role="alert"`（assertive）用于失败与降级；
状态同时以可见文本呈现，不只靠颜色表达。

| 事件 | 通道 | 公告文案 | 自动化测试证据 |
| --- | --- | --- | --- |
| 更新成功 | polite | 已更新到内容版本 2026.09.01 | ui › 屏幕阅读器公告 › 更新成功 |
| 更新失败（断网） | assertive | 更新失败，继续使用旧版本 2026.07.31（另有可见状态文本） | ui › 更新失败（断网） |
| 已是最新 | polite | 当前已是最新版本 {version} | UpdateControl 文案（announcements.alreadyCurrent） |
| 撤下条目跳转（内容经更新而来） | assertive | **内容已更新：**原条目已撤下，已为你跳转到替代条目 | uiSettings › 深链接迁移；ui › 撤下条目深链接 |
| 替代链成环降级 | assertive | 该条目的替代关系存在异常，已为你显示稳定的降级页面 | uiSettings › 替代链成环的可访问降级状态 |
| 设置保存配额失败 | assertive | 设置保存失败：存储空间不足，当前阅读设置保持不变 | uiSettings › 配额耗尽写设置 |
| 检索有结果 | polite | 找到 N 条结果（另有可见“共 N 条结果”） | ui › 检索结果数量公告 |
| 检索无结果 | polite | 未找到匹配结果（另有可见“共 0 条结果”） | 同上 |
| 设置已保存 | polite | 阅读设置已保存 | ui › 阅读设置保存有 polite 公告 |
| 回滚成功 | polite | 已回滚到内容版本 2026.07.31 | ui › 回滚（UI） |
| 无可回滚版本 | assertive | 没有可回滚的版本 | SettingsView.onRollback 分支 |

## 真实浏览器冒烟（`npm run dev`，真实 IndexedDB / fetch / WebCrypto）

| 步骤 | 结果 |
| --- | --- |
| 设置页（v2 激活，旧格式设置记录） | 启动恢复为 schema 2：字间距控件出现，当前版本 2026.09.01，可回滚 2026.07.31 |
| 点击“回滚到上一版本” | 版本回到 2026.07.31，字间距控件随 schema 1 消失（包+设置同事务恢复） |
| 回滚后点击“检查更新” | 首次暴露回归缺陷：`switch：没有可激活的暂存包`（暂存守卫吞掉 retained 覆盖）→ 已修复并加回归测试；修复后同一状态点击成功：`已更新到 2026.09.01` |
| 访问 `#/article/ART-AID-2`（v2 激活后） | 地址被替换为 `#/article/ART-SERVICE-3`（撤下条目深链接迁移生效） |
| 控制台 | 无错误 |
