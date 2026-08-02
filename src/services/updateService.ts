import { sha256Hex, textToBytes } from "../core/checksum";
import {
  ChecksumMismatchError,
  SwitchConflictError,
  UpdatePathError,
} from "../core/errors";
import type { UpdateStage } from "../core/errors";
import { applyDelta } from "../core/delta";
import {
  materializeFull,
  parseDeltaPackage,
  parseFullPackage,
  parseJsonUnknown,
  parseManifest,
} from "../core/parse";
import { buildSearchIndex } from "../core/search";
import type { SearchIndex } from "../core/search";
import { verifyPackSignature } from "../core/signature";
import type { ContentPackage, ManifestEntry } from "../core/types";
import type { PackageStore } from "../storage/packageStore";
import { DEV_SIGNING_PUBLIC_KEY } from "./signingKeys";

export interface UpdateDeps {
  /** 下载入口（测试可注入中断）。 */
  fetchText: (url: string) => Promise<string>;
  store: PackageStore;
  /** 摘要算法（测试可注入以制造校验失败）。 */
  digest?: (bytes: Uint8Array) => Promise<string>;
  /** 签名验证公钥（默认随应用分发的开发公钥；测试注入自己的密钥对）。 */
  publicKey?: JsonWebKey;
  now?: () => string;
  /** 阶段回调：UI 展示与测试断言各阶段中断点。 */
  onStage?: (stage: UpdateStage) => void;
}

export type UpdateResult =
  | { status: "updated"; fromVersion: string; toVersion: string }
  | { status: "already-current"; activeVersion: string }
  | {
      status: "failed";
      stage: UpdateStage;
      message: string;
      activeVersion: string;
    };

type ParsedPack =
  | { kind: "delta"; wire: ReturnType<typeof parseDeltaPackage> }
  | { kind: "full"; wire: ReturnType<typeof parseFullPackage> };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 更新编排：下载 → 哈希校验 → 签名校验 → 解析 → 物化 → 索引 → 暂存 → 原子切换。
 * 任何阶段失败：激活指针从未移动，旧版本完整可用；残留的暂存包被清理。
 * 切换携带基线版本做乐观并发检查：两个标签页同时更新时只有一个能提交，
 * 落败方若发现目标版本已被对方提交，则按 already-current 收敛。
 */
export async function runUpdate(deps: UpdateDeps): Promise<UpdateResult> {
  const { store, fetchText } = deps;
  const digest = deps.digest ?? sha256Hex;
  const publicKey = deps.publicKey ?? DEV_SIGNING_PUBLIC_KEY;
  const now = deps.now ?? (() => new Date().toISOString());
  const report = (stage: UpdateStage): void => {
    deps.onStage?.(stage);
  };

  const active = await store.readConsistentActive();
  if (active === null) {
    return {
      status: "failed",
      stage: "switch",
      message: "本机没有可用的内容包，无法更新",
      activeVersion: "",
    };
  }
  const activeVersion = active.version;

  const fail = async (
    stage: UpdateStage,
    error: unknown,
  ): Promise<UpdateResult> => {
    // 清理可能残留的暂存包；清理失败不影响旧版本继续使用。
    await store.discardStaged().catch(() => undefined);
    return {
      status: "failed",
      stage,
      message: errorMessage(error),
      activeVersion,
    };
  };

  // 阶段 1：下载（清单 + 内容包）。
  report("download");
  let entry: ManifestEntry;
  let packText: string;
  try {
    const manifest = parseManifest(
      parseJsonUnknown(await fetchText("materials/manifest.json")),
    );
    const found = manifest.packages.find(
      (item) => item.packageVersion === manifest.latest,
    );
    if (found === undefined) {
      throw new UpdatePathError("更新清单中找不到最新版本条目");
    }
    entry = found;
    if (entry.packageVersion === activeVersion) {
      return { status: "already-current", activeVersion };
    }
    packText = await fetchText(entry.url);
  } catch (error) {
    return fail("download", error);
  }

  // 阶段 2：哈希校验（下载字节的 SHA-256 对照清单权威值）。
  report("checksum");
  try {
    const actual = await digest(textToBytes(packText));
    if (actual !== entry.sha256.toLowerCase()) {
      throw new ChecksumMismatchError(entry.sha256, actual);
    }
  } catch (error) {
    return fail("checksum", error);
  }

  // 阶段 3：签名校验（清单中的 ECDSA 签名必须过内置公钥，防止清单被整体替换）。
  report("signature");
  try {
    await verifyPackSignature(
      entry.sha256.toLowerCase(),
      entry.signature,
      publicKey,
    );
  } catch (error) {
    return fail("signature", error);
  }

  // 阶段 4：解析。
  report("parse");
  let parsed: ParsedPack;
  try {
    parsed =
      entry.kind === "delta"
        ? { kind: "delta", wire: parseDeltaPackage(parseJsonUnknown(packText)) }
        : { kind: "full", wire: parseFullPackage(parseJsonUnknown(packText)) };
  } catch (error) {
    return fail("parse", error);
  }

  // 阶段 5：物化（增量应用 / 全量校验，含 succeeds 链检查）。
  report("materialize");
  let pack: ContentPackage;
  try {
    if (parsed.kind === "delta") {
      pack = applyDelta(active.pack, parsed.wire);
    } else {
      if (entry.succeeds !== undefined && entry.succeeds !== activeVersion) {
        throw new UpdatePathError(
          `全量包 ${parsed.wire.packageVersion} 要求基线 ${entry.succeeds}，当前版本 ${activeVersion} 不满足`,
        );
      }
      pack = materializeFull(parsed.wire);
    }
  } catch (error) {
    return fail("materialize", error);
  }

  // 阶段 6：为新包独立建索引（索引随包整体切换，绝不跨版本复用）。
  report("index");
  let index: SearchIndex;
  try {
    index = buildSearchIndex(pack);
  } catch (error) {
    return fail("index", error);
  }

  // 阶段 7：暂存（此时激活指针仍指向旧版本）。
  report("staging");
  try {
    await store.stagePackage({
      version: pack.packageVersion,
      status: "staged",
      pack,
      index,
      storedAt: now(),
    });
  } catch (error) {
    return fail("staging", error);
  }

  // 阶段 8：原子切换（单事务翻转指针；携带基线版本做乐观并发检查）。
  report("switch");
  try {
    await store.activateStaged(pack.packageVersion, activeVersion);
  } catch (error) {
    if (error instanceof SwitchConflictError) {
      // 另一标签页抢先提交；若目标版本已就位，按“已是最新”收敛。
      const nowActive = await store.readConsistentActive().catch(() => null);
      if (nowActive !== null && nowActive.version === pack.packageVersion) {
        await store.discardStaged().catch(() => undefined);
        return { status: "already-current", activeVersion: nowActive.version };
      }
    }
    return fail("switch", error);
  }

  await store.discardStaged().catch(() => undefined);
  return {
    status: "updated",
    fromVersion: activeVersion,
    toVersion: pack.packageVersion,
  };
}
