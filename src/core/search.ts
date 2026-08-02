import type { ContentPackage } from './types';

// 自研全文检索：CJK 二元切分 + 字母数字词；AND 语义；确定性排序。
export interface Posting {
  articleId: string;
  titleHits: number;
  bodyHits: number;
  legalHits: number;
}

export interface SearchIndex {
  /** term -> 按 articleId 升序排列的命中列表（构建时即固定顺序）。 */
  postings: Record<string, Posting[]>;
}

export interface SearchHit {
  articleId: string;
  score: number;
}

const TITLE_WEIGHT = 3;
const LEGAL_WEIGHT = 2;
const BODY_WEIGHT = 1;

function isCjk(codePoint: number): boolean {
  return (
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff)
  );
}

function isAlphaNumeric(char: string): boolean {
  return /[\p{L}\p{N}]/u.test(char) && !isCjk(char.codePointAt(0) ?? 0);
}

/**
 * 切词：连续 CJK 字符切成二元组（单字保留单字），
 * 其余连续的字母/数字切成小写词。同一文本切分结果恒定。
 */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  let cjkRun = '';
  let wordRun = '';

  const flushCjk = (): void => {
    if (cjkRun.length === 1) {
      tokens.push(cjkRun);
    } else if (cjkRun.length > 1) {
      for (let index = 0; index + 1 < cjkRun.length; index += 1) {
        tokens.push(cjkRun.slice(index, index + 2));
      }
    }
    cjkRun = '';
  };
  const flushWord = (): void => {
    if (wordRun.length > 0) {
      tokens.push(wordRun.toLowerCase());
      wordRun = '';
    }
  };

  for (const char of text) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (isCjk(codePoint)) {
      flushWord();
      cjkRun += char;
    } else if (isAlphaNumeric(char)) {
      flushCjk();
      wordRun += char;
    } else {
      flushCjk();
      flushWord();
    }
  }
  flushCjk();
  flushWord();
  return tokens;
}

function countTokens(text: string, counts: Map<string, number>): void {
  for (const token of tokenize(text)) {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
}

/** 建索引：遍历顺序与输出顺序完全由数据决定，同一内容包必得同一索引。 */
export function buildSearchIndex(pack: ContentPackage): SearchIndex {
  const perTerm = new Map<string, Map<string, Posting>>();
  const articleIds = Object.keys(pack.articles).sort();

  for (const articleId of articleIds) {
    const article = pack.articles[articleId];
    if (article === undefined) {
      continue;
    }
    const titleCounts = new Map<string, number>();
    const bodyCounts = new Map<string, number>();
    const legalCounts = new Map<string, number>();
    countTokens(article.title, titleCounts);
    countTokens(article.body, bodyCounts);
    countTokens(article.legalRef, legalCounts);

    const terms = new Set<string>([
      ...titleCounts.keys(),
      ...bodyCounts.keys(),
      ...legalCounts.keys()
    ]);
    for (const term of terms) {
      let bucket = perTerm.get(term);
      if (bucket === undefined) {
        bucket = new Map<string, Posting>();
        perTerm.set(term, bucket);
      }
      bucket.set(articleId, {
        articleId,
        titleHits: titleCounts.get(term) ?? 0,
        bodyHits: bodyCounts.get(term) ?? 0,
        legalHits: legalCounts.get(term) ?? 0
      });
    }
  }

  const postings: Record<string, Posting[]> = {};
  const sortedTerms = [...perTerm.keys()].sort();
  for (const term of sortedTerms) {
    const bucket = perTerm.get(term);
    if (bucket === undefined) {
      continue;
    }
    postings[term] = [...bucket.values()].sort((left, right) =>
      left.articleId.localeCompare(right.articleId)
    );
  }
  return { postings };
}

/**
 * 查询：所有查询词都必须命中（AND）。
 * 排序：加权得分降序，得分相同按 articleId 升序 —— 跨版本、跨重建恒定。
 */
export function searchIndex(index: SearchIndex, query: string): SearchHit[] {
  const queryTerms = [...new Set(tokenize(query))];
  if (queryTerms.length === 0) {
    return [];
  }
  const scores = new Map<string, number>();
  for (const term of queryTerms) {
    const postings = index.postings[term];
    if (postings === undefined) {
      return [];
    }
    for (const posting of postings) {
      const score =
        posting.titleHits * TITLE_WEIGHT +
        posting.legalHits * LEGAL_WEIGHT +
        posting.bodyHits * BODY_WEIGHT;
      scores.set(posting.articleId, (scores.get(posting.articleId) ?? 0) + score);
    }
  }
  const firstTerm = queryTerms[0];
  if (firstTerm === undefined) {
    return [];
  }
  const candidates = index.postings[firstTerm] ?? [];
  const hits: SearchHit[] = [];
  for (const candidate of candidates) {
    let presentInAll = true;
    for (const term of queryTerms) {
      const postings = index.postings[term];
      const found =
        postings !== undefined &&
        postings.some((posting) => posting.articleId === candidate.articleId);
      if (!found) {
        presentInAll = false;
        break;
      }
    }
    if (presentInAll) {
      hits.push({ articleId: candidate.articleId, score: scores.get(candidate.articleId) ?? 0 });
    }
  }
  hits.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return left.articleId.localeCompare(right.articleId);
  });
  return hits;
}
