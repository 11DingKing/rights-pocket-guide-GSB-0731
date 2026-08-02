import type {
  AddChange,
  Article,
  ContentChange,
  DeltaPack,
  FullPack,
  RawPack,
  ReviseChange,
  Topic,
  WithdrawChange,
} from '../types';

export class PackValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PackValidationError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new PackValidationError(`字段 ${field} 必须是非空字符串`);
  }
  return value;
}

function parseTopic(raw: unknown, index: number): Topic {
  if (!isRecord(raw)) {
    throw new PackValidationError(`主题[${index}] 不是对象`);
  }
  const id = requireString(raw.id, `topics[${index}].id`);
  const title = requireString(raw.title, `topics[${index}].title`);
  if (!Array.isArray(raw.articleIds)) {
    throw new PackValidationError(`topics[${index}].articleIds 必须是数组`);
  }
  const articleIds = raw.articleIds.map((id, i) =>
    requireString(id, `topics[${index}].articleIds[${i}]`),
  );
  return { id, title, articleIds };
}

function parseArticle(raw: unknown, index: number): Article {
  if (!isRecord(raw)) {
    throw new PackValidationError(`文章[${index}] 不是对象`);
  }
  return {
    id: requireString(raw.id, `articles[${index}].id`),
    title: requireString(raw.title, `articles[${index}].title`),
    body: requireString(raw.body, `articles[${index}].body`),
    legalRef: requireString(raw.legalRef, `articles[${index}].legalRef`),
  };
}

function parseChange(raw: unknown, index: number): ContentChange {
  if (!isRecord(raw)) {
    throw new PackValidationError(`变更[${index}] 不是对象`);
  }
  const kind = requireString(raw.kind, `changes[${index}].kind`);
  switch (kind) {
    case 'REVISE': {
      const change: ReviseChange = {
        kind: 'REVISE',
        articleId: requireString(raw.articleId, `changes[${index}].articleId`),
        ...(typeof raw.title === 'string' ? { title: raw.title } : {}),
        ...(typeof raw.body === 'string' ? { body: raw.body } : {}),
        ...(typeof raw.legalRef === 'string' ? { legalRef: raw.legalRef } : {}),
      };
      return change;
    }
    case 'WITHDRAW': {
      const change: WithdrawChange = {
        kind: 'WITHDRAW',
        articleId: requireString(raw.articleId, `changes[${index}].articleId`),
        replacementArticleId: requireString(
          raw.replacementArticleId,
          `changes[${index}].replacementArticleId`,
        ),
      };
      return change;
    }
    case 'ADD': {
      const change: AddChange = {
        kind: 'ADD',
        topicId: requireString(raw.topicId, `changes[${index}].topicId`),
        articleId: requireString(raw.articleId, `changes[${index}].articleId`),
        title: requireString(raw.title, `changes[${index}].title`),
        body: requireString(raw.body, `changes[${index}].body`),
        legalRef: requireString(raw.legalRef, `changes[${index}].legalRef`),
      };
      return change;
    }
    default:
      throw new PackValidationError(`未知变更类型: ${kind}`);
  }
}

export function parseRawPack(rawText: string): RawPack {
  let json: unknown;
  try {
    json = JSON.parse(rawText);
  } catch (cause) {
    throw new PackValidationError('内容包不是合法 JSON');
  }
  if (!isRecord(json)) {
    throw new PackValidationError('内容包根节点必须是对象');
  }
  const packageVersion = requireString(json.packageVersion, 'packageVersion');

  const hasChanges = Array.isArray(json.changes);
  const hasTopics = Array.isArray(json.topics) && Array.isArray(json.articles);

  if (hasChanges) {
    const succeeds = requireString(json.succeeds, 'succeeds');
    const changes = (json.changes as unknown[]).map(parseChange);
    const delta: DeltaPack = {
      packageVersion,
      succeeds,
      changes,
      ...(typeof json.checksum === 'string' ? { checksum: json.checksum } : {}),
      ...(Array.isArray(json.failureCases)
        ? { failureCases: (json.failureCases as unknown[]).map((v, i) => requireString(v, `failureCases[${i}]`)) }
        : {}),
    };
    return delta;
  }

  if (hasTopics) {
    const topics = (json.topics as unknown[]).map(parseTopic);
    const articles = (json.articles as unknown[]).map(parseArticle);
    const full: FullPack = {
      packageVersion,
      ...(typeof json.succeeds === 'string' ? { succeeds: json.succeeds } : {}),
      topics,
      articles,
    };
    return full;
  }

  throw new PackValidationError('内容包必须包含 topics/articles（完整包）或 changes（增量包）');
}

export function isDeltaPack(pack: RawPack): pack is DeltaPack {
  return (pack as DeltaPack).changes !== undefined;
}
