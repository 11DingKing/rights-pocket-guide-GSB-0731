import type {
  Article,
  ContentChange,
  DeltaPack,
  FullPack,
  MaterializedPack,
  Topic,
  Withdrawal,
} from '../types';
import { PackValidationError } from './parser';

function articlesToRecord(articles: ReadonlyArray<Article>): Record<string, Article> {
  const record: Record<string, Article> = {};
  for (const article of articles) {
    if (record[article.id] !== undefined) {
      throw new PackValidationError(`重复的文章 ID: ${article.id}`);
    }
    record[article.id] = article;
  }
  return record;
}

function cloneTopics(topics: ReadonlyArray<Topic>): Topic[] {
  return topics.map((topic) => ({ ...topic, articleIds: [...topic.articleIds] }));
}

function findTopicIndexForArticle(
  topics: ReadonlyArray<Topic>,
  articleId: string,
): number {
  for (let i = 0; i < topics.length; i += 1) {
    const topic = topics[i];
    if (topic && topic.articleIds.includes(articleId)) {
      return i;
    }
  }
  return -1;
}

export function materializeFullPack(full: FullPack): MaterializedPack {
  const articleIds = new Set(full.articles.map((a) => a.id));
  for (const topic of full.topics) {
    for (const articleId of topic.articleIds) {
      if (!articleIds.has(articleId)) {
        throw new PackValidationError(
          `主题 ${topic.id} 引用了不存在的文章 ${articleId}`,
        );
      }
    }
  }
  const idSet = new Set<string>();
  for (const topic of full.topics) {
    if (idSet.has(topic.id)) {
      throw new PackValidationError(`重复的主题 ID: ${topic.id}`);
    }
    idSet.add(topic.id);
  }
  return {
    packageVersion: full.packageVersion,
    succeeds: full.succeeds ?? null,
    topics: full.topics.map((t) => ({ ...t, articleIds: [...t.articleIds] })),
    articles: articlesToRecord(full.articles),
    withdrawals: {},
  };
}

export function applyDelta(
  base: MaterializedPack,
  delta: DeltaPack,
): MaterializedPack {
  if (base.packageVersion !== delta.succeeds) {
    throw new PackValidationError(
      `增量包基于版本 ${delta.succeeds}，但当前版本为 ${base.packageVersion}`,
    );
  }

  const topics = cloneTopics(base.topics);
  const articles: Record<string, Article> = { ...base.articles };
  const withdrawals: Record<string, Withdrawal> = { ...base.withdrawals };

  const findTopic = (topicId: string): number => {
    const idx = topics.findIndex((t) => t.id === topicId);
    if (idx === -1) {
      throw new PackValidationError(`变更引用了不存在的主题: ${topicId}`);
    }
    return idx;
  };

  for (const change of delta.changes as ReadonlyArray<ContentChange>) {
    switch (change.kind) {
      case 'REVISE': {
        const existing = articles[change.articleId];
        if (existing === undefined) {
          throw new PackValidationError(
            `REVISE 引用了不存在的文章: ${change.articleId}`,
          );
        }
        const revised: Article = {
          id: existing.id,
          title: change.title ?? existing.title,
          body: change.body ?? existing.body,
          legalRef: change.legalRef ?? existing.legalRef,
        };
        articles[change.articleId] = revised;
        break;
      }
      case 'WITHDRAW': {
        if (articles[change.articleId] === undefined) {
          throw new PackValidationError(
            `WITHDRAW 引用了不存在的文章: ${change.articleId}`,
          );
        }
        const topicIdx = findTopicIndexForArticle(topics, change.articleId);
        if (topicIdx >= 0) {
          const topic = topics[topicIdx] as Topic;
          topics[topicIdx] = {
            ...topic,
            articleIds: topic.articleIds.filter((id) => id !== change.articleId),
          };
        }
        delete articles[change.articleId];
        withdrawals[change.articleId] = {
          replacementArticleId: change.replacementArticleId,
        };
        break;
      }
      case 'ADD': {
        if (articles[change.articleId] !== undefined) {
          throw new PackValidationError(
            `ADD 目标文章已存在: ${change.articleId}`,
          );
        }
        const topicIdx = findTopic(change.topicId);
        const topic = topics[topicIdx] as Topic;
        topics[topicIdx] = {
          ...topic,
          articleIds: [...topic.articleIds, change.articleId],
        };
        articles[change.articleId] = {
          id: change.articleId,
          title: change.title,
          body: change.body,
          legalRef: change.legalRef,
        };
        delete withdrawals[change.articleId];
        break;
      }
      default: {
        const exhaustive: never = change;
        throw new PackValidationError(`未处理的变更类型: ${String(exhaustive)}`);
      }
    }
  }

  for (const topic of topics) {
    for (const articleId of topic.articleIds) {
      if (articles[articleId] === undefined) {
        throw new PackValidationError(
          `物化后主题 ${topic.id} 引用了缺失的文章 ${articleId}`,
        );
      }
    }
  }

  for (const [withdrawnId, withdrawal] of Object.entries(withdrawals)) {
    const replacementId = withdrawal.replacementArticleId;
    if (replacementId !== null && articles[replacementId] === undefined) {
      throw new PackValidationError(
        `撤下文章 ${withdrawnId} 的替代文章 ${replacementId} 在包中不存在`,
      );
    }
  }

  return {
    packageVersion: delta.packageVersion,
    succeeds: delta.succeeds,
    topics,
    articles,
    withdrawals,
  };
}
