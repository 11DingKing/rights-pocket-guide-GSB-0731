import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface IconButtonProps
  extends Pick<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'disabled' | 'type' | 'aria-expanded'> {
  label: string;
  children: ReactNode;
  className?: string;
}

export function IconButton({
  label,
  children,
  onClick,
  disabled,
  type = 'button',
  className,
  'aria-expanded': ariaExpanded,
}: IconButtonProps) {
  return (
    <button
      type={type}
      className={className}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-expanded={ariaExpanded}
      title={label}
    >
      {children}
      <span className="sr-only">{label}</span>
    </button>
  );
}
