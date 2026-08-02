import { describe, expect, it } from "vitest";
import { mapIdbError } from "../src/storage/idb";
import { StorageQuotaError } from "../src/core/errors";
import type { UpdateStage } from "../src/core/errors";
import { ensureSeeded } from "../src/services/seed";
import { runUpdate } from "../src/services/updateService";
import { buildSearchIndex } from "../src/core/search";
import { Repository } from "../src/services/repository";
import { PackageStore } from "../src/storage/packageStore";
import { SettingsStore } from "../src/storage/settingsStore";
import {
  V1,
  V2,
  createRig,
  defaultChannel,
  expectCompleteV1,
  expectCompleteV2,
  expectedV2Pack,
  fixtureText,
  fetchFromTable,
  offlineFetcher,
  updateChannel,
} from "./helpers";

async function seededStore(): Promise<PackageStore> {
  const store = await PackageStore.open();
  await ensureSeeded(store, () => "2026-07-31T00:00:00.000Z");
  return store;
}

describe("首次离线启动", () => {
  it("没有任何网络时也能得到完整 v1 内容", async () => {
    const { repository, store } = await createRig({
      fetchText: offlineFetcher(),
    });
    expect(repository.getSnapshot().loadStatus).toBe("ready");
    expect(repository.getSnapshot().packageVersion).toBe(V1);
    expect(repository.getSnapshot().topics.map((topic) => topic.title)).toEqual(
      ["法律援助", "公证费用减免"],
    );
    // 离线状态下全文检索可用（索引随种子包一并落库）
    expect(
      repository.searchArticles("公证").map((hit) => hit.article.id),
    ).toEqual(["ART-NOTARY-1"]);
    await expectCompleteV1(store);
  });
});

describe("更新成功路径", () => {
  it("依次经过八个阶段，切换后是完整 v2，检索与深链接随之切换", async () => {
    const store = await seededStore();
    const channel = defaultChannel();
    const stages: UpdateStage[] = [];
    const result = await runUpdate({
      fetchText: channel.fetchText,
      store,
      onStage: (stage) => stages.push(stage),
    });
    expect(result).toEqual({
      status: "updated",
      fromVersion: V1,
      toVersion: V2,
    });
    expect(stages).toEqual([
      "download",
      "checksum",
      "signature",
      "parse",
      "materialize",
      "index",
      "staging",
      "switch",
    ]);
    await expectCompleteV2(store);
    expect(await store.getPreviousVersion()).toBe(V1);
  });

  it("已经是最新版本时不重复安装", async () => {
    const { repository, store } = await createRig({
      fetchText: defaultChannel().fetchText,
    });
    await repository.checkForUpdates();
    await expectCompleteV2(store);
    const again = await repository.checkForUpdates();
    expect(again.status).toBe("already-current");
    await expectCompleteV2(store);
  });
});

describe("各阶段中断：重启后只见完整旧包", () => {
  it("下载清单中断 → download 失败，旧包完整", async () => {
    const store = await seededStore();
    const result = await runUpdate({ fetchText: offlineFetcher(), store });
    expect(result).toMatchObject({
      status: "failed",
      stage: "download",
      activeVersion: V1,
    });
    await expectCompleteV1(store);
  });

  it("下载内容包字节中断 → download 失败，旧包完整", async () => {
    const store = await seededStore();
    const channel = defaultChannel();
    const fetchText = fetchFromTable({
      "materials/manifest.json": channel.manifest,
      // 内容包地址不存在，模拟下载中断
    });
    const result = await runUpdate({ fetchText, store });
    expect(result).toMatchObject({
      status: "failed",
      stage: "download",
      activeVersion: V1,
    });
    await expectCompleteV1(store);
  });

  it("校验和不匹配 → checksum 失败，旧包完整", async () => {
    const store = await seededStore();
    // 清单里的 sha256 针对原始字节；服务器返回被篡改的字节。
    const channel = updateChannel([
      { version: V1, text: fixtureText("content-pack-v1.json"), kind: "full" },
      {
        version: V2,
        text: fixtureText("content-pack-v2.json"),
        kind: "delta",
        succeeds: V1,
      },
    ]);
    const tampered = `${fixtureText("content-pack-v2.json")} `;
    const fetchText = fetchFromTable({
      "materials/manifest.json": channel.manifest,
      [channel.packUrl(V2)]: tampered,
    });
    const result = await runUpdate({ fetchText, store });
    expect(result).toMatchObject({
      status: "failed",
      stage: "checksum",
      activeVersion: V1,
    });
    await expectCompleteV1(store);
  });

  it("包体非法 JSON → parse 失败，旧包完整", async () => {
    const store = await seededStore();
    const broken = `${fixtureText("content-pack-v2.json")}}`;
    const channel = updateChannel([
      { version: V2, text: broken, kind: "delta", succeeds: V1 },
    ]);
    const result = await runUpdate({ fetchText: channel.fetchText, store });
    expect(result).toMatchObject({
      status: "failed",
      stage: "parse",
      activeVersion: V1,
    });
    await expectCompleteV1(store);
  });

  it("增量基线不匹配 → materialize 失败，旧包完整", async () => {
    const store = await seededStore();
    const wrongBase = JSON.stringify({
      packageVersion: "2026.09.02",
      succeeds: "1999.01.01",
      changes: [],
    });
    const channel = updateChannel([
      {
        version: "2026.09.02",
        text: wrongBase,
        kind: "delta",
        succeeds: "1999.01.01",
      },
    ]);
    const result = await runUpdate({ fetchText: channel.fetchText, store });
    expect(result).toMatchObject({
      status: "failed",
      stage: "materialize",
      activeVersion: V1,
    });
    expect(result.status === "failed" ? result.message : "").toContain("基线");
    await expectCompleteV1(store);
  });

  it("IndexedDB 配额不足（暂存阶段）→ staging 失败，旧包完整", async () => {
    const store = await seededStore();
    // 模拟浏览器在暂存写入时抛出 QuotaExceededError。
    store.stagePackage = async () => {
      throw mapIdbError(new DOMException("磁盘已满", "QuotaExceededError"));
    };
    const result = await runUpdate({
      fetchText: defaultChannel().fetchText,
      store,
    });
    expect(result).toMatchObject({
      status: "failed",
      stage: "staging",
      activeVersion: V1,
    });
    expect(result.status === "failed" ? result.message : "").toContain(
      "存储空间不足",
    );
    await expectCompleteV1(store);
    expect(await store.getPackage(V2)).toBeUndefined();
  });

  it("切换事务提交前崩溃 → switch 失败，重启后旧包完整、暂存被清理", async () => {
    const store = await seededStore();
    store.activateStaged = async () => {
      throw new Error("切换事务被中止");
    };
    const result = await runUpdate({
      fetchText: defaultChannel().fetchText,
      store,
    });
    expect(result).toMatchObject({
      status: "failed",
      stage: "switch",
      activeVersion: V1,
    });
    await expectCompleteV1(store);
    expect(await store.getPackage(V2)).toBeUndefined();
  });

  it("进程在“暂存完成、切换未发生”之间崩溃 → 重启后只见完整旧包", async () => {
    const store = await seededStore();
    // 手工把一个完整 v2 放进暂存区，但不切换（模拟崩溃现场）。
    const pack = expectedV2Pack();
    await store.stagePackage({
      version: pack.packageVersion,
      status: "staged",
      pack,
      index: buildSearchIndex(pack),
      storedAt: "2026-08-01T00:00:00.000Z",
    });
    // 模拟重启：全新仓储走启动引导。
    const repository = new Repository({
      store,
      settingsStore: await SettingsStore.open(),
      fetchText: offlineFetcher(),
    });
    await repository.init();
    expect(repository.getSnapshot().packageVersion).toBe(V1);
    await expectCompleteV1(store);
    expect(await store.getPackage(V2)).toBeUndefined();
  });
});

