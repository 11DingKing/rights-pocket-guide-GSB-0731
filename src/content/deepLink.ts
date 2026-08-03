import type { MaterializedPack } from '../types';

export type ResolutionResult =
  | { kind: 'available'; articleId: string; redirectedFrom: string | null }
  | { kind: 'withdrawn'; articleId: string; replacementId: string | null }
  | { kind: 'cycle'; articleId: string; chain: ReadonlyArray<string> }
  | { kind: 'missing'; articleId: string };

const MAX_CHAIN_LENGTH = 16;

export function resolveArticleId(
  pack: MaterializedPack,
  articleId: string,
): ResolutionResult {
  if (pack.articles[articleId] !== undefined) {
    return { kind: 'available', articleId, redirectedFrom: null };
  }

  const chain: string[] = [];
  let current: string = articleId;
  let redirectedFrom: string | null = null;

  for (let step = 0; step < MAX_CHAIN_LENGTH; step += 1) {
    if (chain.includes(current)) {
      chain.push(current);
      return { kind: 'cycle', articleId, chain };
    }
    chain.push(current);

    const withdrawal = pack.withdrawals[current];
    if (withdrawal === undefined) {
      return { kind: 'missing', articleId: current };
    }

    const next = withdrawal.replacementArticleId;
    if (next === null) {
      return {
        kind: 'withdrawn',
        articleId: current,
        replacementId: null,
      };
    }

    if (pack.articles[next] !== undefined) {
      if (redirectedFrom === null) {
        redirectedFrom = articleId;
      }
      return {
        kind: 'available',
        articleId: next,
        redirectedFrom,
      };
    }

    current = next;
  }

  return { kind: 'cycle', articleId, chain };
}
