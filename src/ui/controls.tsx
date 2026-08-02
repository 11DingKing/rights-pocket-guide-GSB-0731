import type { ReactNode } from 'react';

/**
 * Icon button with a mandatory accessible name. `label` becomes the accessible
 * name via aria-label; the icon glyph is presentational (aria-hidden). This is
 * the only sanctioned way to render an icon-only control so no icon button can
 * ship without a name.
 */
export function IconButton({
  label,
  glyph,
  onClick,
  pressed,
}: {
  label: string;
  glyph: string;
  onClick: () => void;
  pressed?: boolean;
}): JSX.Element {
  return (
    <button
      type="button"
      className="icon-button"
      aria-label={label}
      title={label}
      {...(pressed === undefined ? {} : { 'aria-pressed': pressed })}
      onClick={onClick}
    >
      <span aria-hidden="true">{glyph}</span>
    </button>
  );
}

/**
 * A status badge that conveys state through BOTH a text label and an icon
 * glyph, never colour alone. Colour is layered on top via the `tone` class as
 * a redundant cue.
 */
export function StatusBadge({
  tone,
  glyph,
  children,
}: {
  tone: 'ok' | 'warn' | 'info';
  glyph: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <span className={`status-badge status-${tone}`} role="status">
      <span aria-hidden="true" className="status-glyph">
        {glyph}
      </span>
      <span className="status-text">{children}</span>
    </span>
  );
}
