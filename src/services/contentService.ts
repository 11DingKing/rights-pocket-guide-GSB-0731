import type {
  Downloader,
  MaterializedPack,
  PersistedSettings,
  ReadingSettings,
  UpdateStatus,
} from "../types";
import { CURRENT_SETTINGS_SCHEMA, DEFAULT_SETTINGS } from "../types";
import { applyDelta, materializeFullPack } from "../content/resolver";
import {
  parseRawPack,
  isDeltaPack,
  PackValidationError,
} from "../content/parser";
import { verifyChecksum, ChecksumError } from "../content/checksum";
import { SearchIndex } from "../search";
import type { ContentRepository } from "../storage/repository";
import {
  QuotaExceededStorageError,
  StorageError,
  UpdateConflictError,
} from "../storage/db";

export class UpdateAbortedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpdateAbortedError";
  }
}

export interface UpdateOptions {
  readonly expectedChecksum: string;
  readonly downloader: Downloader;
  readonly signal?: AbortSignal;
  readonly onPhase?: (phase: UpdateStatus["phase"]) => void;
}

export interface ServiceState {
  readonly pack: MaterializedPack | null;
  readonly index: SearchIndex | null;
  readonly settings: ReadingSettings;
  readonly updateStatus: UpdateStatus;
  readonly ready: boolean;
  readonly previousVersion: string | null;
  readonly canRollback: boolean;
  readonly degradedNotice: string | null;
}

export type ServiceListener = (state: ServiceState) => void;

const IDLE_STATUS: UpdateStatus = {
  phase: "idle",
  message: "",
  newVersion: null,
};

function defaultDownloader(
  url: string,
  signal: AbortSignal,
): Promise<Uint8Array> {
  return fetch(url, { signal }).then(async (response) => {
    if (!response.ok) {
      throw new StorageError(`下载失败：HTTP ${response.status}`);
    }
    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
  });
}

export class ContentService {
  private pack: MaterializedPack | null = null;
  private index: SearchIndex | null = null;
  private settings: ReadingSettings = DEFAULT_SETTINGS;
  private updateStatus: UpdateStatus = IDLE_STATUS;
  private ready = false;
  private previousVersion: string | null = null;
  private degradedNotice: string | null = null;
  private cachedState: ServiceState = {
    pack: null,
    index: null,
    settings: DEFAULT_SETTINGS,
    updateStatus: IDLE_STATUS,
    ready: false,
    previousVersion: null,
    canRollback: false,
    degradedNotice: null,
  };
  private readonly listeners = new Set<ServiceListener>();

  constructor(private readonly repository: ContentRepository) {}

  async initialize(seed: MaterializedPack): Promise<void> {
    await this.repository.initialize(seed);
    const activePack = await this.repository.getActivePack();
    if (activePack === null) {
      throw new StorageError("初始化失败：没有可用的内容包");
    }
    this.pack = activePack;
    this.index = new SearchIndex(activePack);
    this.settings = await this.repository.loadSettings();
    this.previousVersion = await this.repository.getPreviousVersion();
    this.ready = true;
    this.emit();
  }

  getState(): ServiceState {
    return this.cachedState;
  }

