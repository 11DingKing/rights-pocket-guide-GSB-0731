import { describe, expect, it } from 'vitest';
import {
  migrateSettings,
  validateSettingsForVersion,
  expectedSchemaForPackageVersion,
} from '../src/settings/migration';
import {
  CURRENT_SETTINGS_SCHEMA,
  DEFAULT_SETTINGS,
  SETTINGS_SCHEMA_VERSION_V1,
  SETTINGS_SCHEMA_VERSION_V2,
} from '../src/types';
import type { PersistedSettings } from '../src/types';

describe('settings migration', () => {
  it('returns default settings for null/garbage input', () => {
    expect(migrateSettings(null)).toEqual({
      schemaVersion: CURRENT_SETTINGS_SCHEMA,
      settings: { ...DEFAULT_SETTINGS },
    });
    expect(migrateSettings(undefined)).toEqual({
      schemaVersion: CURRENT_SETTINGS_SCHEMA,
      settings: { ...DEFAULT_SETTINGS },
    });
    expect(migrateSettings('garbage')).toEqual({
      schemaVersion: CURRENT_SETTINGS_SCHEMA,
      settings: { ...DEFAULT_SETTINGS },
    });
    expect(migrateSettings(42)).toEqual({
      schemaVersion: CURRENT_SETTINGS_SCHEMA,
      settings: { ...DEFAULT_SETTINGS },
    });
    expect(migrateSettings([])).toEqual({
      schemaVersion: CURRENT_SETTINGS_SCHEMA,
      settings: { ...DEFAULT_SETTINGS },
    });
  });

  it('preserves schema version for already-wrapped v1 settings', () => {
    const raw = {
      schemaVersion: 1,
      settings: { fontSize: 'large', theme: 'dark', lineSpacing: 'compact' },
    };
    const result = migrateSettings(raw);
    expect(result.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION_V1);
    expect(result.settings).toEqual({
      fontSize: 'large',
      theme: 'dark',
      lineSpacing: 'compact',
    });
  });

  it('preserves schema version for already-wrapped v2 settings', () => {
    const raw = {
      schemaVersion: 2,
      settings: { fontSize: 'xlarge', theme: 'high-contrast', lineSpacing: 'spacious' },
    };
    const result = migrateSettings(raw);
    expect(result.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION_V2);
    expect(result.settings).toEqual({
      fontSize: 'xlarge',
      theme: 'high-contrast',
      lineSpacing: 'spacious',
    });
  });

  it('migrates legacy unwrapped v1 settings (no schemaVersion)', () => {
    const raw = { fontSize: 'large', theme: 'dark' };
    const result = migrateSettings(raw);
    expect(result.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION_V1);
    expect(result.settings).toEqual({
      fontSize: 'large',
      theme: 'dark',
      lineSpacing: 'normal',
    });
  });

  it('sanitizes invalid enum values in wrapped settings', () => {
    const raw = {
      schemaVersion: 2,
      settings: { fontSize: 'huge', theme: 'neon', lineSpacing: 'crazy' },
    };
    const result = migrateSettings(raw);
    expect(result.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION_V2);
    expect(result.settings).toEqual({
      fontSize: DEFAULT_SETTINGS.fontSize,
      theme: DEFAULT_SETTINGS.theme,
      lineSpacing: DEFAULT_SETTINGS.lineSpacing,
    });
  });

  it('partially sanitizes: keeps valid fields, replaces invalid ones', () => {
    const raw = {
      schemaVersion: 2,
      settings: { fontSize: 'large', theme: 'invalid-theme', lineSpacing: 'spacious' },
    };
    const result = migrateSettings(raw);
    expect(result.settings).toEqual({
      fontSize: 'large',
      theme: DEFAULT_SETTINGS.theme,
      lineSpacing: 'spacious',
    });
  });
});

describe('validateSettingsForVersion', () => {
  it('returns fallback when persisted is null', () => {
    const fallback = { fontSize: 'small', theme: 'dark', lineSpacing: 'compact' } as const;
    const result = validateSettingsForVersion(null, 2, fallback);
    expect(result).toEqual(fallback);
  });

  it('returns settings when schema version matches', () => {
    const persisted: PersistedSettings = {
      schemaVersion: 2,
      settings: { fontSize: 'large', theme: 'dark', lineSpacing: 'spacious' },
    };
    const result = validateSettingsForVersion(persisted, 2, DEFAULT_SETTINGS);
    expect(result).toEqual(persisted.settings);
  });

  it('falls back when schema version does not match (cross-version mismatch)', () => {
    const persisted: PersistedSettings = {
      schemaVersion: 2,
      settings: { fontSize: 'large', theme: 'dark', lineSpacing: 'spacious' },
    };
    const fallback = { ...DEFAULT_SETTINGS };
    const result = validateSettingsForVersion(persisted, 1, fallback);
    expect(result).toEqual(fallback);
  });

  it('does not mutate the fallback object', () => {
    const fallback = { ...DEFAULT_SETTINGS };
    const persisted: PersistedSettings = {
      schemaVersion: 2,
      settings: { fontSize: 'large', theme: 'dark', lineSpacing: 'spacious' },
    };
    validateSettingsForVersion(persisted, 1, fallback);
    expect(fallback).toEqual(DEFAULT_SETTINGS);
  });
});

describe('expectedSchemaForPackageVersion', () => {
  it('returns v1 schema for v1 pack', () => {
    expect(expectedSchemaForPackageVersion('2026.07.31')).toBe(
      SETTINGS_SCHEMA_VERSION_V1,
    );
  });

  it('returns v2 schema for v2 pack', () => {
    expect(expectedSchemaForPackageVersion('2026.09.01')).toBe(
      SETTINGS_SCHEMA_VERSION_V2,
    );
  });

  it('returns v2 schema for unknown future versions', () => {
    expect(expectedSchemaForPackageVersion('2030.01.01')).toBe(
      SETTINGS_SCHEMA_VERSION_V2,
    );
  });
});
