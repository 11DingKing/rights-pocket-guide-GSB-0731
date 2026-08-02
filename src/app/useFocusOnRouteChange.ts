import { useEffect, useRef } from 'react';

/**
 * Move focus to the referenced element whenever `key` changes (i.e. on each
 * route change). This gives keyboard and screen-reader users a predictable
 * landing point — the view's <h1> — instead of leaving focus on whatever
 * link was activated. The heading is programmatically focusable via tabIndex
 * {-1} so it never joins the tab order but can still receive focus.
 */
export function useFocusOnRouteChange<T extends HTMLElement>(
  key: string,
): React.RefObject<T> {
  const ref = useRef<T>(null);
  useEffect(() => {
    const node = ref.current;
    if (node !== null) {
      node.focus();
    }
  }, [key]);
  return ref;
}
