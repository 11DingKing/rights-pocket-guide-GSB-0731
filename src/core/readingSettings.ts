/**
 * Reading-settings schema handling: validation (tolerant coercion), migration
 * between schema versions, and projection to the fields a given schema knows.
 *
 * Design principles for accessible, non-destructive degradation:
 *  - `coerceSettings` NEVER throws. Given arbitrary/invalid stored data it
 *    returns a valid `ReadingSettings` plus a `valid` flag, filling unknown or
 *    invalid fields from a fallback (the last usable settings, else defaults).
 *    This guarantees an invalid user preference can never wipe out the last
 *    usable configuration.
 *  - Migration is pure and total: down-migrating drops schema-2-only fields;
 *    up-migrating supplies defaults for new fields. Because migration is
 *    deterministic, the atomic package switch can compute the target-schema
 *    settings and commit them together with the package.
 */
import type { ReadingSettings } from './types';
import { CURRENT_SETTINGS_SCHEMA, DEFAULT_READING_SETTINGS } from './types';

const FONT_SCALES = ['normal', 'large', 'xlarge'] as const;
const CONTRASTS = ['normal', 'high'] as const;
const LINE_SPACINGS = ['normal', 'loose'] as const;
const UNDERLINES = ['on', 'off'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

export interface CoerceResult {
  readonly settings: ReadingSettings;
  /** True when the input was a fully valid `ReadingSettings`. */
  readonly valid: boolean;
}

/**
 * Coerce arbitrary stored/user data into a valid `ReadingSettings`. Invalid or
 * missing fields fall back to `fallback` (defaults to the last-usable or
 * built-in defaults). Never throws, so a corrupt preference degrades to the
 * last usable value rather than crashing.
 */
export function coerceSettings(
  value: unknown,
  fallback: ReadingSettings = DEFAULT_READING_SETTINGS,
): CoerceResult {
  if (!isRecord(value)) {
    return { settings: fallback, valid: false };
  }
  let valid = true;
  const pick = <T extends string>(
    key: keyof ReadingSettings,
    allowed: readonly T[],
  ): T => {
    const raw = value[key];
    if (oneOf(raw, allowed)) {
      return raw;
    }
    valid = false;
    // Fall back field-by-field to the last usable value.
    return fallback[key] as T;
  };

  const settings: ReadingSettings = {
    fontScale: pick('fontScale', FONT_SCALES),
    contrast: pick('contrast', CONTRASTS),
    lineSpacing: pick('lineSpacing', LINE_SPACINGS),
    underlineLinks: pick('underlineLinks', UNDERLINES),
  };
  return { settings, valid };
}

/**
 * Migrate a settings value to the shape a target schema expects. Migration is
 * total and deterministic. We keep a single in-memory `ReadingSettings` type
 * across schemas; migrating "to schema 1" simply normalizes the schema-2-only
 * field to its default so a subsequent up-migration is lossless-by-default.
 */
export function migrateSettings(
  settings: ReadingSettings,
  toSchema: number,
): ReadingSettings {
  if (toSchema <= 1) {
    // Schema 1 does not model `underlineLinks`; normalize it to the default so
    // the persisted schema-1 record is canonical.
    return { ...settings, underlineLinks: DEFAULT_READING_SETTINGS.underlineLinks };
  }
  // Schema 2 (and any future forward-compatible read): keep all known fields.
  return { ...settings };
}

/** Clamp a schema number to the range this build understands. */
export function normalizeSchema(schema: number): number {
  if (!Number.isFinite(schema) || schema < 1) {
    return 1;
  }
  if (schema > CURRENT_SETTINGS_SCHEMA) {
    return CURRENT_SETTINGS_SCHEMA;
  }
  return Math.floor(schema);
}
