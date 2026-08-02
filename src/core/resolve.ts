/**
 * Resolution layer: folds a chain of packages (one full base + zero or more
 * deltas) into a single, view-ready `ResolvedSnapshot`.
 *
 * Determinism guarantees:
 *  - topic order follows the base full package;
 *  - within a topic, article order follows the base article order, with ADDed
 *    articles appended in change order and WITHDRAWn articles removed;
 *  - redirects map withdrawn ids to their replacement id so retired deep links
 *    migrate the same way on every device and every version.
 */
import type {
  Article,
  DeltaPackage,
  FullPackage,
  ParsedPackage,
  ResolvedSnapshot,
  Topic,
} from './types';

export class ResolveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResolveError';
  }
}

interface MutableTopic {
  id: string;
  title: string;
  articleIds: string[];
}

function resolveFull(base: FullPackage): {
  topics: MutableTopic[];
  articles: Map<string, Article>;
} {
  const articles = new Map<string, Article>();
  for (const article of base.articles) {
    if (articles.has(article.id)) {
      throw new ResolveError(`Duplicate article id "${article.id}" in base`);
    }
    articles.set(article.id, { ...article });
  }
  const topics: MutableTopic[] = base.topics.map((topic) => {
    for (const id of topic.articleIds) {
      if (!articles.has(id)) {
        throw new ResolveError(
          `Topic "${topic.id}" references unknown article "${id}"`,
        );
      }
    }
    return { id: topic.id, title: topic.title, articleIds: [...topic.articleIds] };
  });
  return { topics, articles };
}

function applyDelta(
  state: { topics: MutableTopic[]; articles: Map<string, Article> },
  delta: DeltaPackage,
  redirects: Map<string, string>,
  withdrawn: Set<string>,
): void {
  for (const change of delta.changes) {
    switch (change.kind) {
      case 'REVISE': {
        const existing = state.articles.get(change.articleId);
        if (existing === undefined) {
          throw new ResolveError(
            `REVISE targets unknown article "${change.articleId}"`,
          );
        }
        state.articles.set(change.articleId, {
          id: existing.id,
          title: change.title,
          body: change.body,
          legalRef: change.legalRef ?? existing.legalRef,
        });
        break;
      }
      case 'ADD': {
        if (state.articles.has(change.articleId)) {
          throw new ResolveError(
            `ADD duplicates existing article "${change.articleId}"`,
          );
        }
        const topic = state.topics.find((t) => t.id === change.topicId);
        if (topic === undefined) {
          throw new ResolveError(`ADD targets unknown topic "${change.topicId}"`);
        }
        state.articles.set(change.articleId, {
          id: change.articleId,
          title: change.title,
          body: change.body,
          legalRef: change.legalRef,
        });
        topic.articleIds.push(change.articleId);
        break;
      }
      case 'WITHDRAW': {
        if (!state.articles.has(change.articleId)) {
          throw new ResolveError(
            `WITHDRAW targets unknown article "${change.articleId}"`,
          );
        }
        withdrawn.add(change.articleId);
        redirects.set(change.articleId, change.replacementArticleId);
        // Remove the withdrawn article's content so it cannot appear in topic
        // lists or search results — only its redirect survives.
        state.articles.delete(change.articleId);
        for (const topic of state.topics) {
          topic.articleIds = topic.articleIds.filter(
            (id) => id !== change.articleId,
          );
        }
        break;
      }
      default: {
        // Exhaustiveness guard — unreachable if DeltaChange stays a closed union.
        const never: never = change;
        throw new ResolveError(`Unhandled change ${JSON.stringify(never)}`);
      }
    }
  }
}

/**
 * Resolve an ordered chain. The first element must be a full package; each
 * following delta must succeed the running version.
 */
export function resolveChain(chain: readonly ParsedPackage[]): ResolvedSnapshot {
  if (chain.length === 0) {
    throw new ResolveError('Empty package chain');
  }
  const base = chain[0];
  if (base === undefined || base.kind !== 'full') {
    throw new ResolveError('Package chain must start with a full package');
  }

  const state = resolveFull(base);
  const redirects = new Map<string, string>();
  const withdrawn = new Set<string>();
  let currentVersion = base.packageVersion;

  for (let i = 1; i < chain.length; i += 1) {
    const next = chain[i];
    if (next === undefined || next.kind !== 'delta') {
      throw new ResolveError(`Expected delta at position ${i}`);
    }
    if (next.succeeds !== currentVersion) {
      throw new ResolveError(
        `Delta ${next.packageVersion} succeeds ${next.succeeds}, expected ${currentVersion}`,
      );
    }
    applyDelta(state, next, redirects, withdrawn);
    currentVersion = next.packageVersion;
  }

  // Validate every redirect target resolves to a live article, following
  // chains (A->B->C) to a terminal live id.
  for (const [from] of redirects) {
    resolveRedirect(from, redirects, withdrawn, state.articles);
  }

  const articles: Record<string, Article> = {};
  for (const [id, article] of state.articles) {
    articles[id] = article;
  }
  const topics: Topic[] = state.topics.map((topic) => ({
    id: topic.id,
    title: topic.title,
    articleIds: [...topic.articleIds],
  }));
  const redirectRecord: Record<string, string> = {};
  for (const [from, to] of redirects) {
    redirectRecord[from] = to;
  }

  return {
    packageVersion: currentVersion,
    topics,
    articles,
    redirects: redirectRecord,
    withdrawn: [...withdrawn].sort(),
  };
}

function resolveRedirect(
  from: string,
  redirects: Map<string, string>,
  withdrawn: Set<string>,
  articles: Map<string, Article>,
): void {
  const seen = new Set<string>();
  let cursor = from;
  while (withdrawn.has(cursor)) {
    if (seen.has(cursor)) {
      throw new ResolveError(`Cyclic redirect starting at "${from}"`);
    }
    seen.add(cursor);
    const target = redirects.get(cursor);
    if (target === undefined) {
      throw new ResolveError(`Withdrawn article "${cursor}" has no redirect`);
    }
    cursor = target;
  }
  if (!articles.has(cursor)) {
    throw new ResolveError(
      `Redirect from "${from}" ends at unknown article "${cursor}"`,
    );
  }
}

/**
 * Follow redirects for a requested article id to a terminal, live article id.
 * Returns `undefined` when the id is unknown. Used by the view layer for
 * deep-link migration.
 */
export function followRedirect(
  snapshot: ResolvedSnapshot,
  articleId: string,
): { readonly targetId: string; readonly migrated: boolean } | undefined {
  const seen = new Set<string>();
  let cursor = articleId;
  let migrated = false;
  while (snapshot.redirects[cursor] !== undefined) {
    if (seen.has(cursor)) {
      return undefined;
    }
    seen.add(cursor);
    const next = snapshot.redirects[cursor];
    if (next === undefined) {
      break;
    }
    cursor = next;
    migrated = true;
  }
  if (snapshot.articles[cursor] === undefined) {
    return undefined;
  }
  return { targetId: cursor, migrated };
}
