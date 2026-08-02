import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "vitest";
import { applyDelta } from "../src/core/delta";
import {
  materializeFull,
  parseDeltaPackage,
  parseFullPackage,
  parseJsonUnknown,
} from "../src/core/parse";
import type { ContentPackage } from "../src/core/types";
import { PackageStore } from "../src/storage/packageStore";
import { SettingsStore } from "../src/storage/settingsStore";
import { Repository } from "../src/services/repository";

export const V1 = "2026.07.31";
export const V2 = "2026.09.01";

const materialsDir = join(process.cwd(), "materials");

/** 直接读取 materials/ 里的真实 fixture，测试与应用吃同一份数据。 */
export function fixtureText(file: string): string {
  return readFileSync(join(materialsDir, file), "utf8");
}

export function sha256Of(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export interface PackSpec {
  version: string;
  text: string;
  kind: "full" | "delta";
  succeeds?: string;
}

export function manifestFor(packs: PackSpec[]): string {
  const entries = packs.map((pack) => ({
    packageVersion: pack.version,
    url: `materials/${pack.version}.json`,
    sha256: sha256Of(pack.text),
    kind: pack.kind,
    ...(pack.succeeds !== undefined ? { succeeds: pack.succeeds } : {}),
  }));
  const last = entries[entries.length - 1];
  return JSON.stringify({
    latest: last?.packageVersion ?? "",
    packages: entries,
  });
}

export function fetchFromTable(
  table: Record<string, string>,
): (url: string) => Promise<string> {
  return async (url: string) => {
    const text = table[url];
    if (text === undefined) {
      throw new Error(`网络不可用：${url}`);
    }
    return text;
  };
}

/** 完全离线的下载器：任何请求都失败。 */
export function offlineFetcher(): (url: string) => Promise<string> {
  return async (url: string) => {
    throw new Error(`网络不可用：${url}`);
  };
}

export interface UpdateChannel {
  manifest: string;
  fetchText: (url: string) => Promise<string>;
  packUrl: (version: string) => string;
}

/** 构造一个“更新服务器”：清单 + 各内容包字节，校验和为真实 SHA-256。 */
export function updateChannel(packs: PackSpec[]): UpdateChannel {
  const manifest = manifestFor(packs);
  const table: Record<string, string> = { "materials/manifest.json": manifest };
  for (const pack of packs) {
    table[`materials/${pack.version}.json`] = pack.text;
  }
  return {
    manifest,
    fetchText: fetchFromTable(table),
    packUrl: (version: string) => `materials/${version}.json`,
  };
}

export function defaultChannel(): UpdateChannel {
  return updateChannel([
    { version: V1, text: fixtureText("content-pack-v1.json"), kind: "full" },
    {
      version: V2,
      text: fixtureText("content-pack-v2.json"),
      kind: "delta",
      succeeds: V1,
    },
  ]);
}

export function expectedV1Pack(): ContentPackage {
  return materializeFull(
    parseFullPackage(parseJsonUnknown(fixtureText("content-pack-v1.json"))),
  );
}

export function expectedV2Pack(): ContentPackage {
  return applyDelta(
    expectedV1Pack(),
    parseDeltaPackage(parseJsonUnknown(fixtureText("content-pack-v2.json"))),
  );
}

export interface TestRig {
  repository: Repository;
  store: PackageStore;
  settingsStore: SettingsStore;
}

export interface RigOptions {
  fetchText?: (url: string) => Promise<string>;
  digest?: (bytes: Uint8Array) => Promise<string>;
  now?: () => string;
}

/** 装配一个全新仓储（全新 IDB），等价于用户首次打开应用。 */
export async function createRig(options: RigOptions = {}): Promise<TestRig> {
  const store = await PackageStore.open();
  const settingsStore = await SettingsStore.open();
  const repository = new Repository({
    store,
    settingsStore,
    fetchText: options.fetchText ?? offlineFetcher(),
    ...(options.digest !== undefined ? { digest: options.digest } : {}),
    ...(options.now !== undefined ? { now: options.now } : {}),
  });
  await repository.init();
  return { repository, store, settingsStore };
}

/** 断言：当前激活内容是“完整的 v1”，不含任何 v2 痕迹。 */
export async function expectCompleteV1(store: PackageStore): Promise<void> {
  const active = await store.readConsistentActive();
  expect(active?.version).toBe(V1);
  expect(active?.status).toBe("active");
  expect(active?.pack).toEqual(expectedV1Pack());
}

/** 断言：当前激活内容是“完整的 v2”。 */
export async function expectCompleteV2(store: PackageStore): Promise<void> {
  const active = await store.readConsistentActive();
  expect(active?.version).toBe(V2);
  expect(active?.status).toBe("active");
  expect(active?.pack).toEqual(expectedV2Pack());
}
