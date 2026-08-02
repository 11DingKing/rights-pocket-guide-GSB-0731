import type { FontScale, LetterSpacing, LineSpacing, ThemeName } from './types';
import type { ContentPackage } from './types';

// —— 阅读设置 schema：与内容包版本绑定，迁移随切换事务原子提交。——
export const SETTINGS_SCHEMA_V1 = 1;
export const SETTINGS_SCHEMA_V2 = 2;

/** schema 1（第 1 轮）：字号 / 主题 / 行距。 */
export interface SettingsV1Values {
  fontScale: FontScale;
  theme: ThemeName;
  lineSpacing: LineSpacing;
}

/** schema 2（第 3 轮起）：新增字间距。 */
export interface SettingsV2Values extends SettingsV1Values {
  letterSpacing: LetterSpacing;
}

export type ReadingSettingsState =
  | { schemaVersion: typeof SETTINGS_SCHEMA_V1; values: SettingsV1Values }
  | { schemaVersion: typeof SETTINGS_SCHEMA_V2; values: SettingsV2Values };

export const DEFAULT_SETTINGS_V1: { schemaVersion: 1; values: SettingsV1Values } = {
  schemaVersion: SETTINGS_SCHEMA_V1,
  values: { fontScale: 'standard', theme: 'system', lineSpacing: 'standard' }
};

export const DEFAULT_SETTINGS_V2: { schemaVersion: 2; values: SettingsV2Values } = {
  schemaVersion: SETTINGS_SCHEMA_V2,
  values: { fontScale: 'standard', theme: 'system', lineSpacing: 'standard', letterSpacing: 'standard' }
};

/**
 * 内容包版本 → 所需设置 schema。规则：全量/种子包（无基线）用 schema 1，
 * 增量 lineage（v2 起）用 schema 2。规则本身确定，新版本只需扩展此映射。
 */
export function requiredSettingsSchema(pack: ContentPackage): 1 | 2 {
  return pack.baseVersion === null ? SETTINGS_SCHEMA_V1 : SETTINGS_SCHEMA_V2;
}

export function defaultSettingsState(schema: 1 | 2): ReadingSettingsState {
  return schema === SETTINGS_SCHEMA_V1
    ? { schemaVersion: SETTINGS_SCHEMA_V1, values: { ...DEFAULT_SETTINGS_V1.values } }
    : { schemaVersion: SETTINGS_SCHEMA_V2, values: { ...DEFAULT_SETTINGS_V2.values } };
}

function isFontScale(value: unknown): value is FontScale {
  return value === 'standard' || value === 'large' || value === 'xlarge';
}

function isTheme(value: unknown): value is ThemeName {
  return value === 'system' || value === 'light' || value === 'dark' || value === 'contrast';
}

function isLineSpacing(value: unknown): value is LineSpacing {
  return value === 'standard' || value === 'loose';
}

function isLetterSpacing(value: unknown): value is LetterSpacing {
  return value === 'standard' || value === 'wide';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseSettingsV1Values(input: unknown): SettingsV1Values | null {
  if (!isRecord(input)) {
    return null;
  }
  const { fontScale, theme, lineSpacing } = input;
  if (!isFontScale(fontScale) || !isTheme(theme) || !isLineSpacing(lineSpacing)) {
    return null;
  }
  return { fontScale, theme, lineSpacing };
}

export function parseSettingsV2Values(input: unknown): SettingsV2Values | null {
  const v1 = parseSettingsV1Values(input);
  if (v1 === null || !isRecord(input) || !isLetterSpacing(input['letterSpacing'])) {
    return null;
  }
  return { ...v1, letterSpacing: input['letterSpacing'] };
}

/** 按目标 schema 校验一条（可能是原始的）设置状态记录。 */
export function parseSettingsState(input: unknown, schema: 1 | 2): ReadingSettingsState | null {
  if (!isRecord(input)) {
    return null;
  }
  if (input['schemaVersion'] !== schema) {
    return null;
  }
  if (schema === SETTINGS_SCHEMA_V1) {
    const values = parseSettingsV1Values(input['values']);
    return values === null ? null : { schemaVersion: SETTINGS_SCHEMA_V1, values };
  }
  const values = parseSettingsV2Values(input['values']);
  return values === null ? null : { schemaVersion: SETTINGS_SCHEMA_V2, values };
}

/** 任意 schema 校验（用于“最后一次可用设置”抢救）。 */
export function parseAnySettingsState(input: unknown): ReadingSettingsState | null {
  return parseSettingsState(input, SETTINGS_SCHEMA_V1) ?? parseSettingsState(input, SETTINGS_SCHEMA_V2);
}

/** schema 迁移：v1→v2 补默认值；v2→v1 丢弃新增字段（v1 兼容部分无损）。 */
export function migrateSettingsState(state: ReadingSettingsState, target: 1 | 2): ReadingSettingsState {
  if (state.schemaVersion === target) {
    return state;
  }
  if (target === SETTINGS_SCHEMA_V2) {
    return {
      schemaVersion: SETTINGS_SCHEMA_V2,
      values: { ...state.values, letterSpacing: 'standard' }
    };
  }
  return {
    schemaVersion: SETTINGS_SCHEMA_V1,
    values: {
      fontScale: state.values.fontScale,
      theme: state.values.theme,
      lineSpacing: state.values.lineSpacing
    }
  };
}
