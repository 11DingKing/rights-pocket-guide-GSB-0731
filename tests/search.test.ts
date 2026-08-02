import { describe, expect, it } from 'vitest';
import { tokenize, SearchIndex } from '../src/search';
import { materializeFullPack, applyDelta } from '../src/content/resolver';
import { parseRawPack, isDeltaPack } from '../src/content/parser';
import v1 from '../materials/content-pack-v1.json';
import v2 from '../materials/content-pack-v2.json';
import type { FullPack, DeltaPack, MaterializedPack } from '../src/types';

function v1Pack(): MaterializedPack {
  return materializeFullPack(v1 as FullPack);
}

function v2Pack(): MaterializedPack {
  const base = v1Pack();
  const raw = parseRawPack(JSON.stringify(v2));
  if (!isDeltaPack(raw)) throw new Error('v2 must be delta');
  return applyDelta(base, raw as DeltaPack);
}

describe('tokenize', () => {
  it('emits unigrams and bigrams for CJK runs', () => {
    const tokens = tokenize('法律援助').map((t) => t.value);
    expect(tokens).toContain('法');
    expect(tokens).toContain('法律');
    expect(tokens).toContain('援助');
  });

  it('lowercases latin words and splits on punctuation', () => {
    const tokens = tokenize('Hello, World 法律援助').map((t) => t.value);
    expect(tokens).toContain('hello');
    expect(tokens).toContain('world');
  });
});

describe('SearchIndex', () => {
  it('returns articles matching a title term first due to title boost', () => {
    const index = new SearchIndex(v1Pack());
    const hits = index.search('公证');
    expect(hits[0]?.articleId).toBe('ART-NOTARY-1');
    expect(hits[0]?.matchedFields).toContain('title');
  });

  it('matches body terms and reports matched fields', () => {
    const index = new SearchIndex(v1Pack());
    const hits = index.search('上门');
    expect(hits).toHaveLength(1);
    expect(hits[0]?.articleId).toBe('ART-AID-2');
    expect(hits[0]?.matchedFields).toContain('body');
  });

  it('produces deterministic ordering across repeated queries and rebuilds', () => {
    const index1 = new SearchIndex(v2Pack());
    const index2 = new SearchIndex(v2Pack());
    const query = '服务';
    const a = index1.search(query).map((h) => h.articleId);
    const b = index2.search(query).map((h) => h.articleId);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it('ranks legal-reference matches above body-only matches', () => {
    const index = new SearchIndex(v1Pack());
    const hits = index.search('法律援助');
    expect(hits[0]?.articleId).toBe('ART-AID-1');
    expect(hits[0]?.matchedFields).toContain('legalRef');
    const ids = hits.map((h) => h.articleId);
    const aid1Idx = ids.indexOf('ART-AID-1');
    const notaryIdx = ids.indexOf('ART-NOTARY-1');
    expect(aid1Idx).toBeLessThan(notaryIdx === -1 ? Infinity : notaryIdx);
  });

  it('returns no results for terms absent from the corpus', () => {
    const index = new SearchIndex(v1Pack());
    expect(index.search('')).toEqual([]);
    expect(index.search('鹦鹉麒麟')).toEqual([]);
  });

  it('reflects withdrawn articles removed and new articles searchable in v2', () => {
    const index = new SearchIndex(v2Pack());
    const old = index.search('行动不便');
    expect(old.map((h) => h.articleId)).not.toContain('ART-AID-2');
    const replacement = index.search('上门服务');
    expect(replacement[0]?.articleId).toBe('ART-SERVICE-3');
  });
});
