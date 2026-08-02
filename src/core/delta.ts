import { PackParseError, UpdatePathError } from "./errors";
import type { Article, ContentPackage, DeltaPackageWire, Topic } from "./types";

/**
 * 把增量包应用到已物化的旧版本上，产出完整的新版本。
 * 任何一步校验失败都抛错：调用方因此不会得到“新旧混合”的结果。
 */
export function applyDelta(
  base: ContentPackage,
  delta: DeltaPackageWire,
): ContentPackage {
  if (delta.succeeds !== base.packageVersion) {
    throw new UpdatePathError(
      `增量包 ${delta.packageVersion} 要求基线 ${delta.succeeds}，当前版本 ${base.packageVersion} 不满足`,
    );
  }

  const problems: string[] = [];
  const articles: Record<string, Article> = {};
  for (const [id, article] of Object.entries(base.articles)) {
    articles[id] = { ...article };
  }
  const topics: Topic[] = base.topics.map((topic) => ({
    id: topic.id,
    title: topic.title,
    articleIds: [...topic.articleIds],
  }));
  const withdrawals: Record<string, string> = { ...base.withdrawals };

  const findTopic = (topicId: string): Topic | undefined =>
    topics.find((topic) => topic.id === topicId);

  for (const change of delta.changes) {
    if (change.kind === "REVISE") {
      const existing = articles[change.articleId];
      if (existing === undefined) {
        problems.push(`REVISE 目标 ${change.articleId} 不存在或已撤下`);
        continue;
      }
      articles[change.articleId] = {
        id: existing.id,
        title: change.title,
        body: change.body,
        legalRef: existing.legalRef,
      };
    } else if (change.kind === "WITHDRAW") {
      if (articles[change.articleId] === undefined) {
        problems.push(`WITHDRAW 目标 ${change.articleId} 不存在或已撤下`);
        continue;
      }
      if (withdrawals[change.articleId] !== undefined) {
        problems.push(`WITHDRAW 目标 ${change.articleId} 已被撤下过一次`);
        continue;
      }
      delete articles[change.articleId];
      withdrawals[change.articleId] = change.replacementArticleId;
      for (const topic of topics) {
        topic.articleIds = topic.articleIds.filter(
          (id) => id !== change.articleId,
        );
      }
    } else {
      const topic = findTopic(change.topicId);
      if (topic === undefined) {
        problems.push(`ADD 目标主题 ${change.topicId} 不存在`);
        continue;
      }
      if (
        articles[change.articleId] !== undefined ||
        withdrawals[change.articleId] !== undefined
      ) {
        problems.push(`ADD 条目 ${change.articleId} 已存在`);
        continue;
      }
      articles[change.articleId] = {
        id: change.articleId,
        title: change.title,
        body: change.body,
        legalRef: change.legalRef,
      };
      topic.articleIds.push(change.articleId);
    }
  }

  // 归一化撤下链：每个撤下条目都指向最终仍然有效的替代条目。
  for (const withdrawnId of Object.keys(withdrawals)) {
    const seen = new Set<string>([withdrawnId]);
    let target = withdrawals[withdrawnId];
    while (target !== undefined && withdrawals[target] !== undefined) {
      if (seen.has(target)) {
        problems.push(`撤下链存在循环，涉及 ${withdrawnId}`);
        break;
      }
      seen.add(target);
      target = withdrawals[target];
    }
    if (target === undefined || articles[target] === undefined) {
      problems.push(`撤下条目 ${withdrawnId} 的替代条目无效`);
    } else {
      withdrawals[withdrawnId] = target;
    }
  }

  if (problems.length > 0) {
    throw new PackParseError(problems);
  }

  return {
    packageVersion: delta.packageVersion,
    baseVersion: base.packageVersion,
    topics,
    articles,
    withdrawals,
  };
}
