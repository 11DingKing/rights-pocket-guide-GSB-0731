import { describe, expect, it } from 'vitest';
import { applyDelta } from '../src/core/delta';
import { parseDeltaPackage, parseJsonUnknown } from '../src/core/parse';
import { parseSettingsState } from '../src/core/settingsSchema';
import { buildSearchIndex } from '../src/core/search';
import { Repository } from '../src/services/repository';
import { runUpdate } from '../src/services/updateService';
import {
  SETTINGS_KEY_BACKUP,
  SETTINGS_KEY_CURRENT,
  STORE_SETTINGS,
  openGuideDatabase
} from '../src/storage/database';
import { runInTransaction, requestToPromise } from '../src/storage/idb';
import {
  V1,
  V2,
  corruptCyclicPack,
  createRig,
  defaultChannel,
  expectCompleteV1,
  expectCompleteV2,
  expectedV1Pack,
  offlineFetcher,
  updateChannel
} from './helpers';

/** 直接向 settings 仓写原始值（构造“写入一半”的损坏现场）。 */
async function writeRawSettings(key: string, value: unknown): Promise<void> {
  const db = await openGuideDatabase();
  await runInTransaction(db, [STORE_SETTINGS], 'readwrite', async (tx) => {
    await requestToPromise(tx.objectStore(STORE_SETTINGS).put(value, key));
  });
  db.close();
}

const CYCLIC_DELTA_TEXT = JSON.stringify({
  packageVersion: '2026.09.02',
  succeeds: '2026.07.31',
  changes: [
    { kind: 'WITHDRAW', articleId: 'ART-AID-2', replacementArticleId: 'ART-AID-1' },
    { kind: 'WITHDRAW', articleId: 'ART-AID-1', replacementArticleId: 'ART-AID-2' }
  ]
});

describe('设置迁移与包切换的原子性', () => {
  it('更新成功：schema 迁移与包切换同事务提交（新设置+新包，备份为旧设置）', async () => {
    const { repository, store, settingsStore } = await createRig({
      fetchText: defaultChannel().fetchText
    });
    await repository.updateSettings({ fontScale: 'large', theme: 'dark' });
    const before = repository.getSnapshot().settings;

    await repository.checkForUpdates();
    await expectCompleteV2(store);
    expect(repository.getSnapshot().settings).toEqual({
      schemaVersion: 2,
      values: {
        fontScale: 'large',
        theme: 'dark',
        lineSpacing: 'standard',
        letterSpacing: 'standard'
      }
    });
    // backup 精确等于更新前的 v1 设置
    const raw = await settingsStore.readRaw();
    expect(parseSettingsState(raw.backup, 1)).toEqual(before);
  });

  it('迁移写入一半时崩溃：整个切换事务回滚（完整旧设置+完整旧包），重试后完整同新', async () => {
    const { repository, store, settingsStore } = await createRig({
      fetchText: defaultChannel().fetchText
    });
    await repository.updateSettings({ fontScale: 'large' });
    const settingsBefore = repository.getSnapshot().settings;

    // 在 settings 仓的 put 上注入一次性 QuotaExceededError，模拟“迁移写一半崩溃”。
    const originalPut = IDBObjectStore.prototype.put;
    let injected = false;
    IDBObjectStore.prototype.put = function (
      this: IDBObjectStore,
      value: unknown,
      key?: IDBValidKey
    ): IDBRequest<IDBValidKey> {
      if (!injected && this.name === STORE_SETTINGS) {
        injected = true;
        throw new DOMException('磁盘已满', 'QuotaExceededError');
      }
      return originalPut.call(this, value, key);
    };
    let firstResult;
    try {
      firstResult = await repository.checkForUpdates();
    } finally {
      IDBObjectStore.prototype.put = originalPut;
    }
    expect(injected).toBe(true);
    expect(firstResult).toMatchObject({ status: 'failed', stage: 'switch', activeVersion: V1 });

    // 包与设置都保持完整旧版：绝不混搭
    await expectCompleteV1(store);
    expect(repository.getSnapshot().packageVersion).toBe(V1);
    expect(repository.getSnapshot().settings).toEqual(settingsBefore);
    const rawAfter = await settingsStore.readRaw();
    expect(parseSettingsState(rawAfter.current, 1)).toEqual(settingsBefore);

    // 重试（不再注入故障）：完整切换到新设置+新包
    const secondResult = await repository.checkForUpdates();
    expect(secondResult.status).toBe('updated');
    await expectCompleteV2(store);
    expect(repository.getSnapshot().settings).toEqual({
      schemaVersion: 2,
      values: {
        fontScale: 'large',
        theme: 'system',
        lineSpacing: 'standard',
        letterSpacing: 'standard'
      }
    });
  });
});

