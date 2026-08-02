import { PackParseError } from "./errors";
import type {
  Article,
  ArticleWire,
  ChangeWire,
  ContentPackage,
  DeltaPackageWire,
  FullPackageWire,
  ManifestEntry,
  Topic,
  TopicWire,
  UpdateManifest,
} from "./types";

// 把 JSON.parse 的 any 收拢为 unknown，之后只允许通过类型守卫收窄。
export function parseJsonUnknown(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new PackParseError(["不是合法的 JSON 文本"]);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(
  record: Record<string, unknown>,
  key: string,
  problems: string[],
): string {
  const value = record[key];
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  problems.push(`字段 ${key} 缺失或不是非空字符串`);
  return "";
}

function readStringArray(
  record: Record<string, unknown>,
  key: string,
  problems: string[],
): string[] {
  const value = record[key];
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value as string[];
  }
  problems.push(`字段 ${key} 缺失或不是字符串数组`);
  return [];
}

function parseTopic(input: unknown, problems: string[]): TopicWire | null {
  if (!isRecord(input)) {
    problems.push("topic 不是对象");
    return null;
  }
  const before = problems.length;
  const topic: TopicWire = {
    id: readString(input, "id", problems),
    title: readString(input, "title", problems),
    articleIds: readStringArray(input, "articleIds", problems),
  };
  return problems.length === before ? topic : null;
}

function parseArticle(input: unknown, problems: string[]): ArticleWire | null {
  if (!isRecord(input)) {
    problems.push("article 不是对象");
    return null;
  }
  const before = problems.length;
  const article: ArticleWire = {
    id: readString(input, "id", problems),
    title: readString(input, "title", problems),
    body: readString(input, "body", problems),
    legalRef: readString(input, "legalRef", problems),
  };
  return problems.length === before ? article : null;
}

export function parseFullPackage(input: unknown): FullPackageWire {
  const problems: string[] = [];
  if (!isRecord(input)) {
    throw new PackParseError(["内容包不是对象"]);
  }
  const packageVersion = readString(input, "packageVersion", problems);
  const rawTopics = input["topics"];
  const rawArticles = input["articles"];
  const topics: TopicWire[] = [];
  const articles: ArticleWire[] = [];
  if (Array.isArray(rawTopics)) {
    for (const item of rawTopics) {
      const topic = parseTopic(item, problems);
      if (topic !== null) {
        topics.push(topic);
      }
    }
  } else {
    problems.push("字段 topics 缺失或不是数组");
  }
  if (Array.isArray(rawArticles)) {
    for (const item of rawArticles) {
      const article = parseArticle(item, problems);
      if (article !== null) {
        articles.push(article);
      }
    }
  } else {
    problems.push("字段 articles 缺失或不是数组");
  }
  if (problems.length > 0) {
    throw new PackParseError(problems);
  }
  return { packageVersion, topics, articles };
}

function parseChange(input: unknown, problems: string[]): ChangeWire | null {
  if (!isRecord(input)) {
    problems.push("change 不是对象");
    return null;
  }
  const kind = input["kind"];
  const before = problems.length;
  let change: ChangeWire | null = null;
  if (kind === "REVISE") {
    change = {
      kind,
      articleId: readString(input, "articleId", problems),
      title: readString(input, "title", problems),
      body: readString(input, "body", problems),
    };
  } else if (kind === "WITHDRAW") {
    change = {
      kind,
      articleId: readString(input, "articleId", problems),
      replacementArticleId: readString(input, "replacementArticleId", problems),
    };
  } else if (kind === "ADD") {
    change = {
      kind,
      topicId: readString(input, "topicId", problems),
      articleId: readString(input, "articleId", problems),
      title: readString(input, "title", problems),
      body: readString(input, "body", problems),
      legalRef: readString(input, "legalRef", problems),
    };
  } else {
    problems.push(`未知 change 类型 ${String(kind)}`);
  }
  return change !== null && problems.length === before ? change : null;
}

