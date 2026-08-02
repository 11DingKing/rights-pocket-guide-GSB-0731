interface IconProps {
  className?: string;
}

export function SearchIcon({ className }: IconProps) {
  return (
    <svg aria-hidden="true" focusable="false" className={className} width="20" height="20" viewBox="0 0 20 20">
      <path
        fill="currentColor"
        d="M8.5 3a5.5 5.5 0 1 0 3.47 9.76l3.64 3.63a1 1 0 0 0 1.41-1.41l-3.63-3.64A5.5 5.5 0 0 0 8.5 3Zm0 2a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Z"
      />
    </svg>
  );
}

export function SettingsIcon({ className }: IconProps) {
  return (
    <svg aria-hidden="true" focusable="false" className={className} width="20" height="20" viewBox="0 0 20 20">
      <path
        fill="currentColor"
        d="M10 6.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Zm0 2a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z"
      />
      <path
        fill="currentColor"
        d="M8.2 2.5a1.5 1.5 0 0 1 2.6 0l.32.56a1.5 1.5 0 0 0 1.64.6l.62-.18a1.5 1.5 0 0 1 1.84 1.84l-.18.62a1.5 1.5 0 0 0 .6 1.64l.56.32a1.5 1.5 0 0 1 0 2.6l-.56.32a1.5 1.5 0 0 0-.6 1.64l.18.62a1.5 1.5 0 0 1-1.84 1.84l-.62-.18a1.5 1.5 0 0 0-1.64.6l-.32.56a1.5 1.5 0 0 1-2.6 0l-.32-.56a1.5 1.5 0 0 0-1.64-.6l-.62.18a1.5 1.5 0 0 1-1.84-1.84l.18-.62a1.5 1.5 0 0 0-.6-1.64l-.56-.32a1.5 1.5 0 0 1 0-2.6l.56-.32a1.5 1.5 0 0 0 .6-1.64l-.18-.62a1.5 1.5 0 0 1 1.84-1.84l.62.18a1.5 1.5 0 0 0 1.64-.6l.32-.56Z"
      />
    </svg>
  );
}

export function RefreshIcon({ className }: IconProps) {
  return (
    <svg aria-hidden="true" focusable="false" className={className} width="20" height="20" viewBox="0 0 20 20">
      <path
        fill="currentColor"
        d="M10 4a6 6 0 0 0-5.2 3H3a1 1 0 0 0-.9 1.45l2 4A1 1 0 0 0 6 12l2-4a1 1 0 0 0-.9-1.55H5.5A4 4 0 1 1 6 14a1 1 0 1 0-1.4 1.4A6 6 0 1 0 10 4Z"
      />
    </svg>
  );
}

export function HomeIcon({ className }: IconProps) {
  return (
    <svg aria-hidden="true" focusable="false" className={className} width="20" height="20" viewBox="0 0 20 20">
      <path
        fill="currentColor"
        d="M10 2.5 2 9v8a1 1 0 0 0 1 1h4v-5h6v5h4a1 1 0 0 0 1-1V9l-8-6.5Z"
      />
    </svg>
  );
}

export function BackIcon({ className }: IconProps) {
  return (
    <svg aria-hidden="true" focusable="false" className={className} width="20" height="20" viewBox="0 0 20 20">
      <path
        fill="currentColor"
        d="M12.7 4.3a1 1 0 0 1 0 1.4L8.4 10l4.3 4.3a1 1 0 0 1-1.4 1.4l-5-5a1 1 0 0 1 0-1.4l5-5a1 1 0 0 1 1.4 0Z"
      />
    </svg>
  );
}

export function LegalIcon({ className }: IconProps) {
  return (
    <svg aria-hidden="true" focusable="false" className={className} width="18" height="18" viewBox="0 0 20 20">
      <path
        fill="currentColor"
        d="M10 2 2 5v2h16V5l-8-3ZM4 9v6H2v2h16v-2h-2V9h-2v6h-2V9h-2v6H8V9H6v6H4V9H4Z"
      />
    </svg>
  );
}
