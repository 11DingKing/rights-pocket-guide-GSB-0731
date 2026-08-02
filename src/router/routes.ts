export type Route =
  | { name: 'home' }
  | { name: 'topic'; topicId: string }
  | { name: 'article'; articleId: string }
  | { name: 'search'; query: string }
  | { name: 'settings' }
  | { name: 'notFound' };

export function parseHash(hash: string): Route {
  const clean = hash.startsWith('#') ? hash.slice(1) : hash;
  const [path, queryString] = clean.split('?');
  const segments = (path ?? '').split('/').filter((s) => s.length > 0);
  if (segments.length === 0) return { name: 'home' };

  const params = new URLSearchParams(queryString ?? '');

  switch (segments[0]) {
    case 'topic':
      return segments[1] ? { name: 'topic', topicId: segments[1] } : { name: 'notFound' };
    case 'article':
      return segments[1]
        ? { name: 'article', articleId: segments[1] }
        : { name: 'notFound' };
    case 'search':
      return { name: 'search', query: params.get('q') ?? '' };
    case 'settings':
      return { name: 'settings' };
    default:
      return { name: 'notFound' };
  }
}

export function routeToHash(route: Route): string {
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
    case 'notFound':
      return '#/not-found';
  }
}

export function navigate(route: Route): void {
  window.location.hash = routeToHash(route);
}

export function replaceHash(route: Route): void {
  const target = routeToHash(route).slice(1);
  window.location.replace(`#${target}`);
}
