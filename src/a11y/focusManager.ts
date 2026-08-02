import { useEffect, useRef } from 'react';
import type { Route } from '../router/routes';

const focusHistory = new Map<string, string>();

function getRouteKey(route: Route): string {
  switch (route.name) {
    case 'topic':
      return `topic:${route.topicId}`;
    case 'article':
      return `article:${route.articleId}`;
    case 'search':
      return `search:${route.query}`;
    case 'settings':
      return 'settings';
    case 'home':
      return 'home';
    case 'notFound':
      return 'notFound';
  }
}

export function rememberFocus(route: Route, element: HTMLElement | null): void {
  if (element === null) return;
  const key = getRouteKey(route);
  const href = element.getAttribute('href');
  if (href !== null) {
    focusHistory.set(key, href);
  }
}

export function clearFocusHistory(): void {
  focusHistory.clear();
}

function findSavedElement(href: string): HTMLElement | null {
  const escaped = href.replace(/"/g, '\\"');
  const found = document.querySelector(`a[href="${escaped}"]`);
  return found instanceof HTMLElement ? found : null;
}

export function useFocusRestoration(
  route: Route,
  containerRef: React.RefObject<HTMLElement>,
): void {
  const previousRoute = useRef<Route | null>(null);

  useEffect(() => {
    const key = getRouteKey(route);
    const savedHref = focusHistory.get(key);

    let restored = false;
    if (previousRoute.current !== null && savedHref !== undefined) {
      const savedElement = findSavedElement(savedHref);
      if (savedElement !== null) {
        savedElement.focus();
        restored = true;
      }
    }
    if (!restored) {
      const heading = containerRef.current?.querySelector('h1');
      if (heading instanceof HTMLElement) {
        heading.focus();
      }
    }
    previousRoute.current = route;
  }, [route, containerRef]);
}
