import { describe, expect, it } from 'vitest';
import { parsePackageText } from '../../core/parse';
import { resolveChain } from '../../core/resolve';
import { buildIndex, SearchIndex, tokenize } from './index';
import v1 from '../../../materials/content-pack-v1.json';
import v2 from '../../../materials/content-pack-v2.json';

const v1Text = JSON.stringify(v1);
const v2Text = JSON.stringify(v2);

function indexFor(...texts: string[]): SearchIndex {
  const snapshot = resolveChain(texts.map((t) => parsePackageText(t)));
  return new SearchIndex(buildIndex(snapshot));
}

describe('deterministic search index', () => {
  it('tokenizes CJK per character and Latin per word', () => {
    expect(tokenize('法律援助 AID-2026')).toEqual([
      '法',
      '律',
      '援',
      '助',
      'aid',
      '2026',
    ]);
  });

  it('finds articles by Chinese keyword', () => {
    const index = indexFor(v1Text);
    const hits = index.search('援助');
    expect(hits.map((h) => h.articleId)).toContain('ART-AID-1');
  });

  it('produces identical ranking on repeated builds (determinism)', () => {
    const a = indexFor(v1Text, v2Text).search('服务');
    const b = indexFor(v1Text, v2Text).search('服务');
    expect(a).toEqual(b);
    // Ordering is score desc then id asc — assert it is sorted that way.
    for (let i = 1; i < a.length; i += 1) {
      const prev = a[i - 1];
      const cur = a[i];
      if (prev !== undefined && cur !== undefined) {
        const ordered =
          prev.score > cur.score ||
          (prev.score === cur.score && prev.articleId <= cur.articleId);
        expect(ordered).toBe(true);
      }
    }
  });

  it('keeps ranking stable across versions for surviving articles', () => {
    // ART-NOTARY-1 exists unchanged in both versions; a query hitting only it
    // must rank it identically regardless of package version.
    const v1Hits = indexFor(v1Text).search('公证');
    const v2Hits = indexFor(v1Text, v2Text).search('公证');
    expect(v1Hits[0]?.articleId).toBe('ART-NOTARY-1');
    expect(v2Hits[0]?.articleId).toBe('ART-NOTARY-1');
  });

  it('uses AND semantics across tokens', () => {
    const index = indexFor(v1Text, v2Text);
    // Both characters appear in the same article body.
    const hits = index.search('上门');
    expect(hits.map((h) => h.articleId)).toContain('ART-SERVICE-3');
    // A token absent from every article yields no results.
    expect(index.search('区块链')).toEqual([]);
  });
});
