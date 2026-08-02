import type { Article, MaterializedPack, SearchHit } from '../types';

type FieldName = 'title' | 'body' | 'legalRef';

const FIELD_BOOST: Readonly<Record<FieldName, number>> = {
  title: 3,
  body: 1,
  legalRef: 2,
};

const BIGRAM_BOOST = 1.5;

interface Posting {
  readonly tf: number;
}

interface TokenData {
  readonly fields: Record<FieldName, Map<string, Posting>>;
  readonly docs: Set<string>;
}

interface Token {
  readonly value: string;
  readonly isBigram: boolean;
}

function isCJK(code: number | undefined): boolean {
  if (code === undefined) return false;
  return (
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3400 && code <= 0x4dbf)
  );
}

function isLatinOrDigit(code: number | undefined): boolean {
  if (code === undefined) return false;
  return (
    (code >= 0x30 && code <= 0x39) ||
    (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x61 && code <= 0x7a)
  );
}

export function tokenize(text: string): ReadonlyArray<Token> {
  const lower = text.toLowerCase();
  const tokens: Token[] = [];
  let i = 0;
  while (i < lower.length) {
    const code = lower.codePointAt(i);
    if (isCJK(code)) {
      let run = '';
      while (i < lower.length && isCJK(lower.codePointAt(i))) {
        run += lower[i] as string;
        i += 1;
      }
      for (let j = 0; j < run.length; j += 1) {
        tokens.push({ value: run[j] as string, isBigram: false });
      }
      for (let j = 0; j < run.length - 1; j += 1) {
        tokens.push({
          value: (run[j] as string) + (run[j + 1] as string),
          isBigram: true,
        });
      }
    } else if (isLatinOrDigit(code)) {
      let word = '';
      while (i < lower.length && isLatinOrDigit(lower.codePointAt(i))) {
        word += lower[i] as string;
        i += 1;
      }
      if (word.length > 0) {
        tokens.push({ value: word, isBigram: false });
      }
    } else {
      i += 1;
    }
  }
  return tokens;
}

function newTokenData(): TokenData {
  return {
    fields: {
      title: new Map<string, Posting>(),
      body: new Map<string, Posting>(),
      legalRef: new Map<string, Posting>(),
    },
    docs: new Set<string>(),
  };
}

export class SearchIndex {
  private readonly tokens: Map<string, TokenData> = new Map();
  private readonly articleIds: string[] = [];

  constructor(pack: MaterializedPack) {
    const sorted = Object.values(pack.articles).sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );
    for (const article of sorted) {
      this.articleIds.push(article.id);
      this.indexArticle(article);
    }
  }

  private indexArticle(article: Article): void {
    const fields: Record<FieldName, string> = {
      title: article.title,
      body: article.body,
      legalRef: article.legalRef,
    };
    for (const fieldName of ['title', 'body', 'legalRef'] as const) {
      const counts = new Map<string, number>();
      for (const token of tokenize(fields[fieldName])) {
        counts.set(token.value, (counts.get(token.value) ?? 0) + 1);
      }
      for (const [tokenValue, tf] of counts) {
        let data = this.tokens.get(tokenValue);
        if (data === undefined) {
          data = newTokenData();
          this.tokens.set(tokenValue, data);
        }
        data.fields[fieldName].set(article.id, { tf });
        data.docs.add(article.id);
      }
    }
  }

  search(query: string, limit: number = 20): ReadonlyArray<SearchHit> {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) {
      return [];
    }
    const n = this.articleIds.length;
    const scores = new Map<string, number>();
    const matched = new Map<string, Set<FieldName>>();

    const uniqueQueryTokens = new Map<string, Token>();
    for (const token of queryTokens) {
      if (!uniqueQueryTokens.has(token.value)) {
        uniqueQueryTokens.set(token.value, token);
      }
    }

    for (const [tokenValue, token] of uniqueQueryTokens) {
      const data = this.tokens.get(tokenValue);
      if (data === undefined) continue;
      const idf = Math.log((n + 1) / (data.docs.size + 1)) + 1;
      const tokenBoost = token.isBigram ? BIGRAM_BOOST : 1;
      for (const fieldName of ['title', 'body', 'legalRef'] as const) {
        const boost = FIELD_BOOST[fieldName];
        for (const [articleId, posting] of data.fields[fieldName]) {
          const contribution = posting.tf * idf * boost * tokenBoost;
          scores.set(articleId, (scores.get(articleId) ?? 0) + contribution);
          let set = matched.get(articleId);
          if (set === undefined) {
            set = new Set<FieldName>();
            matched.set(articleId, set);
          }
          set.add(fieldName);
        }
      }
    }

    const hits: SearchHit[] = [];
    for (const [articleId, score] of scores) {
      const fields = matched.get(articleId);
      hits.push({
        articleId,
        score: Math.round(score * 1000) / 1000,
        matchedFields: fields ? (Array.from(fields) as ReadonlyArray<FieldName>) : [],
      });
    }

    hits.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.articleId < b.articleId ? -1 : a.articleId > b.articleId ? 1 : 0;
    });

    return hits.slice(0, limit);
  }

  get size(): number {
    return this.articleIds.length;
  }
}
