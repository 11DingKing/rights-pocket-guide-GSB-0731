import {
  CURRENT_SETTINGS_SCHEMA,
  DEFAULT_SETTINGS,
  SETTINGS_SCHEMA_VERSION_V1,
  SETTINGS_SCHEMA_VERSION_V2,
} from '../types';
import type {
  FontSize,
  LineSpacing,
  PersistedSettings,
  ReadingSettings,
  Theme,
} from '../types';

const FONT_SIZES: ReadonlySet<FontSize> = new Set([
  'small',
  'medium',
  'large',
  'xlarge',
]);
const THEMES: ReadonlySet<Theme> = new Set([
  'light',
  'dark',
  'high-contrast',
]);
const LINE_SPACINGS: ReadonlySet<LineSpacing> = new Set([
  'compact',
  'normal',
  'spacious',
]);

export class SettingsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettingsValidationError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidFontSize(value: unknown): value is FontSize {
  return typeof value === 'string' && FONT_SIZES.has(value as FontSize);
}

function isValidTheme(value: unknown): value is Theme {
  return typeof value === 'string' && THEMES.has(value as Theme);
}

function isValidLineSpacing(value: unknown): value is LineSpacing {
  return typeof value === 'string' && LINE_SPACINGS.has(value as LineSpacing);
}

function sanitize(raw: unknown, fallback: ReadingSettings): ReadingSettings {
  if (!isRecord(raw)) return fallback;
  return {
    fontSize: isValidFontSize(raw.fontSize) ? raw.fontSize : fallback.fontSize,
    theme: isValidTheme(raw.theme) ? raw.theme : fallback.theme,
    lineSpacing: isValidLineSpacing(raw.lineSpacing)
      ? raw.lineSpacing
      : fallback.lineSpacing,
  };
}

export function migrateSettings(raw: unknown): PersistedSettings {
  if (!isRecord(raw)) {
    return {
      schemaVersion: CURRENT_SETTINGS_SCHEMA,
      settings: { ...DEFAULT_SETTINGS },
    };
  }

  if (typeof raw.schemaVersion === 'number') {
    const settings = sanitize(raw.settings, DEFAULT_SETTINGS);
    return {
      schemaVersion: raw.schemaVersion,
      settings,
    };
  }

  if (
    typeof raw.fontSize === 'string' ||
    typeof raw.theme === 'string'
  ) {
    const v1 = sanitize(raw, DEFAULT_SETTINGS);
    const migrated: ReadingSettings = {
      fontSize: v1.fontSize,
      theme: v1.theme,
      lineSpacing: DEFAULT_SETTINGS.lineSpacing,
    };
    return {
      schemaVersion: SETTINGS_SCHEMA_VERSION_V1,
      settings: migrated,
    };
  }

  return {
    schemaVersion: CURRENT_SETTINGS_SCHEMA,
    settings: { ...DEFAULT_SETTINGS },
  };
}

export function validateSettingsForVersion(
  persisted: PersistedSettings | null,
  expectedSchema: number,
  fallback: ReadingSettings,
): ReadingSettings {
  if (persisted === null) return { ...fallback };
  if (persisted.schemaVersion !== expectedSchema) {
    return { ...fallback };
  }
  return sanitize(persisted.settings, fallback);
}

export function expectedSchemaForPackageVersion(
  packageVersion: string,
): number {
  if (packageVersion === '2026.07.31') return SETTINGS_SCHEMA_VERSION_V1;
  return SETTINGS_SCHEMA_VERSION_V2;
}
