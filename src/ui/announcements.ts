// 屏幕阅读器公告文案集中管理：测试与视图共用同一份确定字符串。
export const announcements = {
  updated: (version: string): string => `已更新到内容版本 ${version}`,
  updateFailed: (version: string): string =>
    `更新失败，继续使用旧版本 ${version}`,
  alreadyCurrent: (version: string): string => `当前已是最新版本 ${version}`,
  rolledBack: (version: string): string => `已回滚到内容版本 ${version}`,
  rollbackUnavailable: "没有可回滚的版本",
  withdrawnRedirect: "原条目已撤下，已为你跳转到替代条目",
  searchResults: (count: number): string =>
    count > 0 ? `找到 ${count} 条结果` : "未找到匹配结果",
  settingsSaved: "阅读设置已保存",
} as const;
