import type { ReadingSettings } from '../types';

interface SettingsViewProps {
  settings: ReadingSettings;
  onChange: (settings: ReadingSettings) => void;
}

const FONT_SIZES: ReadonlyArray<{ value: ReadingSettings['fontSize']; label: string }> = [
  { value: 'small', label: '较小' },
  { value: 'medium', label: '适中' },
  { value: 'large', label: '较大' },
  { value: 'xlarge', label: '特大' },
];

const THEMES: ReadonlyArray<{ value: ReadingSettings['theme']; label: string }> = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'high-contrast', label: '高对比' },
];

const LINE_SPACINGS: ReadonlyArray<{
  value: ReadingSettings['lineSpacing'];
  label: string;
}> = [
  { value: 'compact', label: '紧凑' },
  { value: 'normal', label: '适中' },
  { value: 'spacious', label: '宽松' },
];

export function SettingsView({ settings, onChange }: SettingsViewProps) {
  return (
    <section className="settings-view" aria-labelledby="settings-heading">
      <h1 id="settings-heading" tabIndex={-1} className="view-heading">
        阅读设置
      </h1>

      <fieldset className="settings-group">
        <legend>字号</legend>
        <div role="radiogroup" aria-label="字号" className="radio-row">
          {FONT_SIZES.map((option) => (
            <label key={option.value} className="radio-option">
              <input
                type="radio"
                name="fontSize"
                value={option.value}
                checked={settings.fontSize === option.value}
                onChange={() => onChange({ ...settings, fontSize: option.value })}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="settings-group">
        <legend>主题</legend>
        <div role="radiogroup" aria-label="主题" className="radio-row">
          {THEMES.map((option) => (
            <label key={option.value} className="radio-option">
              <input
                type="radio"
                name="theme"
                value={option.value}
                checked={settings.theme === option.value}
                onChange={() => onChange({ ...settings, theme: option.value })}
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="settings-group">
        <legend>行距</legend>
        <div role="radiogroup" aria-label="行距" className="radio-row">
          {LINE_SPACINGS.map((option) => (
            <label key={option.value} className="radio-option">
              <input
                type="radio"
                name="lineSpacing"
                value={option.value}
                checked={settings.lineSpacing === option.value}
                onChange={() =>
                  onChange({ ...settings, lineSpacing: option.value })
                }
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <p className="settings-hint">设置会自动保存，并在版本更新后保留。</p>
    </section>
  );
}
