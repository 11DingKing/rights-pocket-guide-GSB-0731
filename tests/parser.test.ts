import { describe, expect, it } from 'vitest';
import { parseRawPack, PackValidationError, isDeltaPack } from '../src/content/parser';
import v1 from '../materials/content-pack-v1.json';
import v2 from '../materials/content-pack-v2.json';

describe('parser', () => {
  it('parses v1 as a full pack with topics and articles', () => {
    const pack = parseRawPack(JSON.stringify(v1));
    expect(isDeltaPack(pack)).toBe(false);
    if (isDeltaPack(pack)) return;
    expect(pack.packageVersion).toBe('2026.07.31');
    expect(pack.topics).toHaveLength(2);
    expect(pack.articles).toHaveLength(3);
    expect(pack.topics[0]?.articleIds).toContain('ART-AID-1');
  });

  it('parses v2 as a delta pack with changes', () => {
    const pack = parseRawPack(JSON.stringify(v2));
    expect(isDeltaPack(pack)).toBe(true);
    if (!isDeltaPack(pack)) return;
    expect(pack.succeeds).toBe('2026.07.31');
    expect(pack.changes.map((c) => c.kind)).toEqual([
      'REVISE',
      'WITHDRAW',
      'ADD',
    ]);
    expect(pack.checksum).toBe('fixture-sha256-v2');
  });

  it('rejects invalid JSON', () => {
    expect(() => parseRawPack('{')).toThrow(PackValidationError);
  });

  it('rejects packs without topics/articles or changes', () => {
    expect(() => parseRawPack('{"packageVersion":"x"}')).toThrow(/必须包含/);
  });

  it('rejects unknown change kinds', () => {
    const bad = {
      packageVersion: '2026.09.01',
      succeeds: '2026.07.31',
      changes: [{ kind: 'DELETE', articleId: 'ART-AID-1' }],
    };
    expect(() => parseRawPack(JSON.stringify(bad))).toThrow(/未知变更类型/);
  });
});
