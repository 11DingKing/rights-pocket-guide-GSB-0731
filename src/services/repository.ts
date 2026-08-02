import {
  defaultSettingsState,
  migrateSettingsState,
  parseSettingsState,
  requiredSettingsSchema,
} from "../core/settingsSchema";
import type {
  ReadingSettingsState,
  SettingsV2Values,
} from "../core/settingsSchema";
import type { Article, Topic } from "../core/types";
import { searchIndex } from "../core/search";
import type { PackageStore, StoredPackage } from "../storage/packageStore";
import type { SettingsStore } from "../storage/settingsStore";
import { ensureSeeded } from "./seed";
import { loadSettingsState } from "./settingsState";
import { runUpdate } from "./updateService";
import type { UpdateResult } from "./updateService";

export type LoadStatus = "loading" | "ready" | "error";
export type UpdateStatus =
  | "idle"
  | "checking"
  | "updated"
  | "failed"
  | "already-current"
  | "rolled-back";

/** 视图可读取的不可变快照。 */
export interface RepositorySnapshot {
  loadStatus: LoadStatus;
  packageVersion: string | null;
  previousVersion: string | null;
  topics: Topic[];
  settings: ReadingSettingsState;
  updateStatus: UpdateStatus;
  updateMessage: string | null;
  errorMessage: string | null;
}

export type ArticleLinkResolution =
  | { kind: "ok"; article: Article }
  | { kind: "redirect"; fromId: string; article: Article }
  | { kind: "broken"; fromId: string }
  | { kind: "missing"; fromId: string };

export interface RankedArticle {
  article: Article;
  score: number;
}

export interface LegalRefGroup {
  legalRef: string;
  articles: Article[];
}

export interface RepositoryDeps {
  store: PackageStore;
  settingsStore: SettingsStore;
  fetchText: (url: string) => Promise<string>;
  digest?: (bytes: Uint8Array) => Promise<string>;
  publicKey?: JsonWebKey;
  now?: () => string;
}

/**
 * 视图唯一入口。视图不触碰 IndexedDB；所有读写都经过这里，
 * 内容以“整个激活包”的粒度暴露，从结构上杜绝新旧混合。
 */
export class Repository {
  private active: StoredPackage | null = null;
  private settings: ReadingSettingsState = defaultSettingsState(1);
  private loadStatus: LoadStatus = "loading";
  private updateStatus: UpdateStatus = "idle";
  private updateMessage: string | null = null;
  private errorMessage: string | null = null;
  private previousVersion: string | null = null;
  private updating = false;

  private snapshot: RepositorySnapshot = this.buildSnapshot();
  private readonly listeners = new Set<() => void>();

