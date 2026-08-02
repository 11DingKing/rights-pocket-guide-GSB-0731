import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

export interface AnnounceOptions {
  assertive?: boolean;
}

export interface Announcer {
  announce: (text: string, options?: AnnounceOptions) => void;
}

const AnnouncerContext = createContext<Announcer>({
  announce: () => undefined,
});

export function useAnnouncer(): Announcer {
  return useContext(AnnouncerContext);
}

interface LiveMessage {
  id: number;
  text: string;
}

/** 双通道 live region：polite 用于一般状态，assertive 用于失败与撤下跳转。 */
export function AnnouncerProvider({ children }: { children: ReactNode }) {
  const [polite, setPolite] = useState<LiveMessage | null>(null);
  const [assertive, setAssertive] = useState<LiveMessage | null>(null);
  const counterRef = useRef(0);

  const announce = useCallback((text: string, options?: AnnounceOptions) => {
    counterRef.current += 1;
    const message: LiveMessage = { id: counterRef.current, text };
    if (options?.assertive === true) {
      setAssertive(message);
    } else {
      setPolite(message);
    }
  }, []);

  const value = useMemo<Announcer>(() => ({ announce }), [announce]);

  return (
    <AnnouncerContext.Provider value={value}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="visually-hidden"
        data-testid="live-polite"
        data-message-id={polite?.id ?? 0}
      >
        {polite?.text ?? ""}
      </div>
      <div
        role="alert"
        aria-live="assertive"
        className="visually-hidden"
        data-testid="live-assertive"
        data-message-id={assertive?.id ?? 0}
      >
        {assertive?.text ?? ""}
      </div>
    </AnnouncerContext.Provider>
  );
}
