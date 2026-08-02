/**
 * Repository — the ONLY interface the React views use to reach content. It
 * exposes an immutable, resolved view of the active package plus deterministic
 * search, deep-link migration, and reading settings. Views never import the
 * storage or service layers, and never touch IndexedDB.
 */
import { coerceSettings, migrateSettings, normalizeSchema } from '../core/readingSettings';
import { followRedirect } from '../core/resolve';
import { SearchIndex } from '../core/search/index';
import type {
  Article,
  ReadingSettings,
  ResolvedSnapshot,
  SearchHit,
  StoredPackage,
  Topic,
} from '../core/types';
import { DEFAULT_READING_SETTINGS, settingsSchemaForPackage } from '../core/types';
import type { PackageStore } from '../storage/packageStore';

/** Deep-link resolution result surfaced to the view for accessible handling. */
export type DeepLinkResult =
  | {
      readonly kind: 'resolved';
      readonly articleId: string;
      readonly migrated: boolean;
      readonly requestedId: string;
    }
  | { readonly kind: 'unknown'; readonly requestedId: string }
  | { readonly kind: 'cycle'; readonly requestedId: string };

/** Loaded settings plus whether the stored value was valid (for degraded UI). */
export interface LoadedSettings {
  readonly settings: ReadingSettings;
  readonly schemaVersion: number;
  /** False when the persisted value was invalid and had to be coerced. */
  readonly valid: boolean;
}

/** A frozen, view-ready snapshot of the active content package. */
export class ContentRepository {
  private readonly index: SearchIndex;

  constructor(
    private readonly stored: StoredPackage,
    private readonly store: PackageStore,
  ) {
    this.index = new SearchIndex(stored.index);
  }

  get packageVersion(): string {
    return this.stored.packageVersion;
  }

  /** The settings schema this active package expects. */
  get settingsSchema(): number {
    return settingsSchemaForPackage(this.stored.packageVersion);
  }

  get snapshot(): ResolvedSnapshot {
    return this.stored.snapshot;
  }

  get topics(): readonly Topic[] {
    return this.stored.snapshot.topics;
  }

  getArticle(id: string): Article | undefined {
    return this.stored.snapshot.articles[id];
  }

  /** Deterministic full-text search over the active package. */
  search(query: string): SearchHit[] {
    return this.index.search(query);
  }

  /**
   * Resolve a requested article id (possibly a withdrawn one) to a live target.
   * Returns a discriminated result so the view can distinguish a successful
   * migration from an unknown id or a (defensive) cyclic replacement chain and
   * render an accessible degraded state for the latter.
   */
  resolveDeepLink(requestedId: string): DeepLinkResult {
    const result = followRedirect(this.stored.snapshot, requestedId);
    switch (result.kind) {
      case 'resolved':
        return {
          kind: 'resolved',
          articleId: result.targetId,
          migrated: result.migrated,
          requestedId,
        };
      case 'cycle':
        return { kind: 'cycle', requestedId };
      case 'unknown':
        return { kind: 'unknown', requestedId };
      default: {
        const never: never = result;
        return never;
      }
    }
  }

  /**
   * Load reading settings, coercing invalid stored data to the last usable /
   * default value (never throwing) and migrating to this package's schema.
   * `valid` reports whether the persisted value was already valid so the view
   * can surface an accessible "reverted to safe settings" status.
   */
  async loadSettings(): Promise<LoadedSettings> {
    const raw = await this.store.getRawSettings();
    const coerced = coerceSettings(raw?.value, DEFAULT_READING_SETTINGS);
    const schema = this.settingsSchema;
    return {
      settings: migrateSettings(coerced.settings, schema),
      schemaVersion: normalizeSchema(schema),
      valid: raw !== undefined && coerced.valid,
    };
  }

  /** Persist settings at this package's schema version. */
  saveSettings(settings: ReadingSettings): Promise<void> {
    return this.store.saveSettings(settings, normalizeSchema(this.settingsSchema));
  }
}