  constructor(private readonly deps: RepositoryDeps) {}

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): RepositorySnapshot => this.snapshot;

  private buildSnapshot(): RepositorySnapshot {
    return {
      loadStatus: this.loadStatus,
      packageVersion: this.active?.version ?? null,
      previousVersion: this.previousVersion,
      topics: this.active?.pack.topics ?? [],
      settings: this.settings,
      updateStatus: this.updateStatus,
      updateMessage: this.updateMessage,
      errorMessage: this.errorMessage,
    };
  }

  private notify(): void {
    this.snapshot = this.buildSnapshot();
    for (const listener of this.listeners) {
      listener();
    }
  }

  /** 启动：清理残留暂存 → 读取完整激活包（或离线播种）→ 按包版本抢救设置。 */
  async init(): Promise<void> {
    this.loadStatus = "loading";
    this.notify();
    try {
      const active = await ensureSeeded(this.deps.store, this.deps.now);
      this.active = active;
      this.previousVersion = await this.deps.store.getPreviousVersion();
      this.settings = await this.recoverSettings(active);
      this.loadStatus = "ready";
      this.errorMessage = null;
    } catch (error) {
      this.loadStatus = "error";
      this.errorMessage =
        error instanceof Error ? error.message : String(error);
    }
    this.notify();
  }

  /** 按激活包要求的 schema 读取/抢救设置（含修复写回）。 */
  private async recoverSettings(
    active: StoredPackage,
  ): Promise<ReadingSettingsState> {
    const recovery = await loadSettingsState(
      this.deps.settingsStore,
      requiredSettingsSchema(active.pack),
    );
    return recovery.state;
  }

  private requireActive(): StoredPackage {
    if (this.active === null) {
      throw new Error("内容尚未加载完成");
    }
    return this.active;
  }

  getTopic(topicId: string): Topic | undefined {
    return this.active?.pack.topics.find((topic) => topic.id === topicId);
  }

  getArticle(articleId: string): Article | undefined {
    return this.active?.pack.articles[articleId];
  }

  /**
   * 深链接解析：撤下条目沿替代链走向最终有效条目。
   * 链上带环（数据损坏时）返回 broken，视图据此渲染稳定的降级页面，绝不死循环。
   */
  resolveArticleLink(articleId: string): ArticleLinkResolution {
    const active = this.requireActive();
    const direct = active.pack.articles[articleId];
    if (direct !== undefined) {
      return { kind: "ok", article: direct };
    }
    const visited = new Set<string>([articleId]);
    let target = active.pack.withdrawals[articleId];
    while (target !== undefined) {
      const article = active.pack.articles[target];
      if (article !== undefined) {
        return { kind: "redirect", fromId: articleId, article };
      }
      if (visited.has(target)) {
        return { kind: "broken", fromId: articleId };
      }
      visited.add(target);
      target = active.pack.withdrawals[target];
    }
    return { kind: "missing", fromId: articleId };
  }

  /** 当前内容是否由旧版本更新而来（决定撤下跳转公告是否带“内容已更新”）。 */
  contentWasUpdated(): boolean {
    return this.active !== null && this.active.pack.baseVersion !== null;
  }

  /** 条目所属主题（用于“返回主题”链接）。 */
  findTopicOfArticle(articleId: string): Topic | undefined {
    return this.active?.pack.topics.find((topic) =>
      topic.articleIds.includes(articleId),
    );
  }

  /** 全文检索：结果顺序由索引与排序规则决定，跨版本重建恒定。 */
  searchArticles(query: string): RankedArticle[] {
    const active = this.active;
    if (active === null) {
      return [];
    }
    const hits = searchIndex(active.index, query);
    const results: RankedArticle[] = [];
    for (const hit of hits) {
      const article = active.pack.articles[hit.articleId];
      if (article !== undefined) {
        results.push({ article, score: hit.score });
      }
    }
    return results;
  }

  /** 法律依据索引：按法条名聚合有效条目，排序确定。 */
  listLegalRefs(): LegalRefGroup[] {
    const active = this.active;
    if (active === null) {
      return [];
    }
    const groups = new Map<string, Article[]>();
    for (const article of Object.values(active.pack.articles)) {
      const bucket = groups.get(article.legalRef);
      if (bucket === undefined) {
        groups.set(article.legalRef, [article]);
      } else {
        bucket.push(article);
      }
    }
    return [...groups.entries()]
      .map(([legalRef, articles]) => ({
        legalRef,
        articles: articles.sort((left, right) =>
          left.id.localeCompare(right.id),
        ),
      }))
      .sort((left, right) => left.legalRef.localeCompare(right.legalRef));
  }

  /**
   * 修改阅读偏好（同 schema 内）。写入失败（如配额耗尽）时内存状态不变，
   * 返回 ok:false —— 最后一次可用设置不丢失，UI 进入可访问的降级提示。
   */
  async updateSettings(
    patch: Partial<SettingsV2Values>,
  ): Promise<{ ok: boolean; message?: string }> {
    const current = this.settings;
    const next: ReadingSettingsState =
      current.schemaVersion === 1
        ? {
            schemaVersion: 1,
            values: {
              fontScale: patch.fontScale ?? current.values.fontScale,
              theme: patch.theme ?? current.values.theme,
              lineSpacing: patch.lineSpacing ?? current.values.lineSpacing,
            },
          }
        : { schemaVersion: 2, values: { ...current.values, ...patch } };
    try {
      await this.deps.settingsStore.writeCurrent(next);
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
    this.settings = next;
    this.notify();
    return { ok: true };
  }

  /** 检查并安装更新。结果同时反映在快照与返回值（供 UI 公告）。 */
  async checkForUpdates(): Promise<UpdateResult> {
    if (this.updating) {
      return {
        status: "failed",
        stage: "download",
        message: "已有更新在进行中",
        activeVersion: this.active?.version ?? "",
      };
    }
    this.updating = true;
    this.updateStatus = "checking";
    this.updateMessage = null;
    this.notify();
    try {
      const result = await runUpdate({
        fetchText: this.deps.fetchText,
        store: this.deps.store,
        settingsStore: this.deps.settingsStore,
        ...(this.deps.digest !== undefined ? { digest: this.deps.digest } : {}),
        ...(this.deps.publicKey !== undefined
          ? { publicKey: this.deps.publicKey }
          : {}),
        ...(this.deps.now !== undefined ? { now: this.deps.now } : {}),
      });
      if (result.status === "updated") {
        this.active = await this.deps.store.readConsistentActive();
        this.previousVersion = await this.deps.store.getPreviousVersion();
        if (this.active !== null) {
          this.settings = await this.recoverSettings(this.active);
        }
        this.updateStatus = "updated";
        this.updateMessage = result.toVersion;
      } else if (result.status === "already-current") {
        // 可能刚被其他标签页抢先提交：重载激活包以收敛到一致视图。
        this.active = await this.deps.store.readConsistentActive();
        this.previousVersion = await this.deps.store.getPreviousVersion();
        if (this.active !== null) {
          this.settings = await this.recoverSettings(this.active);
        }
        this.updateStatus = "already-current";
        this.updateMessage = result.activeVersion;
      } else {
        this.active = await this.deps.store.readConsistentActive();
        this.updateStatus = "failed";
        this.updateMessage = `${result.stage}：${result.message}`;
      }
      this.notify();
      return result;
    } finally {
      this.updating = false;
    }
  }

  /**
   * 回滚到上一个保留版本：包翻转与设置恢复在同一个事务提交，
   * 设置优先取更新前写入的 backup（精确恢复最后一次可用设置）。
   * 没有可回滚版本时返回 null。
   */
  async rollback(): Promise<string | null> {
    const active = this.active;
    const previousVersion = await this.deps.store.getPreviousVersion();
    if (active === null || previousVersion === null) {
      this.updateStatus = "failed";
      this.updateMessage = "没有可回滚的版本";
      this.notify();
      return null;
    }
    const previous = await this.deps.store.getPackage(previousVersion);
    if (previous === undefined) {
      this.updateStatus = "failed";
      this.updateMessage = "没有可回滚的版本";
      this.notify();
      return null;
    }
    const targetSchema = requiredSettingsSchema(previous.pack);
    const raw = await this.deps.settingsStore.readRaw();
    const restored =
      parseSettingsState(raw.backup, targetSchema) ??
      ((): ReadingSettingsState => {
        const currentAny = parseSettingsState(
          raw.current,
          requiredSettingsSchema(active.pack),
        );
        return currentAny !== null
          ? migrateSettingsState(currentAny, targetSchema)
          : defaultSettingsState(targetSchema);
      })();
    const rolledBackTo = await this.deps.store.rollbackToPrevious({
      next: restored,
      backup: this.settings,
    });
    if (rolledBackTo === null) {
      this.updateStatus = "failed";
      this.updateMessage = "没有可回滚的版本";
      this.notify();
      return null;
    }
    this.active = await this.deps.store.readConsistentActive();
    this.previousVersion = await this.deps.store.getPreviousVersion();
    this.settings = restored;
    this.updateStatus = "rolled-back";
    this.updateMessage = rolledBackTo;
    this.notify();
    return rolledBackTo;
  }
}
