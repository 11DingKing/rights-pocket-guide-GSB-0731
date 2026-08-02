import "fake-indexeddb/auto";
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { webcrypto } from "node:crypto";

// jsdom 环境补齐 WebCrypto（SHA-256 校验依赖）。
if (globalThis.crypto === undefined || globalThis.crypto.subtle === undefined) {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
  });
}

beforeEach(() => {
  // 每个用例一个全新的 IndexedDB 实例，等价于“全新设备”。
  globalThis.indexedDB = new IDBFactory();
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  cleanup();
});
