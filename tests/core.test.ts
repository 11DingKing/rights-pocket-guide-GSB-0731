import { describe, expect, it } from "vitest";
import { verifySha256, sha256Hex, textToBytes } from "../src/core/checksum";
import { applyDelta } from "../src/core/delta";
import {
  ChecksumMismatchError,
  PackParseError,
  UpdatePathError,
} from "../src/core/errors";
import {
  materializeFull,
  parseDeltaPackage,
  parseFullPackage,
  parseJsonUnknown,
} from "../src/core/parse";
import { buildSearchIndex, searchIndex, tokenize } from "../src/core/search";
import type { ContentPackage } from "../src/core/types";
import {
  expectedV1Pack,
  expectedV2Pack,
  fixtureText,
  sha256Of,
} from "./helpers";

describe("解析与校验", () => {
  it("解析真实 v1 fixture 并物化出完整内容包", () => {
    const pack = expectedV1Pack();
    expect(pack.packageVersion).toBe("2026.07.31");
    expect(pack.topics.map((topic) => topic.id)).toEqual([
      "TOPIC-AID",
      "TOPIC-NOTARY",
    ]);
    expect(Object.keys(pack.articles).sort()).toEqual([
      "ART-AID-1",
      "ART-AID-2",
      "ART-NOTARY-1",
    ]);
    expect(pack.withdrawals).toEqual({});
  });

  it("拒绝结构非法的内容包并给出明细", () => {
    expect(() => parseFullPackage({ packageVersion: 1, topics: [] })).toThrow(
      PackParseError,
    );
    expect(() =>
      materializeFull(
        parseFullPackage(
          parseJsonUnknown(
            '{"packageVersion":"x","topics":[{"id":"T","title":"t","articleIds":["A"]}],"articles":[]}',
          ),
        ),
      ),
    ).toThrow(/引用了不存在的条目/);
    expect(() => parseJsonUnknown("not json")).toThrow(PackParseError);
  });

  it("拒绝字段类型错误的增量包", () => {
    expect(() =>
      parseDeltaPackage({
        packageVersion: "v",
        succeeds: "b",
        changes: [{ kind: "DELETE" }],
      }),
    ).toThrow(/未知 change 类型/);
  });
});

describe("增量物化（v1 → v2）", () => {
  it("REVISE/WITHDRAW/ADD 全部生效，撤下链归一化到替代条目", () => {
    const pack = expectedV2Pack();
    expect(pack.packageVersion).toBe("2026.09.01");
    expect(pack.baseVersion).toBe("2026.07.31");
    // REVISE：标题更新，法律依据沿用旧条目
    expect(pack.articles["ART-AID-1"]?.title).toBe(
      "无固定生活来源的法援核查规则",
    );
    expect(pack.articles["ART-AID-1"]?.legalRef).toBe("法律援助法");
    // WITHDRAW：旧条目不可用，映射到替代条目
    expect(pack.articles["ART-AID-2"]).toBeUndefined();
    expect(pack.withdrawals["ART-AID-2"]).toBe("ART-SERVICE-3");
    // ADD：新条目进入原主题
    const aidTopic = pack.topics.find((topic) => topic.id === "TOPIC-AID");
    expect(aidTopic?.articleIds).toEqual(["ART-AID-1", "ART-SERVICE-3"]);
    expect(pack.articles["ART-SERVICE-3"]?.legalRef).toBe(
      "公共法律服务规范 2026",
    );
  });

  it("succeeds 与当前版本不一致时拒绝物化，避免跨版本混合", () => {
    const delta = parseDeltaPackage(
      parseJsonUnknown(
        '{"packageVersion":"2027.01.01","succeeds":"1999.01.01","changes":[]}',
      ),
    );
    expect(() => applyDelta(expectedV1Pack(), delta)).toThrow(UpdatePathError);
  });

  it("替代条目无效时拒绝整个增量包", () => {
    const delta = parseDeltaPackage(
      parseJsonUnknown(
        '{"packageVersion":"2026.09.01","succeeds":"2026.07.31","changes":[{"kind":"WITHDRAW","articleId":"ART-AID-2","replacementArticleId":"ART-NOPE"}]}',
      ),
    );
    expect(() => applyDelta(expectedV1Pack(), delta)).toThrow(/替代条目无效/);
  });
});

describe("SHA-256 校验", () => {
  it("匹配已知测试向量", async () => {
    await expect(sha256Hex(textToBytes("abc"))).resolves.toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("字节被篡改时校验失败", async () => {
    const original = fixtureText("content-pack-v2.json");
    const tampered = `${original} `;
    await expect(
      verifySha256(textToBytes(tampered), sha256Of(original)),
    ).rejects.toThrow(ChecksumMismatchError);
  });
});

describe("检索", () => {
  it("CJK 文本切成二元组，单字保留", () => {
    expect(tokenize("上门服务")).toEqual(["上门", "门服", "服务"]);
    expect(tokenize("法")).toEqual(["法"]);
    expect(tokenize("2026 规范")).toEqual(["2026", "规范"]);
  });

  it("同一内容包重复建索引结果完全一致（确定性）", () => {
    const first = buildSearchIndex(expectedV2Pack());
    const second = buildSearchIndex(expectedV2Pack());
    expect(first).toEqual(second);
  });

  it("标题命中权重高于正文命中，排序确定", () => {
    const pack = expectedV2Pack();
    const index = buildSearchIndex(pack);
    // “核查”同时命中 ART-AID-1 的标题与正文，结果稳定指向它
    const hits = searchIndex(index, "核查");
    expect(hits.map((hit) => hit.articleId)).toEqual(["ART-AID-1"]);
    // “上门服务”在 v2 命中 ART-SERVICE-3（标题+正文）
    const hits2 = searchIndex(index, "上门服务");
    expect(hits2.map((hit) => hit.articleId)).toEqual(["ART-SERVICE-3"]);
    // 重复查询顺序不变
    expect(searchIndex(index, "上门服务")).toEqual(hits2);
  });

  it("得分相同按 articleId 升序（tie-break 确定）", () => {
    const pack: ContentPackage = {
      packageVersion: "t",
      baseVersion: null,
      topics: [{ id: "T", title: "t", articleIds: ["ART-B", "ART-A"] }],
      articles: {
        "ART-B": { id: "ART-B", title: "甲乙", body: "丙", legalRef: "X" },
        "ART-A": { id: "ART-A", title: "甲乙", body: "丁", legalRef: "Y" },
      },
      withdrawals: {},
    };
    const hits = searchIndex(buildSearchIndex(pack), "甲乙");
    expect(hits.map((hit) => hit.articleId)).toEqual(["ART-A", "ART-B"]);
    expect(hits[0]?.score).toBe(hits[1]?.score);
  });

  it("AND 语义：任一查询词无命中则整体无结果", () => {
    const index = buildSearchIndex(expectedV1Pack());
    expect(searchIndex(index, "公证 不存在的词xyz")).toEqual([]);
    expect(searchIndex(index, "")).toEqual([]);
  });
});