describe('“写入一半”现场的启动恢复', () => {
  it('现场 A：包已是 v2、设置仍是 v1 schema → 迁移恢复且偏好不丢（同新）', async () => {
    const { repository, store, settingsStore } = await createRig({
      fetchText: defaultChannel().fetchText
    });
    await repository.checkForUpdates();
    await expectCompleteV2(store);
    // 手工把设置改回 v1 schema，模拟“包已切换但迁移没落盘”的损坏现场。
    const v1Settings = {
      schemaVersion: 1,
      values: { fontScale: 'large', theme: 'dark', lineSpacing: 'loose' }
    };
    await writeRawSettings(SETTINGS_KEY_CURRENT, v1Settings);
    await writeRawSettings(SETTINGS_KEY_BACKUP, v1Settings);

    const restarted = new Repository({ store, settingsStore, fetchText: offlineFetcher() });
    await restarted.init();
    expect(restarted.getSnapshot().packageVersion).toBe(V2);
    // v1 设置被迁移到 schema 2，原有偏好全部保留
    expect(restarted.getSnapshot().settings).toEqual({
      schemaVersion: 2,
      values: { fontScale: 'large', theme: 'dark', lineSpacing: 'loose', letterSpacing: 'standard' }
    });
    await expectCompleteV2(store);
  });

  it('现场 B：包仍是 v1、设置已被写成 v2 schema → 用备份恢复（同旧）', async () => {
    const { store, settingsStore } = await createRig({ fetchText: offlineFetcher() });
    const backupV1 = {
      schemaVersion: 1,
      values: { fontScale: 'xlarge', theme: 'contrast', lineSpacing: 'standard' }
    };
    await writeRawSettings(SETTINGS_KEY_CURRENT, {
      schemaVersion: 2,
      values: { fontScale: 'large', theme: 'dark', lineSpacing: 'loose', letterSpacing: 'wide' }
    });
    await writeRawSettings(SETTINGS_KEY_BACKUP, backupV1);

    const restarted = new Repository({ store, settingsStore, fetchText: offlineFetcher() });
    await restarted.init();
    expect(restarted.getSnapshot().packageVersion).toBe(V1);
    expect(restarted.getSnapshot().settings).toEqual(backupV1);
    await expectCompleteV1(store);
  });

  it('现场 C：current 与 backup 均损坏 → 按包 schema 回退默认值（稳定降级）', async () => {
    const { store, settingsStore } = await createRig({ fetchText: offlineFetcher() });
    await writeRawSettings(SETTINGS_KEY_CURRENT, 'garbage');
    await writeRawSettings(SETTINGS_KEY_BACKUP, 42);

    const restarted = new Repository({ store, settingsStore, fetchText: offlineFetcher() });
    await restarted.init();
    expect(restarted.getSnapshot().loadStatus).toBe('ready');
    expect(restarted.getSnapshot().settings).toEqual({
      schemaVersion: 1,
      values: { fontScale: 'standard', theme: 'system', lineSpacing: 'standard' }
    });
    // 修复已写回 current
    const raw = await settingsStore.readRaw();
    expect(parseSettingsState(raw.current, 1)).toEqual(restarted.getSnapshot().settings);
  });
});

