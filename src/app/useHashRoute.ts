import { useCallback, useEffect, useState } from 'react';
import { parseHash, toHash, type Route } from './hashRoute';

/** Subscribe to the URL hash and expose the parsed route + a navigate helper. */
export function useHashRoute(): {
  route: Route;
  navigate: (route: Route) => void;
} {
  const [route, setRoute] = useState<Route>(() =>
    parseHash(typeof window === 'undefined' ? '' : window.location.hash),
  );

  useEffect(() => {
    const onChange = (): void => {
      setRoute(parseHash(window.location.hash));
    };
    window.addEventListener('hashchange', onChange);
    return () => {
      window.removeEventListener('hashchange', onChange);
    };
  }, []);

  const navigate = useCallback((next: Route): void => {
    const nextHash = toHash(next);
    if (window.location.hash !== nextHash) {
      window.location.hash = nextHash;
    } else {
      // Same hash: force a re-render for e.g. re-submitting a search.
      setRoute(parseHash(nextHash));
    }
  }, []);

  return { route, navigate };
}
