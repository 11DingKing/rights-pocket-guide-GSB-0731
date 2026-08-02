import { useFocusOnRouteChange } from '../app/useFocusOnRouteChange';
import type { ReadingSettings } from '../core/types';

/**
 * Reading settings: font scale, contrast, and line spacing. Each control is a
 * labelled fieldset of radios so it is fully keyboard operable and announced
 * with its current value. Changes persist immediately (via the repository).
 */
export function SettingsView({
  settings,
  update,
}: {
  settings: ReadingSettings;
  update: (next: Partial<ReadingSettings>) => void;
}): JSX.Element {
  const headingRef = useFocusOnRouteChange<HTMLHeadingElement>('settings');
  return (
    <section aria-labelledby="settings-heading">
      <h1 id="settings-heading" tabIndex={-1} ref={headingRef}>
        阅读设置
      </h1>

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
    </section>
  );
}