describe("失败后的确定性行为", () => {
  it("更新失败后，检索结果仍完全来自旧版本索引", async () => {
    const { repository } = await createRig({ fetchText: offlineFetcher() });
    // v1 中“上门服务”命中旧条目 ART-AID-2
    expect(
      repository.searchArticles("上门服务").map((hit) => hit.article.id),
    ).toEqual(["ART-AID-2"]);
  });

  it("撤下条目的替代深链接跨版本确定：v1 直达，v2 跳转，回滚后再次直达", async () => {
    const { repository, store } = await createRig({
      fetchText: defaultChannel().fetchText,
    });
    expect(repository.resolveArticleLink("ART-AID-2")).toMatchObject({
      kind: "ok",
      article: { id: "ART-AID-2" },
    });
    await repository.checkForUpdates();
    await expectCompleteV2(store);
    expect(repository.resolveArticleLink("ART-AID-2")).toMatchObject({
      kind: "redirect",
      fromId: "ART-AID-2",
      article: { id: "ART-SERVICE-3" },
    });
    const rolledBackTo = await repository.rollback();
    expect(rolledBackTo).toBe(V1);
    await expectCompleteV1(store);
    expect(repository.resolveArticleLink("ART-AID-2")).toMatchObject({
      kind: "ok",
      article: { id: "ART-AID-2" },
    });
  });

  it("回滚：成功后回到完整旧版本；没有上一版本时回滚为空操作", async () => {
    const { repository, store } = await createRig({
      fetchText: defaultChannel().fetchText,
    });
    expect(await repository.rollback()).toBeNull();
    await repository.checkForUpdates();
    await expectCompleteV2(store);
    expect(await repository.rollback()).toBe(V1);
    await expectCompleteV1(store);
    // 回滚后检索回到旧版本索引（确定性）
    expect(
      repository.searchArticles("上门服务").map((hit) => hit.article.id),
    ).toEqual(["ART-AID-2"]);
  });

  it("阅读设置存放在独立仓，跨版本切换保持不变", async () => {
    const { repository, settingsStore } = await createRig({
      fetchText: defaultChannel().fetchText,
    });
    await repository.updateSettings({ fontScale: "large", theme: "dark" });
    await repository.checkForUpdates();
    expect(repository.getSnapshot().packageVersion).toBe(V2);
    expect(repository.getSnapshot().settings).toMatchObject({
      fontScale: "large",
      theme: "dark",
    });
    // 重启后（全新仓储）设置仍在
    const reopened = await settingsStore.read();
    expect(reopened).toMatchObject({ fontScale: "large", theme: "dark" });
  });
});

describe("错误映射", () => {
  it("QuotaExceededError DOMException 映射为 StorageQuotaError", () => {
    const mapped = mapIdbError(new DOMException("full", "QuotaExceededError"));
    expect(mapped).toBeInstanceOf(StorageQuotaError);
    expect(mapped.message).toContain("存储空间不足");
  });
});
