/**
 * Hash-based deep-link routing. No router library. Routes are encoded in the
 * URL hash so links work offline from `file://` or any static host.
 *
 *   #/                     home (topic list)
 *   #/topic/TOPIC-AID      a topic
 *   #/article/ART-AID-1    an article (withdrawn ids migrate on load)
 *   #/search?q=...          search results
 *   #/settings              reading settings
 */
export type Route =
  | { readonly name: 'home' }
  | { readonly name: 'topic'; readonly topicId: string }
  | { readonly name: 'article'; readonly articleId: string }
  | { readonly name: 'search'; readonly query: string }
  | { readonly name: 'settings' };

export function parseHash(hash: string): Route {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const [path, queryString = ''] = raw.split('?');
  const segments = (path ?? '').split('/').filter((s) => s.length > 0);

  if (segments.length === 0) {
    return { name: 'home' };
  }
  const [head, param] = segments;
  switch (head) {
    case 'topic':
      return param !== undefined
        ? { name: 'topic', topicId: param }
        : { name: 'home' };
    case 'article':
      return param !== undefined
        ? { name: 'article', articleId: param }
        : { name: 'home' };
    case 'search': {
      const params = new URLSearchParams(queryString);
      return { name: 'search', query: params.get('q') ?? '' };
    }
    case 'settings':
      return { name: 'settings' };
    default:
      return { name: 'home' };
  }
}

export function toHash(route: Route): string {
  switch (route.name) {
    case 'home':
      return '#/';
    case 'topic':
      return `#/topic/${encodeURIComponent(route.topicId)}`;
    case 'article':
      return `#/article/${encodeURIComponent(route.articleId)}`;
    case 'search':
      return `#/search?q=${encodeURIComponent(route.query)}`;
    case 'settings':
      return '#/settings';
    default: {
      const never: never = route;
      return String(never);
    }
  }
}
