import { describe, expect, it } from 'vitest';
import { resolveArticleId } from '../src/content/deepLink';
import { materializeFullPack } from '../src/content/resolver';
import { applyDelta } from '../src/content/resolver';
import { parseRawPack } from '../src/content/parser';
import type { DeltaPack, MaterializedPack } from '../src/types';
import v1 from '../materials/content-pack-v1.json';
import v2 from '../materials/content-pack-v2.json';
import type { FullPack } from '../src/types';

function v1Pack(): MaterializedPack {
  return materializeFullPack(v1 as FullPack);
}

function v2Pack(): MaterializedPack {
  const raw = parseRawPack(JSON.stringify(v2));
  return applyDelta(v1Pack(), raw as DeltaPack);
}

describe('resolveArticleId', () => {
  it('returns available for an existing article', () => {
    const pack = v1Pack();
    const result = resolveArticleId(pack, 'ART-AID-1');
    expect(result).toEqual({
      kind: 'available',
      articleId: 'ART-AID-1',
      redirectedFrom: null,
    });
  });

  it('resolves a withdrawn article to its replacement', () => {
    const pack = v2Pack();
    const result = resolveArticleId(pack, 'ART-AID-2');
    expect(result).toEqual({
      kind: 'available',
      articleId: 'ART-SERVICE-3',
      redirectedFrom: 'ART-AID-2',
    });
  });

  it('returns missing for a completely unknown article', () => {
    const pack = v1Pack();
    const result = resolveArticleId(pack, 'ART-DOES-NOT-EXIST');
    expect(result).toEqual({
      kind: 'missing',
      articleId: 'ART-DOES-NOT-EXIST',
    });
  });

  it('returns withdrawn when article was withdrawn without replacement', () => {
    const pack: MaterializedPack = {
      ...v1Pack(),
      articles: { ...v1Pack().articles },
      withdrawals: {
        'ART-AID-1': { replacementArticleId: null },
      },
    };
    delete (pack.articles as Record<string, unknown>)['ART-AID-1'];
    const result = resolveArticleId(pack, 'ART-AID-1');
    expect(result).toEqual({
      kind: 'withdrawn',
      articleId: 'ART-AID-1',
      replacementId: null,
    });
  });

  it('detects a cycle in the replacement chain at resolution time', () => {
    const articles = { ...v1Pack().articles };
    delete (articles as Record<string, unknown>)['ART-AID-1'];
    delete (articles as Record<string, unknown>)['ART-AID-2'];
    delete (articles as Record<string, unknown>)['ART-NOTARY-1'];
    const pack: MaterializedPack = {
      ...v1Pack(),
      articles,
      withdrawals: {
        'ART-AID-1': { replacementArticleId: 'ART-AID-2' },
        'ART-AID-2': { replacementArticleId: 'ART-NOTARY-1' },
        'ART-NOTARY-1': { replacementArticleId: 'ART-AID-1' },
      },
    };
    const result = resolveArticleId(pack, 'ART-AID-1');
    expect(result.kind).toBe('cycle');
    if (result.kind === 'cycle') {
      expect(result.chain).toContain('ART-AID-1');
      expect(result.chain).toContain('ART-AID-2');
      expect(result.chain).toContain('ART-NOTARY-1');
    }
  });

  it('detects a self-referencing cycle', () => {
    const articles = { ...v1Pack().articles };
    delete (articles as Record<string, unknown>)['ART-AID-1'];
    const pack: MaterializedPack = {
      ...v1Pack(),
      articles,
      withdrawals: {
        'ART-AID-1': { replacementArticleId: 'ART-AID-1' },
      },
    };
    const result = resolveArticleId(pack, 'ART-AID-1');
    expect(result.kind).toBe('cycle');
  });

  it('follows a multi-step chain to find available article', () => {
    const articles = { ...v1Pack().articles };
    delete (articles as Record<string, unknown>)['ART-AID-2'];
    const pack: MaterializedPack = {
      ...v1Pack(),
      articles,
      withdrawals: {
        'ART-OLD-1': { replacementArticleId: 'ART-MIDDLE' },
        'ART-MIDDLE': { replacementArticleId: 'ART-AID-1' },
      },
    };
    const result = resolveArticleId(pack, 'ART-OLD-1');
    expect(result).toEqual({
      kind: 'available',
      articleId: 'ART-AID-1',
      redirectedFrom: 'ART-OLD-1',
    });
  });

  it('returns missing when a chain leads to a missing article', () => {
    const pack: MaterializedPack = {
      ...v1Pack(),
      withdrawals: {
        'ART-OLD-1': { replacementArticleId: 'ART-GHOST' },
      },
    };
    const result = resolveArticleId(pack, 'ART-OLD-1');
    expect(result).toEqual({
      kind: 'missing',
      articleId: 'ART-GHOST',
    });
  });
});
