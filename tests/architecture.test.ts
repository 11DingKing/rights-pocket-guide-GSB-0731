import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");

function collectTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      files.push(...collectTsFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

describe("架构约束（自动化守护）", () => {
  it("src 内不使用 any 与非空断言", () => {
    const patterns: Array<{ name: string; regex: RegExp }> = [
      { name: "显式 any 注解", regex: /:\s*any\b/ },
      { name: "as any", regex: /\bas\s+any\b/ },
      { name: "泛型 any", regex: /<any>/ },
      { name: "非空断言", regex: /[A-Za-z0-9_\)\]]!(?=[.\[(])/ },
    ];
    const offenders: string[] = [];
    for (const file of collectTsFiles(SRC)) {
      const text = readFileSync(file, "utf8");
      for (const { name, regex } of patterns) {
        if (regex.test(text)) {
          offenders.push(`${relative(SRC, file)}：${name}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("ui 层不直接依赖 storage 层或 IndexedDB API", () => {
    const offenders: string[] = [];
    for (const file of collectTsFiles(join(SRC, "ui"))) {
      const text = readFileSync(file, "utf8");
      if (
        /storage\//.test(text) ||
        /\bindexedDB\b|IDBObjectStore|IDBTransaction/.test(text)
      ) {
        offenders.push(relative(SRC, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});
