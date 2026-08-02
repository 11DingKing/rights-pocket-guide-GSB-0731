import {
  defaultSettingsState,
  migrateSettingsState,
  parseAnySettingsState,
  parseSettingsState
} from '../core/settingsSchema';
import type { ReadingSettingsState } from '../core/settingsSchema';
import type { SettingsStore } from '../storage/settingsStore';

export type SettingsRecoverySource =
  | 'current'
  | 'backup'
  | 'migrated-current'
  | 'migrated-backup'
  | 'defaults';

export interface SettingsRecovery {
  state: ReadingSettingsState;
  source: SettingsRecoverySource;
}

/**
 * 读取并抢救阅读设置，优先级完全确定：
 * 目标 schema 的 current → 目标 schema 的 backup → 迁移 current →
 * 迁移 backup → 目标 schema 默认值。
 * repair 为 true 时把抢救结果写回 current（启动自愈；不触碰 backup）。
 */
export async function loadSettingsState(
  settingsStore: SettingsStore,
  requiredSchema: 1 | 2,
  options: { repair?: boolean } = {}
): Promise<SettingsRecovery> {
  const repair = options.repair ?? true;
  const raw = await settingsStore.readRaw();

  const currentExact = parseSettingsState(raw.current, requiredSchema);
  if (currentExact !== null) {
    return { state: currentExact, source: 'current' };
  }
  const backupExact = parseSettingsState(raw.backup, requiredSchema);
  if (backupExact !== null) {
    if (repair) {
      await settingsStore.repairCurrent(backupExact);
    }
    return { state: backupExact, source: 'backup' };
  }
  const currentAny = parseAnySettingsState(raw.current);
  if (currentAny !== null) {
    const migrated = migrateSettingsState(currentAny, requiredSchema);
    if (repair) {
      await settingsStore.repairCurrent(migrated);
    }
    return { state: migrated, source: 'migrated-current' };
  }
  const backupAny = parseAnySettingsState(raw.backup);
  if (backupAny !== null) {
    const migrated = migrateSettingsState(backupAny, requiredSchema);
    if (repair) {
      await settingsStore.repairCurrent(migrated);
    }
    return { state: migrated, source: 'migrated-backup' };
  }
  const defaults = defaultSettingsState(requiredSchema);
  if (repair) {
    await settingsStore.repairCurrent(defaults);
  }
  return { state: defaults, source: 'defaults' };
}
