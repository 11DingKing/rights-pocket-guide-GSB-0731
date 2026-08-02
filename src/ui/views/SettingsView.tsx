import type { Repository } from "../../services/repository";
import type { FontScale, LineSpacing, ThemeName } from "../../core/types";
import { useAnnouncer } from "../Announcer";
import { announcements } from "../announcements";
import { useHeadingFocus, useRepositorySnapshot } from "../hooks";

const FONT_OPTIONS: ReadonlyArray<{ value: FontScale; label: string }> = [
  { value: "standard", label: "标准" },
  { value: "large", label: "大" },
  { value: "xlarge", label: "特大" },
];

const THEME_OPTIONS: ReadonlyArray<{ value: ThemeName; label: string }> = [
  { value: "system", label: "跟随系统" },
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
  { value: "contrast", label: "高对比" },
];

const SPACING_OPTIONS: ReadonlyArray<{ value: LineSpacing; label: string }> = [
  { value: "standard", label: "标准" },
  { value: "loose", label: "宽松" },
];

/**
 * 阅读设置：原生 radio 组（方向键天然可切换），即时生效并持久化，
 * 跨内容版本保留。版本回滚也在此页。
 */
export function SettingsView({ repository }: { repository: Repository }) {
  const snapshot = useRepositorySnapshot(repository);
  const { announce } = useAnnouncer();
  const { headingRef } = useHeadingFocus("settings");
  const { settings } = snapshot;

  const apply = (patch: Partial<typeof settings>): void => {
    void repository.updateSettings(patch).then(() => {
      announce(announcements.settingsSaved);
    });
  };

  const onRollback = (): void => {
    void repository.rollback().then((version) => {
      if (version !== null) {
        announce(announcements.rolledBack(version));
      } else {
        announce(announcements.rollbackUnavailable, { assertive: true });
      }
    });
  };

  return (
    <section aria-labelledby="settings-heading">
      <h1 id="settings-heading" tabIndex={-1} ref={headingRef}>
        阅读设置
      </h1>

      <fieldset>
        <legend>字号</legend>
        {FONT_OPTIONS.map((option) => (
          <label key={option.value} className="radio-row">
            <input
              type="radio"
              name="font-scale"
              value={option.value}
              checked={settings.fontScale === option.value}
              onChange={() => apply({ fontScale: option.value })}
            />
            {option.label}
          </label>
        ))}
      </fieldset>

      <fieldset>
        <legend>主题</legend>
        {THEME_OPTIONS.map((option) => (
          <label key={option.value} className="radio-row">
            <input
              type="radio"
              name="theme"
              value={option.value}
              checked={settings.theme === option.value}
              onChange={() => apply({ theme: option.value })}
            />
            {option.label}
          </label>
        ))}
      </fieldset>

      <fieldset>
        <legend>行距</legend>
        {SPACING_OPTIONS.map((option) => (
          <label key={option.value} className="radio-row">
            <input
              type="radio"
              name="line-spacing"
              value={option.value}
              checked={settings.lineSpacing === option.value}
              onChange={() => apply({ lineSpacing: option.value })}
            />
            {option.label}
          </label>
        ))}
      </fieldset>

      <section aria-labelledby="version-heading">
        <h2 id="version-heading">内容版本</h2>
        <p>
          当前版本：{snapshot.packageVersion ?? "未知"}
          {snapshot.previousVersion !== null
            ? `；可回滚版本：${snapshot.previousVersion}`
            : ""}
        </p>
        <button
          type="button"
          onClick={onRollback}
          disabled={snapshot.previousVersion === null}
        >
          回滚到上一版本
        </button>
      </section>
    </section>
  );
}