  subscribe(listener: ServiceListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private recomputeState(): void {
    this.cachedState = {
      pack: this.pack,
      index: this.index,
      settings: this.settings,
      updateStatus: this.updateStatus,
      ready: this.ready,
      previousVersion: this.previousVersion,
      canRollback: this.previousVersion !== null,
      degradedNotice: this.degradedNotice,
    };
  }

  private emit(): void {
    this.recomputeState();
    for (const listener of this.listeners) {
      listener(this.cachedState);
    }
  }

  private setStatus(status: UpdateStatus): void {
    this.updateStatus = status;
    this.emit();
  }

  setDegradedNotice(message: string | null): void {
    this.degradedNotice = message;
    this.emit();
  }

  private throwIfAborted(
    signal: AbortSignal | undefined,
    message: string,
  ): void {
    if (signal !== undefined && signal.aborted) {
      throw new UpdateAbortedError(message);
    }
  }

  async checkUpdate(
    url: string,
    options: UpdateOptions,
  ): Promise<MaterializedPack> {
    const signal = options.signal;
    const onPhase = options.onPhase;
    let stagedVersion: string | null = null;
    const expectedBaseVersion = this.pack?.packageVersion ?? null;

    if (expectedBaseVersion === null) {
      throw new StorageError("无法更新：当前没有活动版本");
    }

    let candidate: MaterializedPack | null = null;

    try {
      this.setStatus({
        phase: "downloading",
        message: "正在下载更新…",
        newVersion: null,
      });
      onPhase?.("downloading");
      this.throwIfAborted(signal, "下载已中断");
      const bytes = await options.downloader(
        url,
        signal ?? new AbortController().signal,
      );
      this.throwIfAborted(signal, "下载已中断");

      this.setStatus({
        phase: "verifying",
        message: "正在校验完整性…",
        newVersion: null,
      });
      onPhase?.("verifying");
      await verifyChecksum(bytes, options.expectedChecksum);
      this.throwIfAborted(signal, "校验后已中断");

      this.setStatus({
        phase: "resolving",
        message: "正在解析与归并内容包…",
        newVersion: null,
      });
      onPhase?.("resolving");
      const rawText = new TextDecoder().decode(bytes);
      const rawPack = parseRawPack(rawText);
      const resolved = this.materializeCandidate(rawPack);
      candidate = resolved;
      this.throwIfAborted(signal, "归并后已中断");

      this.setStatus({
        phase: "staging",
        message: "正在暂存新版本…",
        newVersion: resolved.packageVersion,
      });
      onPhase?.("staging");
      await this.repository.stage(resolved);
      stagedVersion = resolved.packageVersion;
      this.throwIfAborted(signal, "暂存后已中断");

      this.setStatus({
        phase: "indexing",
        message: "正在构建检索索引…",
        newVersion: resolved.packageVersion,
      });
      onPhase?.("indexing");
      const candidateIndex = new SearchIndex(resolved);
      this.throwIfAborted(signal, "索引构建后已中断");

      this.setStatus({
        phase: "committing",
        message: "正在原子切换版本…",
        newVersion: resolved.packageVersion,
      });
      onPhase?.("committing");
      const migratedSettings: PersistedSettings = {
        schemaVersion: CURRENT_SETTINGS_SCHEMA,
        settings: this.settings,
      };
      await this.repository.commit(
        resolved,
        expectedBaseVersion,
        migratedSettings,
      );
      this.throwIfAborted(signal, "提交后已中断");

      const oldVersion = this.pack?.packageVersion ?? null;
      this.pack = resolved;
      this.index = candidateIndex;
      this.previousVersion = oldVersion;
      this.setStatus({
        phase: "success",
        message: `已更新到版本 ${resolved.packageVersion}`,
        newVersion: resolved.packageVersion,
      });
      return resolved;
    } catch (error) {
      if (error instanceof UpdateConflictError && candidate !== null) {
        const activePack = await this.repository.getActivePack();
        if (activePack?.packageVersion === candidate.packageVersion) {
          this.pack = activePack;
          this.index = new SearchIndex(activePack);
          this.previousVersion = error.expectedBaseVersion;
          this.setStatus({
            phase: "success",
            message: `已由其他标签页更新到版本 ${activePack.packageVersion}`,
            newVersion: activePack.packageVersion,
          });
          return activePack;
        }
        try {
          await this.repository.discardStagedCandidate(
            candidate.packageVersion,
          );
        } catch {
          // 丢弃失败时由下次 initialize 的孤儿包清理兜底。
        }
        if (activePack !== null) {
          this.pack = activePack;
          this.index = new SearchIndex(activePack);
        }
        this.setStatus({
          phase: "failed",
          message: `另一个标签页已提交版本 ${error.currentVersion}，本次更新未生效，仍完整使用已提交版本。`,
          newVersion: null,
        });
        throw error;
      }

      if (stagedVersion !== null) {
        try {
          await this.repository.discardStagedCandidate(stagedVersion);
        } catch {
          // 丢弃暂存失败不应掩盖原始错误；暂存区会在下次初始化时清理。
        }
      }
      const message = this.describeError(error);
      this.setStatus({
        phase: "failed",
        message,
        newVersion: null,
      });
      throw error;
    }
  }

  private materializeCandidate(
    rawPack: ReturnType<typeof parseRawPack>,
  ): MaterializedPack {
    if (isDeltaPack(rawPack)) {
      if (this.pack === null) {
        throw new PackValidationError("增量包需要已有版本作为基础");
      }
      return applyDelta(this.pack, rawPack);
    }
    return materializeFullPack(rawPack);
  }

  private describeError(error: unknown): string {
    if (error instanceof UpdateAbortedError) {
      return `更新已中断，仍在使用旧版本：${error.message}`;
    }
    if (error instanceof ChecksumError) {
      return `完整性校验失败，仍在使用旧版本：${error.message}`;
    }
    if (error instanceof QuotaExceededStorageError) {
      return "存储空间不足，暂存已回滚，仍在使用旧版本。";
    }
    if (error instanceof PackValidationError) {
      return `内容包无效，仍在使用旧版本：${error.message}`;
    }
    if (error instanceof StorageError) {
      return `存储失败，仍在使用旧版本：${error.message}`;
    }
    if (error instanceof Error) {
      return `更新失败，仍在使用旧版本：${error.message}`;
    }
    return "更新失败，仍在使用旧版本。";
  }

  async rollback(): Promise<string> {
    const currentVersion = this.pack?.packageVersion ?? null;
    const version = await this.repository.rollback();
    const pack = await this.repository.getActivePack();
    if (pack === null) {
      throw new StorageError("回滚后无法加载活动版本");
    }
    this.pack = pack;
    this.index = new SearchIndex(pack);
    this.previousVersion = currentVersion;
    this.setStatus({
      phase: "success",
      message: `已回滚到版本 ${version}`,
      newVersion: version,
    });
    return version;
  }

  async updateSettings(settings: ReadingSettings): Promise<void> {
    const previous = this.settings;
    this.settings = settings;
    this.emit();
    try {
      await this.repository.saveSettings(settings);
      this.degradedNotice = null;
      this.emit();
    } catch (error) {
      if (error instanceof QuotaExceededStorageError) {
        this.degradedNotice =
          "存储空间不足，新设置仅在本次会话生效，已保留上一次保存的阅读设置。";
        this.emit();
        return;
      }
      this.settings = previous;
      this.emit();
      throw error;
    }
  }

  resetUpdateStatus(): void {
    if (
      this.updateStatus.phase === "success" ||
      this.updateStatus.phase === "failed"
    ) {
      this.setStatus(IDLE_STATUS);
    }
  }

  reportUpdateFailure(message: string): void {
    this.setStatus({
      phase: "failed",
      message,
      newVersion: null,
    });
  }

  static createDefaultDownloader(): Downloader {
    return defaultDownloader;
  }
}
