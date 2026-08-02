import { describe, expect, it } from 'vitest';
import { SwitchConflictError } from '../src/core/errors';
import { buildSearchIndex } from '../src/core/search';
import { ensureSeeded } from '../src/services/seed';
import { Repository } from '../src/services/repository';
import { PackageStore } from '../src/storage/packageStore';
import { SettingsStore } from '../src/storage/settingsStore';
import {
  V1,
  V2,
  defaultChannel,
  expectCompleteV1,
  expectCompleteV2,
  expectedV2Pack
} from './helpers';

describe('两个标签页同时触发更新', () => {
  it('切换事务校验基线：基线不符拒绝提交，基线正确方可提交', async () => {
    const store = await PackageStore.open();
    await ensureSeeded(store);
    const pack = expectedV2Pack();
    await store.stagePackage({
      version: V2,
      status: 'staged',
      pack,
      index: buildSearchIndex(pack),
      storedAt: 't'
    });
    // 基于错误旧版本的提交被拒绝（等价于另一标签页已抢先切换）
    await expect(store.activateStaged(V2, '1999.01.01')).rejects.toThrow(SwitchConflictError);
    await expectCompleteV1(store);
    await store.activateStaged(V2, V1);
    await expectCompleteV2(store);
  });

  it('迟到的暂存写入不会覆盖已激活的同版本记录', async () => {
    const store = await PackageStore.open();
    await ensureSeeded(store);
    const pack = expectedV2Pack();
    await store.stagePackage({
      version: V2,
      status: 'staged',
      pack,
      index: buildSearchIndex(pack),
      storedAt: 't1'
    });
    await store.activateStaged(V2, V1);
    // 另一标签页延迟到达的 stage 不得把 active 记录改回 staged
    await store.stagePackage({
      version: V2,
      status: 'staged',
      pack,
      index: buildSearchIndex(pack),
      storedAt: 't2'
    });
    const record = await store.getPackage(V2);
    expect(record?.status).toBe('active');
    expect(record?.storedAt).toBe('t1');
  });

  it('并发更新：只有一个版本提交成功，双方最终一致收敛到完整 v2、无暂存残留', async () => {
    const channel = defaultChannel();
    const storeA = await PackageStore.open();
    const storeB = await PackageStore.open();
    await ensureSeeded(storeA);
    const repoA = new Repository({
      store: storeA,
      settingsStore: await SettingsStore.open(),
      fetchText: channel.fetchText
    });
    const repoB = new Repository({
      store: storeB,
      settingsStore: await SettingsStore.open(),
      fetchText: channel.fetchText
    });
    await Promise.all([repoA.init(), repoB.init()]);

    const [resultA, resultB] = await Promise.all([
      repoA.checkForUpdates(),
      repoB.checkForUpdates()
    ]);
    // 恰好一方提交；另一方经冲突检测收敛为 already-current
    const outcomes = [resultA.status, resultB.status].sort();
    expect(outcomes).toEqual(['already-current', 'updated']);

    // 双方最终视图一致：完整 v2
    expect(repoA.getSnapshot().packageVersion).toBe(V2);
    expect(repoB.getSnapshot().packageVersion).toBe(V2);
    await expectCompleteV2(storeA);
    await expectCompleteV2(storeB);
    // 无暂存/临时残留
    expect((await storeA.getPackage(V2))?.status).toBe('active');
    expect((await storeB.getPackage(V2))?.status).toBe('active');
  });
});
