import { useFocusOnRouteChange } from '../app/useFocusOnRouteChange';
import type { SettingsStatus } from '../app/useReadingSettings';
import type { ReadingSettings } from '../core/types';
import { StatusBadge } from './controls';

/**
 * Reading settings: font scale, contrast, line spacing, and (schema 2 only)
 * link underlining. Each control is a labelled fieldset of radios so it is
 * fully keyboard operable and announced with its current value. Changes persist
 * immediately (via the repository).
 *
 * `status` conveys degraded states with text + icon (never colour alone):
 *  - `invalid`: a stored preference was invalid and reverted to a safe value;
 *  - `quota`: the last change could not be saved (storage full) but still
 *    applies; the last successfully saved settings are intact.
 */
export function SettingsView({
  settings,
  update,
  status,
  schemaVersion,
}: {
  settings: ReadingSettings;
  update: (next: Partial<ReadingSettings>) => void;
  status: SettingsStatus;
  schemaVersion: number;
}): JSX.Element {
  const headingRef = useFocusOnRouteChange<HTMLHeadingElement>('settings');
  return (
    <section aria-labelledby="settings-heading">
      <h1 id="settings-heading" tabIndex={-1} ref={headingRef}>
        阅读设置
      </h1>

      {status !== 'ok' ? (
        <p className="settings-status">
          <StatusBadge tone="warn" glyph="!">
            {status === 'invalid'
              ? '检测到无效的阅读偏好，已恢复到上次可用的设置。'
              : '存储空间不足，最新更改暂未保存，但已应用；上次保存的设置仍然有效。'}
          </StatusBadge>
        </p>
      ) : null}

      <fieldset>
        <legend>字号</legend>
        {(['normal', 'large', 'xlarge'] as const).map((value) => (
          <label key={value} className="radio-row">
            <input
              type="radio"
              name="fontScale"
              value={value}
              checked={settings.fontScale === value}
              onChange={() => {
                update({ fontScale: value });
              }}
            />
            {value === 'normal' ? '标准' : value === 'large' ? '大' : '特大'}
          </label>
        ))}
      </fieldset>

      <fieldset>
        <legend>对比度</legend>
        {(['normal', 'high'] as const).map((value) => (
          <label key={value} className="radio-row">
            <input
              type="radio"
              name="contrast"
              value={value}
              checked={settings.contrast === value}
              onChange={() => {
                update({ contrast: value });
              }}
            />
            {value === 'normal' ? '标准对比度' : '高对比度'}
          </label>
        ))}
      </fieldset>

      <fieldset>
        <legend>行距</legend>
        {(['normal', 'loose'] as const).map((value) => (
          <label key={value} className="radio-row">
            <input
              type="radio"
              name="lineSpacing"
              value={value}
              checked={settings.lineSpacing === value}
              onChange={() => {
                update({ lineSpacing: value });
              }}
            />
            {value === 'normal' ? '标准行距' : '宽松行距'}
          </label>
        ))}
      </fieldset>

      {schemaVersion >= 2 ? (
        <fieldset>
          <legend>链接下划线</legend>
          {(['on', 'off'] as const).map((value) => (
            <label key={value} className="radio-row">
              <input
                type="radio"
                name="underlineLinks"
                value={value}
                checked={settings.underlineLinks === value}
                onChange={() => {
                  update({ underlineLinks: value });
                }}
              />
              {value === 'on' ? '始终显示下划线' : '不显示下划线'}
            </label>
          ))}
        </fieldset>
      ) : null}
    </section>
  );
}
