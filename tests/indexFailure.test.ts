import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  materializeFull,
  parseFullPackage,
  parseJsonUnknown,
} from "../src/core/parse";
import { runUpdate } from "../src/services/updateService";
import { PackageStore } from "../src/storage/packageStore";
import { V1, defaultChannel, expectCompleteV1 } from "./helpers";

// 仅在本文件内让“建索引”这一步崩溃，验证索引阶段中断的处理。
vi.mock("../src/core/search", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/core/search")>();
  return {
    ...actual,
    buildSearchIndex: (): never => {
      throw new Error("索引构建被中断");
    },
  };
});

describe("索引阶段中断", () => {
  it("建索引崩溃 → index 失败，旧包完整", async () => {
    const store = await PackageStore.open();
    // 种子安装也走 buildSearchIndex，这里用未被 mock 的真实实现先播种。
    const actual =
      await vi.importActual<typeof import("../src/core/search")>(
        "../src/core/search",
      );
    const pack = materializeFull(
      parseFullPackage(
        parseJsonUnknown(
          readFileSync(
            join(process.cwd(), "materials", "content-pack-v1.json"),
            "utf8",
          ),
        ),
      ),
    );
    await store.installInitial({
      version: pack.packageVersion,
      status: "active",
      pack,
      index: actual.buildSearchIndex(pack),
      storedAt: "2026-07-31T00:00:00.000Z",
    });

    const result = await runUpdate({
      fetchText: defaultChannel().fetchText,
      store,
    });
    expect(result).toMatchObject({
      status: "failed",
      stage: "index",
      activeVersion: V1,
    });
    await expectCompleteV1(store);
  });
});
