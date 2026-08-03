import { describe, expect, it } from 'vitest';
import { materializeFullPack, applyDelta } from '../src/content/resolver';
import { parseRawPack, isDeltaPack, PackValidationError } from '../src/content/parser';
import v1 from '../materials/content-pack-v1.json';
import v2 from '../materials/content-pack-v2.json';
import type { FullPack, DeltaPack, MaterializedPack } from '../src/types';

function base(): MaterializedPack {
  return materializeFullPack(v1 as FullPack);
}

describe('resolver', () => {
  it('materializes v1 with articles as a record and no withdrawals', () => {
    const pack = base();
    expect(pack.packageVersion).toBe('2026.07.31');
    expect(Object.keys(pack.articles)).toHaveLength(3);
    expect(pack.articles['ART-AID-1']?.title).toBe('无固定生活来源免予经济困难核查');
    expect(pack.withdrawals).toEqual({});
  });

  it('applies v2 delta: REVISE updates fields in place', () => {
    const pack = applyDelta(base(), parseRawPack(JSON.stringify(v2)) as DeltaPack);
    const revised = pack.articles['ART-AID-1'];
    expect(revised?.title).toBe('无固定生活来源的法援核查规则');
    expect(revised?.body).toContain('免予核查经济困难状况');
  });

  it('applies v2 delta: WITHDRAW removes article and records replacement', () => {
    const pack = applyDelta(base(), parseRawPack(JSON.stringify(v2)) as DeltaPack);
    expect(pack.articles['ART-AID-2']).toBeUndefined();
    expect(pack.withdrawals['ART-AID-2']?.replacementArticleId).toBe('ART-SERVICE-3');
    const aidTopic = pack.topics.find((t) => t.id === 'TOPIC-AID');
    expect(aidTopic?.articleIds).not.toContain('ART-AID-2');
  });

  it('applies v2 delta: ADD inserts new article into the topic', () => {
    const pack = applyDelta(base(), parseRawPack(JSON.stringify(v2)) as DeltaPack);
    const added = pack.articles['ART-SERVICE-3'];
    expect(added?.title).toBe('行动不便时的上门服务');
    expect(added?.legalRef).toBe('公共法律服务规范 2026');
    const aidTopic = pack.topics.find((t) => t.id === 'TOPIC-AID');
    expect(aidTopic?.articleIds).toContain('ART-SERVICE-3');
  });

  it('rejects delta whose base version does not match', () => {
    const wrongBase: MaterializedPack = { ...base(), packageVersion: '1999.01.01' };
    const delta = parseRawPack(JSON.stringify(v2));
    expect(isDeltaPack(delta)).toBe(true);
    if (!isDeltaPack(delta)) return;
    expect(() => applyDelta(wrongBase, delta)).toThrow(/增量包基于版本/);
  });

  it('rejects withdrawal referencing a missing replacement article', () => {
    const delta: DeltaPack = {
      packageVersion: '2026.09.01',
      succeeds: '2026.07.31',
      changes: [
        {
          kind: 'WITHDRAW',
          articleId: 'ART-AID-1',
          replacementArticleId: 'ART-DOES-NOT-EXIST',
        },
      ],
    };
    expect(() => applyDelta(base(), delta)).toThrow(PackValidationError);
  });

  it('rejects ADD referencing a missing topic', () => {
    const delta: DeltaPack = {
      packageVersion: '2026.09.01',
      succeeds: '2026.07.31',
      changes: [
        {
          kind: 'ADD',
          topicId: 'TOPIC-MISSING',
          articleId: 'ART-X',
          title: 'x',
          body: 'x',
          legalRef: 'x',
        },
      ],
    };
    expect(() => applyDelta(base(), delta)).toThrow(/不存在的主题/);
  });

  it('rejects a replacement chain that forms a cycle', () => {
    const cycleDelta: DeltaPack = {
      packageVersion: '2026.09.01',
      succeeds: '2026.07.31',
      changes: [
        {
          kind: 'WITHDRAW',
          articleId: 'ART-AID-1',
          replacementArticleId: 'ART-AID-2',
        },
        {
          kind: 'WITHDRAW',
          articleId: 'ART-AID-2',
          replacementArticleId: 'ART-NOTARY-1',
        },
        {
          kind: 'WITHDRAW',
          articleId: 'ART-NOTARY-1',
          replacementArticleId: 'ART-AID-1',
        },
      ],
    };
    expect(() => applyDelta(base(), cycleDelta)).toThrow(/替代关系存在环/);
  });

  it('rejects a self-referencing withdrawal cycle', () => {
    const selfCycleDelta: DeltaPack = {
      packageVersion: '2026.09.01',
      succeeds: '2026.07.31',
      changes: [
        {
          kind: 'WITHDRAW',
          articleId: 'ART-AID-1',
          replacementArticleId: 'ART-AID-1',
        },
      ],
    };
    expect(() => applyDelta(base(), selfCycleDelta)).toThrow(/替代关系存在环/);
  });
});
