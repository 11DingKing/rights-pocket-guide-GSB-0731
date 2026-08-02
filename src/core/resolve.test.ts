import { describe, expect, it } from 'vitest';
import { parsePackageText } from '../core/parse';
import { followRedirect, resolveChain } from '../core/resolve';
import v1 from '../../materials/content-pack-v1.json';
import v2 from '../../materials/content-pack-v2.json';

const v1Text = JSON.stringify(v1);
const v2Text = JSON.stringify(v2);

describe('parse + resolve of the shipped material packs', () => {
  it('resolves the v1 full package', () => {
    const snapshot = resolveChain([parsePackageText(v1Text)]);
    expect(snapshot.packageVersion).toBe('2026.07.31');
    expect(snapshot.topics.map((t) => t.id)).toEqual([
      'TOPIC-AID',
      'TOPIC-NOTARY',
    ]);
    expect(Object.keys(snapshot.articles).sort()).toEqual([
      'ART-AID-1',
      'ART-AID-2',
      'ART-NOTARY-1',
    ]);
    expect(snapshot.withdrawn).toEqual([]);
  });

  it('applies the v2 delta: REVISE, WITHDRAW→redirect, ADD', () => {
    const snapshot = resolveChain([
      parsePackageText(v1Text),
      parsePackageText(v2Text),
    ]);
    expect(snapshot.packageVersion).toBe('2026.09.01');

    // REVISE updated the title/body of ART-AID-1.
    expect(snapshot.articles['ART-AID-1']?.title).toBe(
      '无固定生活来源的法援核查规则',
    );

    // WITHDRAW removed ART-AID-2 from its topic and recorded a redirect.
    expect(snapshot.withdrawn).toContain('ART-AID-2');
    expect(snapshot.redirects['ART-AID-2']).toBe('ART-SERVICE-3');
    const aid = snapshot.topics.find((t) => t.id === 'TOPIC-AID');
    expect(aid?.articleIds).not.toContain('ART-AID-2');

    // ADD introduced ART-SERVICE-3 into TOPIC-AID.
    expect(snapshot.articles['ART-SERVICE-3']?.title).toBe('行动不便时的上门服务');
    expect(aid?.articleIds).toContain('ART-SERVICE-3');
  });

  it('migrates a withdrawn deep link to its replacement', () => {
    const snapshot = resolveChain([
      parsePackageText(v1Text),
      parsePackageText(v2Text),
    ]);
    const migrated = followRedirect(snapshot, 'ART-AID-2');
    expect(migrated).toEqual({
      kind: 'resolved',
      targetId: 'ART-SERVICE-3',
      migrated: true,
    });

    const direct = followRedirect(snapshot, 'ART-AID-1');
    expect(direct).toEqual({
      kind: 'resolved',
      targetId: 'ART-AID-1',
      migrated: false,
    });

    expect(followRedirect(snapshot, 'ART-UNKNOWN')).toEqual({ kind: 'unknown' });
  });

  it('rejects a delta whose succeeds does not match', () => {
    const bad = parsePackageText(
      JSON.stringify({
        packageVersion: 'x',
        succeeds: 'nope',
        changes: [],
      }),
    );
    expect(() => resolveChain([parsePackageText(v1Text), bad])).toThrow();
  });

  it('rejects a chain that does not start with a full package', () => {
    expect(() => resolveChain([parsePackageText(v2Text)])).toThrow();
  });
});

describe('parse validation', () => {
  it('rejects unknown change kinds', () => {
    expect(() =>
      parsePackageText(
        JSON.stringify({
          packageVersion: 'x',
          succeeds: 'y',
          changes: [{ kind: 'DELETE', articleId: 'a' }],
        }),
      ),
    ).toThrow(/Unknown change kind/);
  });

  it('rejects missing required fields', () => {
    expect(() =>
      parsePackageText(JSON.stringify({ packageVersion: 'x', topics: [{}], articles: [] })),
    ).toThrow();
  });
});
