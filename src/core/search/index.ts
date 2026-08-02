/**
 * Indexing layer: a deterministic, dependency-free inverted index over the
 * resolved snapshot. No third-party search library is used.
 *
 * Tokenization handles both space-delimited (Latin) text and CJK text by
 * emitting per-character CJK tokens alongside word tokens, so Chinese article
 * bodies are searchable without a segmenter. Ranking is fully deterministic:
 * results are ordered by descending score, then ascending article id, so the
 * same query yields the same order on every device and across versions.
 */
import type {
  ResolvedSnapshot,
  SearchHit,
  SerializedIndex,
  SerializedIndexEntry,
} from '../types';

const FIELD_WEIGHTS = {
  title: 3,
  legalRef: 2,
  body: 1,
} as const;

const CJK = /[\u3400-\u9fff\uf900-\ufaff]/;

/** Deterministic tokenizer shared by indexing and querying. */
export function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const lower = text.toLowerCase();
  let word = '';
  const flushWord = (): void => {
    if (word.length > 0) {
      tokens.push(word);
      word = '';
    }
  };
  for (const ch of lower) {
    if (CJK.test(ch)) {
      flushWord();
      tokens.push(ch);
    } else if (/[a-z0-9]/.test(ch)) {
      word += ch;
    } else {
      flushWord();
    }
  }
  flushWord();
  return tokens;
}

interface Posting {
  weight: number;
}

/** Build an inverted index from a resolved snapshot. Pure. */
export function buildIndex(snapshot: ResolvedSnapshot): SerializedIndex {
  // token -> (articleId -> accumulated weight)
  const table = new Map<string, Map<string, Posting>>();

  const add = (token: string, articleId: string, weight: number): void => {
    let postings = table.get(token);
    if (postings === undefined) {
      postings = new Map<string, Posting>();
      table.set(token, postings);
    }
    const existing = postings.get(articleId);
    if (existing === undefined) {
      postings.set(articleId, { weight });
    } else {
      existing.weight += weight;
    }
  };

  // Iterate articles in a stable (id-sorted) order for reproducibility.
  const ids = Object.keys(snapshot.articles).sort();
  for (const id of ids) {
    const article = snapshot.articles[id];
    if (article === undefined) {
      continue;
    }
    for (const token of tokenize(article.title)) {
      add(token, id, FIELD_WEIGHTS.title);
    }
    for (const token of tokenize(article.legalRef)) {
      add(token, id, FIELD_WEIGHTS.legalRef);
    }
    for (const token of tokenize(article.body)) {
      add(token, id, FIELD_WEIGHTS.body);
    }
  }

  const entries: SerializedIndexEntry[] = [...table.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([token, postings]) => ({
      token,
      postings: [...postings.entries()]
        .map(([articleId, posting]) => ({ id: articleId, weight: posting.weight }))
        .sort((x, y) =>
          y.weight - x.weight || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0),
        ),
    }));

  return { entries };
}

/** A query-time view of a serialized index. */
export class SearchIndex {
  private readonly table: Map<string, ReadonlyMap<string, number>>;

  constructor(serialized: SerializedIndex) {
    this.table = new Map();
    for (const entry of serialized.entries) {
      const postings = new Map<string, number>();
      for (const posting of entry.postings) {
        postings.set(posting.id, posting.weight);
      }
      this.table.set(entry.token, postings);
    }
  }

  /**
   * Rank articles for a query. AND semantics across query tokens (an article
   * must contain every token). Score is the summed field weight. Ordering is
   * deterministic: score desc, then article id asc.
   */
  search(query: string): SearchHit[] {
    const tokens = [...new Set(tokenize(query))];
    if (tokens.length === 0) {
      return [];
    }

    const perToken: Array<ReadonlyMap<string, number>> = [];
    for (const token of tokens) {
      const postings = this.table.get(token);
      if (postings === undefined) {
        return []; // AND semantics: a missing token yields no results.
      }
      perToken.push(postings);
    }

    // Intersect on the smallest posting list first.
    perToken.sort((a, b) => a.size - b.size);
    const [first, ...rest] = perToken;
    if (first === undefined) {
      return [];
    }

    const scores = new Map<string, number>();
    for (const [id, weight] of first) {
      let total = weight;
      let inAll = true;
      for (const postings of rest) {
        const w = postings.get(id);
        if (w === undefined) {
          inAll = false;
          break;
        }
        total += w;
      }
      if (inAll) {
        scores.set(id, total);
      }
    }

    return [...scores.entries()]
      .map(([articleId, score]) => ({ articleId, score }))
      .sort((a, b) =>
        b.score - a.score ||
        (a.articleId < b.articleId ? -1 : a.articleId > b.articleId ? 1 : 0),
      );
  }
}
