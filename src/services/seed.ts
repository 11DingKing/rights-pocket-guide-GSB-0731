import seedV1Json from "../../materials/content-pack-v1.json";
import { materializeFull, parseFullPackage } from "../core/parse";
import { buildSearchIndex } from "../core/search";
import type { PackageStore, StoredPackage } from "../storage/packageStore";

/**
 * 首个内容包随应用包一并分发（构建期内联），因此首次启动即使完全
 * 离线也能得到完整的旧版本内容。种子包与下载包走同一套解析/物化管线。
 */
export function buildSeedRecord(
  now: () => string = () => new Date().toISOString(),
): StoredPackage {
  const wire = parseFullPackage(seedV1Json as unknown);
  const pack = materializeFull(wire);
  return {
    version: pack.packageVersion,
    status: "active",
    pack,
    index: buildSearchIndex(pack),
    storedAt: now(),
  };
}

/** 启动引导：有完整激活包就用它；否则清掉残留暂存并安装种子包。 */
export async function ensureSeeded(
  store: PackageStore,
  now?: () => string,
): Promise<StoredPackage> {
  await store.discardStaged();
  const active = await store.readConsistentActive();
  if (active !== null) {
    return active;
  }
  const record = buildSeedRecord(now);
  await store.installInitial(record);
  return { ...record, status: "active" };
}
