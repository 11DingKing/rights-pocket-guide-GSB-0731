import {
  createHash,
  createPrivateKey,
  generateKeyPairSync,
  sign as nodeSign,
} from "node:crypto";
import type { JsonWebKey as NodeJsonWebKey } from "node:crypto";
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
import devKeyPair from "../scripts/dev-signing-key.json";

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

// —— 测试签名器：node:crypto 同步 ECDSA（IEEE-P1363），模拟“签名服务”。——
export interface TestSigner {
  publicKey: JsonWebKey;
  sign: (sha256Hex: string) => string;
}

function nodeSigner(privateJwk: JsonWebKey, publicJwk: JsonWebKey): TestSigner {
  const key = createPrivateKey({
    key: privateJwk as NodeJsonWebKey,
    format: "jwk",
  });
  return {
    publicKey: publicJwk,
    sign: (sha256Hex: string) =>
      nodeSign("sha256", Buffer.from(sha256Hex, "utf8"), {
        key,
        dsaEncoding: "ieee-p1363",
      }).toString("base64"),
  };
}

/** 与应用内置公钥同源的开发签名器（默认通道用它签名）。 */
export function devSigner(): TestSigner {
  return nodeSigner(
    devKeyPair.privateJwk as JsonWebKey,
    devKeyPair.publicJwk as JsonWebKey,
  );
}

/** 临时密钥对：用于“错误公钥 / 伪造签名”等失败用例。 */
export function generateSigner(): TestSigner {
  const { publicKey, privateKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });
  return nodeSigner(
    privateKey.export({ format: "jwk" }),
    publicKey.export({ format: "jwk" }),
  );
}

export interface PackSpec {
  version: string;
  text: string;
  kind: "full" | "delta";
  succeeds?: string;
}

export interface ChannelOptions {
  /** 自定义签名行为：默认用 devSigner 对真实 sha256 签名。 */
  signWith?: (sha256Hex: string) => string;
}

function manifestFor(packs: PackSpec[], options: ChannelOptions): string {
  const sign = options.signWith ?? devSigner().sign;
  const entries = packs.map((pack) => {
    const sha256 = sha256Of(pack.text);
    return {
      packageVersion: pack.version,
      url: `materials/${pack.version}.json`,
      sha256,
      signature: sign(sha256),
      kind: pack.kind,
      ...(pack.succeeds !== undefined ? { succeeds: pack.succeeds } : {}),
    };
  });
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

/** 构造一个“更新服务器”：清单 + 各内容包字节；校验和为真实 SHA-256，签名为真实 ECDSA。 */
export function updateChannel(
  packs: PackSpec[],
  options: ChannelOptions = {},
): UpdateChannel {
  const manifest = manifestFor(packs, options);
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

/**
 * 损坏内容包：ART-AID-2 不在有效条目里，但撤下映射成环
 * （ART-AID-2 → ART-X → ART-AID-2）。用于验证 broken 降级路径。
 */
export function corruptCyclicPack(): ContentPackage {
  const base = expectedV1Pack();
  const articles: Record<string, (typeof base.articles)[string]> = {};
  for (const [id, article] of Object.entries(base.articles)) {
    if (id !== "ART-AID-2") {
      articles[id] = article;
    }
  }
  return {
    ...base,
    topics: base.topics.map((topic) => ({
      ...topic,
      articleIds: topic.articleIds.filter((id) => id !== "ART-AID-2"),
    })),
    articles,
    withdrawals: { "ART-AID-2": "ART-X", "ART-X": "ART-AID-2" },
  };
}

export interface TestRig {
  repository: Repository;
  store: PackageStore;
  settingsStore: SettingsStore;
}

export interface RigOptions {
  fetchText?: (url: string) => Promise<string>;
  digest?: (bytes: Uint8Array) => Promise<string>;
  publicKey?: JsonWebKey;
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
    ...(options.publicKey !== undefined
      ? { publicKey: options.publicKey }
      : {}),
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

/** 仓储当前可见的主题/条目集合（用于跨版本对比“可见集合”）。 */
export function visibleSet(repository: Repository): {
  topics: string[];
  articles: string[];
} {
  const topics = repository.getSnapshot().topics;
  return {
    topics: topics.map((topic) => topic.id),
    articles: topics.flatMap((topic) => topic.articleIds).sort(),
  };
}