export function parseDeltaPackage(input: unknown): DeltaPackageWire {
  const problems: string[] = [];
  if (!isRecord(input)) {
    throw new PackParseError(["增量包不是对象"]);
  }
  const packageVersion = readString(input, "packageVersion", problems);
  const succeeds = readString(input, "succeeds", problems);
  const rawChanges = input["changes"];
  const changes: ChangeWire[] = [];
  if (Array.isArray(rawChanges)) {
    for (const item of rawChanges) {
      const change = parseChange(item, problems);
      if (change !== null) {
        changes.push(change);
      }
    }
  } else {
    problems.push("字段 changes 缺失或不是数组");
  }
  if (problems.length > 0) {
    throw new PackParseError(problems);
  }
  const rawChecksum = input["checksum"];
  const delta: DeltaPackageWire = { packageVersion, succeeds, changes };
  if (typeof rawChecksum === "string" && rawChecksum.length > 0) {
    delta.checksum = rawChecksum;
  }
  return delta;
}

/** 全量包物化：校验引用完整性，产出运行时模型。 */
export function materializeFull(wire: FullPackageWire): ContentPackage {
  const problems: string[] = [];
  const articles: Record<string, Article> = {};
  for (const article of wire.articles) {
    if (articles[article.id] !== undefined) {
      problems.push(`重复的条目 id ${article.id}`);
    }
    articles[article.id] = { ...article };
  }
  const topics: Topic[] = [];
  const topicIds = new Set<string>();
  for (const topic of wire.topics) {
    if (topicIds.has(topic.id)) {
      problems.push(`重复的主题 id ${topic.id}`);
    }
    topicIds.add(topic.id);
    for (const articleId of topic.articleIds) {
      if (articles[articleId] === undefined) {
        problems.push(`主题 ${topic.id} 引用了不存在的条目 ${articleId}`);
      }
    }
    topics.push({
      id: topic.id,
      title: topic.title,
      articleIds: [...topic.articleIds],
    });
  }
  if (problems.length > 0) {
    throw new PackParseError(problems);
  }
  return {
    packageVersion: wire.packageVersion,
    baseVersion: null,
    topics,
    articles,
    withdrawals: {},
  };
}

function parseManifestEntry(
  input: unknown,
  problems: string[],
): ManifestEntry | null {
  if (!isRecord(input)) {
    problems.push("manifest 条目不是对象");
    return null;
  }
  const before = problems.length;
  const packageVersion = readString(input, "packageVersion", problems);
  const url = readString(input, "url", problems);
  const sha256 = readString(input, "sha256", problems);
  const kindRaw = input["kind"];
  if (kindRaw !== "full" && kindRaw !== "delta") {
    problems.push("manifest 条目 kind 必须是 full 或 delta");
  }
  if (problems.length !== before) {
    return null;
  }
  const kind = kindRaw as "full" | "delta";
  const rawSucceeds = input["succeeds"];
  const entry: ManifestEntry = { packageVersion, url, sha256, kind };
  if (typeof rawSucceeds === "string" && rawSucceeds.length > 0) {
    entry.succeeds = rawSucceeds;
  }
  if (kind === "delta" && entry.succeeds === undefined) {
    problems.push(`delta 条目 ${packageVersion} 缺少 succeeds`);
    return null;
  }
  return entry;
}

export function parseManifest(input: unknown): UpdateManifest {
  const problems: string[] = [];
  if (!isRecord(input)) {
    throw new PackParseError(["manifest 不是对象"]);
  }
  const latest = readString(input, "latest", problems);
  const rawPackages = input["packages"];
  const packages: ManifestEntry[] = [];
  if (Array.isArray(rawPackages)) {
    for (const item of rawPackages) {
      const entry = parseManifestEntry(item, problems);
      if (entry !== null) {
        packages.push(entry);
      }
    }
  } else {
    problems.push("字段 packages 缺失或不是数组");
  }
  if (problems.length > 0) {
    throw new PackParseError(problems);
  }
  return { latest, packages };
}
