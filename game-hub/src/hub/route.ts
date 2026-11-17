import { useEffect, useState } from 'react';

/**
 * The hub is a static site, so the current screen lives in the URL's hash:
 *   #/                 the home screen
 *   #/play/crater-lab  a game
 * That keeps the browser's back button and page reloads working on any static host with no rewrites.
 */
export type Route = { screen: 'home' } | { screen: 'play'; gameId: string; params: URLSearchParams };

export function parseRoute(hash: string): Route {
  const [path = '', query = ''] = hash.replace(/^#/, '').split('?');
  const match = /^\/play\/([a-z0-9-]+)\/?$/.exec(path);
  if (match?.[1]) return { screen: 'play', gameId: match[1], params: new URLSearchParams(query) };
  return { screen: 'home' };
}

export function gameHref(gameId: string): string {
  return `#/play/${gameId}`;
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function goHome(): void {
  window.location.hash = '#/';
}