describe('回滚恢复', () => {
  it('回滚精确恢复更新前备份的设置，包与设置同旧', async () => {
    const { repository, store, settingsStore } = await createRig({
      fetchText: defaultChannel().fetchText
    });
    await repository.updateSettings({ fontScale: 'large', theme: 'dark' });
    const v1Settings = repository.getSnapshot().settings;

    await repository.checkForUpdates();
    // v2 下继续修改偏好（这些不应污染回滚后的 v1 设置）
    await repository.updateSettings({ fontScale: 'xlarge', letterSpacing: 'wide' });
    const v2Settings = repository.getSnapshot().settings;

    const rolledBackTo = await repository.rollback();
    expect(rolledBackTo).toBe(V1);
    await expectCompleteV1(store);
    // 设置精确恢复到更新前的 v1 备份（而非降级重算）
    expect(repository.getSnapshot().settings).toEqual(v1Settings);
    // backup 记为回滚前的 v2 设置（可再次前滚）
    const raw = await settingsStore.readRaw();
    expect(parseSettingsState(raw.backup, 2)).toEqual(v2Settings);
    // 库中 current 与快照一致（同事务落盘）
    expect(parseSettingsState(raw.current, 1)).toEqual(v1Settings);
  });

  it('回归：更新 → 回滚 → 再次更新同一版本，可重新暂存并切换成功', async () => {
    const { repository, store } = await createRig({ fetchText: defaultChannel().fetchText });
    await repository.checkForUpdates();
    await expectCompleteV2(store);
    await repository.rollback();
    await expectCompleteV1(store);
    // v2 记录此时是 retained：重新暂存必须覆盖它而非被并发守卫吞掉
    const result = await repository.checkForUpdates();
    expect(result.status).toBe('updated');
    await expectCompleteV2(store);
    expect(repository.getSnapshot().settings.schemaVersion).toBe(2);
  });
});

describe('替代链成环', () => {
  it('增量包内替代链成环 → 物化拒绝，更新失败但旧包完整', async () => {
    const cyclicDelta = parseDeltaPackage(parseJsonUnknown(CYCLIC_DELTA_TEXT));
    expect(() => applyDelta(expectedV1Pack(), cyclicDelta)).toThrow(/撤下链存在循环/);

    const { store } = await createRig({ fetchText: offlineFetcher() });
    const channel = updateChannel([
      { version: '2026.09.02', text: CYCLIC_DELTA_TEXT, kind: 'delta', succeeds: '2026.07.31' }
    ]);
    const result = await runUpdate({ fetchText: channel.fetchText, store });
    expect(result).toMatchObject({ status: 'failed', stage: 'materialize', activeVersion: V1 });
    await expectCompleteV1(store);
  });

  it('存储数据损坏导致替代链成环 → 深链接解析返回 broken 而非死循环', async () => {
    const { repository, store } = await createRig({ fetchText: offlineFetcher() });
    const corrupt = corruptCyclicPack();
    await store.installInitial({
      version: corrupt.packageVersion,
      status: 'active',
      pack: corrupt,
      index: buildSearchIndex(corrupt),
      storedAt: 't'
    });
    // 重新初始化，让仓储从库中重新加载（损坏后的）激活包。
    await repository.init();
    expect(repository.resolveArticleLink('ART-AID-2')).toEqual({
      kind: 'broken',
      fromId: 'ART-AID-2'
    });
    // 其余条目不受影响
    expect(repository.resolveArticleLink('ART-AID-1').kind).toBe('ok');
    expect(repository.searchArticles('公证').map((hit) => hit.article.id)).toEqual([
      'ART-NOTARY-1'
    ]);
  });
});

describe('偏好写入配额耗尽的降级', () => {
  it('updateSettings 落盘失败 → ok:false，内存保持最后一次可用设置，恢复后可再写', async () => {
    const { repository, settingsStore } = await createRig({ fetchText: offlineFetcher() });
    await repository.updateSettings({ fontScale: 'large' });
    const before = repository.getSnapshot().settings;

    settingsStore.writeCurrent = async () => {
      throw new DOMException('磁盘已满', 'QuotaExceededError');
    };
    const result = await repository.updateSettings({ fontScale: 'xlarge' });
    expect(result.ok).toBe(false);
    expect(repository.getSnapshot().settings).toEqual(before);

    // 全新仓储（配额恢复）仍可正常保存
    const fresh = await createRig({ fetchText: offlineFetcher() });
    const ok = await fresh.repository.updateSettings({ fontScale: 'xlarge' });
    expect(ok.ok).toBe(true);
    expect(fresh.repository.getSnapshot().settings.values.fontScale).toBe('xlarge');
  });
});
