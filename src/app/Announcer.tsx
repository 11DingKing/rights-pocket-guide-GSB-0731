import { createContext, useCallback, useContext, useRef, useState } from 'react';
import type { ReactNode } from 'react';

/**
 * Screen-reader announcements via an ARIA live region. Views call `announce`
 * for events that have no visible focus change (search result counts, update
 * outcome, migration notices). The live region is polite and visually hidden
 * but present in the accessibility tree.
 */
interface AnnouncerApi {
  announce: (message: string) => void;
}

const AnnouncerContext = createContext<AnnouncerApi | undefined>(undefined);

export function AnnouncerProvider({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  const [message, setMessage] = useState('');
  const timer = useRef<number | undefined>(undefined);

  const announce = useCallback((next: string): void => {
    // Clear then set so identical consecutive messages are still announced.
    setMessage('');
    if (timer.current !== undefined) {
      window.clearTimeout(timer.current);
    }
    timer.current = window.setTimeout(() => {
      setMessage(next);
    }, 30);
  }, []);

  return (
    <AnnouncerContext.Provider value={{ announce }}>
      {children}
      <div
        data-testid="live-region"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="visually-hidden"
      >
        {message}
      </div>
    </AnnouncerContext.Provider>
  );
}

export function useAnnouncer(): AnnouncerApi {
  const ctx = useContext(AnnouncerContext);
  if (ctx === undefined) {
    throw new Error('useAnnouncer must be used within AnnouncerProvider');
  }
  return ctx;
}
