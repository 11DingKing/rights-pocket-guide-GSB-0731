import { useCallback, useEffect, useState } from 'react';
import type { ReadingSettings } from '../core/types';
import { DEFAULT_READING_SETTINGS } from '../core/types';
import type { ContentRepository } from '../services/repository';

/**
 * Reading settings state. Loads persisted settings from the repository (which
 * reads IndexedDB for us — the view never touches IndexedDB), applies them to
 * the document root as data attributes (CSS keys off these), and persists
 * changes. Settings survive package switches because they live in a separate
 * `meta` record, not inside any package.
 */
export function useReadingSettings(repository: ContentRepository): {
  settings: ReadingSettings;
  update: (next: Partial<ReadingSettings>) => void;
  ready: boolean;
} {
  const [settings, setSettings] = useState<ReadingSettings>(
    DEFAULT_READING_SETTINGS,
  );
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void repository.getSettings().then((loaded) => {
      if (!cancelled) {
        setSettings(loaded);
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
  }, [settings]);

  const update = useCallback(
    (next: Partial<ReadingSettings>): void => {
      setSettings((current) => {
        const merged: ReadingSettings = { ...current, ...next };
        void repository.saveSettings(merged);
        return merged;
      });
    },
    [repository],
  );

  return { settings, update, ready };
}
