import { useCallback, useEffect, useState } from 'react';
import type { ReadingSettings } from '../core/types';
import { DEFAULT_READING_SETTINGS } from '../core/types';
import type { ContentRepository } from '../services/repository';

/**
 * Status of the reading-settings subsystem, surfaced to the UI so degraded
 * states are conveyed accessibly (text + icon, never colour alone):
 *  - `ok`: settings loaded and persist normally;
 *  - `invalid`: the persisted value was invalid and was reverted to the last
 *    usable / default value (nothing was lost silently);
 *  - `quota`: a save failed because IndexedDB is out of space; the in-memory
 *    settings still apply and the last successfully persisted value is intact.
 */
export type SettingsStatus = 'ok' | 'invalid' | 'quota';

export function useReadingSettings(repository: ContentRepository): {
  settings: ReadingSettings;
  update: (next: Partial<ReadingSettings>) => void;
  ready: boolean;
  status: SettingsStatus;
} {
  const [settings, setSettings] = useState<ReadingSettings>(
    DEFAULT_READING_SETTINGS,
  );
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<SettingsStatus>('ok');

  useEffect(() => {
    let cancelled = false;
    void repository.loadSettings().then((loaded) => {
      if (!cancelled) {
        setSettings(loaded.settings);
        setStatus(loaded.valid ? 'ok' : 'invalid');
        setReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [repository]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset['fontScale'] = settings.fontScale;
    root.dataset['contrast'] = settings.contrast;
    root.dataset['lineSpacing'] = settings.lineSpacing;
    root.dataset['underlineLinks'] = settings.underlineLinks;
  }, [settings]);

  const update = useCallback(
    (next: Partial<ReadingSettings>): void => {
      setSettings((current) => {
        const merged: ReadingSettings = { ...current, ...next };
        // Apply optimistically (in memory) so the user is never left without a
        // usable configuration, then attempt to persist. A quota failure keeps
        // the applied value and the last persisted value both intact, and marks
        // the status so the UI can explain the degraded state.
        repository.saveSettings(merged).then(
          () => {
            setStatus('ok');
          },
          () => {
            setStatus('quota');
          },
        );
        return merged;
      });
    },
    [repository],
  );

  return { settings, update, ready, status };
}
