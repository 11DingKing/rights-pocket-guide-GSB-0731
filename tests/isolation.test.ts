import { describe, expect, it } from 'vitest';
import { buildSearchIndex } from '../src/core/search';
import { Repository } from '../src/services/repository';
import {
  createRig,
  defaultChannel,
  expectCompleteV1,
  expectedV2Pack,
  offlineFetcher,
  V2,
  visibleSet
} from './helpers';

const V1_VISIBLE = {
  topics: ['TOPIC-AID', 'TOPIC-NOTARY'],
  articles: ['ART-AID-1', 'ART-AID-2', 'ART-NOTARY-1']
} as const;

const V2_VISIBLE = {
  topics: ['TOPIC-AID', 'TOPIC-NOTARY'],
  articles: ['ART-AID-1', 'ART-NOTARY-1', 'ART-SERVICE-3']
} as const;

describe('失败版本的残留对读取不可见', () => {
  it('暂存包及其索引物理存在时，搜索/深链接/法条索引仍只读激活版本', async () => {
    const { repository, store, settingsStore } = await createRig({ fetchText: offlineFetcher() });
    // 模拟“失败/崩溃版本”留下的暂存包与索引（分块等价物：整条 staged 记录）。
    const pack = expectedV2Pack();
    await store.stagePackage({
      version: V2,
      status: 'staged',
      pack,
      index: buildSearchIndex(pack),
      storedAt: 't'
    });
    expect((await store.getPackage(V2))?.status).toBe('staged');

    // 搜索只命中激活版本（v1）的索引
    expect(repository.searchArticles('上门服务').map((hit) => hit.article.id)).toEqual([
      'ART-AID-2'
    ]);
    expect(repository.searchArticles('核查').map((hit) => hit.article.id)).toEqual(['ART-AID-1']);
    // 深链接解析不认识暂存里的新条目
    expect(repository.resolveArticleLink('ART-SERVICE-3').kind).toBe('missing');
    expect(repository.getArticle('ART-SERVICE-3')).toBeUndefined();
    // 法律依据索引不含 v2 新增法条
    expect(repository.listLegalRefs().map((group) => group.legalRef)).not.toContain(
      '公共法律服务规范 2026'
    );
    // 临时元数据：激活指针仍是 v1
    expect(await store.getActiveVersion()).toBe('2026.07.31');

    // 重启后暂存被清理，可见集合仍是完整 v1
    const restarted = new Repository({ store, settingsStore, fetchText: offlineFetcher() });
    await restarted.init();
    expect(await store.getPackage(V2)).toBeUndefined();
    expect(visibleSet(restarted)).toEqual(V1_VISIBLE);
  });
});

describe('v1/v2 跨版本确定性对比', () => {
  it('同一查询在两个版本中的排序各自确定，且反映撤下迁移', async () => {
    const { repository } = await createRig({ fetchText: defaultChannel().fetchText });
    const rankV1 = repository.searchArticles('上门服务').map((hit) => hit.article.id);
    expect(rankV1).toEqual(['ART-AID-2']);
    const notaryBefore = repository.searchArticles('公证').map((hit) => hit.article.id);

    await repository.checkForUpdates();

    const rankV2 = repository.searchArticles('上门服务').map((hit) => hit.article.id);
    expect(rankV2).toEqual(['ART-SERVICE-3']);
    // 重复查询逐位相同（确定）
    expect(repository.searchArticles('上门服务').map((hit) => hit.article.id)).toEqual(rankV2);
    // 未受撤下影响的查询跨版本完全一致
    expect(repository.searchArticles('公证').map((hit) => hit.article.id)).toEqual(notaryBefore);
    expect(notaryBefore).toEqual(['ART-NOTARY-1']);
  });

  it('撤下替代关系按版本确定：v1 无映射、v2 指向最终替代、回滚后恢复', async () => {
    const { repository, store } = await createRig({ fetchText: defaultChannel().fetchText });
    expect((await store.readConsistentActive())?.pack.withdrawals).toEqual({});
    expect(repository.resolveArticleLink('ART-AID-2').kind).toBe('ok');

    await repository.checkForUpdates();
    expect((await store.readConsistentActive())?.pack.withdrawals).toEqual({
      'ART-AID-2': 'ART-SERVICE-3'
    });
    expect(repository.resolveArticleLink('ART-AID-2')).toMatchObject({
      kind: 'redirect',
      article: { id: 'ART-SERVICE-3' }
    });

    await repository.rollback();
    expect((await store.readConsistentActive())?.pack.withdrawals).toEqual({});
    expect(repository.resolveArticleLink('ART-AID-2').kind).toBe('ok');
  });

  it('更新成功后离线重启：可见集合为完整 v2，且重复重启逐位相同', async () => {
    const { repository, store, settingsStore } = await createRig({
      fetchText: defaultChannel().fetchText
    });
    expect(visibleSet(repository)).toEqual(V1_VISIBLE);
    await repository.checkForUpdates();

    const restarted = new Repository({ store, settingsStore, fetchText: offlineFetcher() });
    await restarted.init();
    expect(visibleSet(restarted)).toEqual(V2_VISIBLE);

    const restartedAgain = new Repository({ store, settingsStore, fetchText: offlineFetcher() });
    await restartedAgain.init();
    expect(visibleSet(restartedAgain)).toEqual(visibleSet(restarted));
  });

  it('更新失败后离线重启：可见集合仍是完整 v1', async () => {
    const { repository, store, settingsStore } = await createRig({ fetchText: offlineFetcher() });
    const result = await repository.checkForUpdates();
    expect(result.status).toBe('failed');

    const restarted = new Repository({ store, settingsStore, fetchText: offlineFetcher() });
    await restarted.init();
    expect(visibleSet(restarted)).toEqual(V1_VISIBLE);
    await expectCompleteV1(store);
  });
});
