/**
 * Where "Suggest a game" points. Change this when the folder moves to its own repository.
 * The issue form it opens is .github/ISSUE_TEMPLATE/game-suggestion.yml.
 */
export const REPO_URL = 'https://github.com/nassertarynix/ask-my-docs';
export const SUGGEST_URL = `${REPO_URL}/issues/new?template=game-suggestion.yml`;

/**
 * Where the online-games relay lives (see relay/README.md), e.g. 'wss://paper-arcade-relay.example.workers.dev'.
 * Empty until it is deployed: online play then says it is not switched on, and solo play against computers still works.
 */
export const RELAY_URL = '';

/** The relay address to use. A `?relay=` address in the page link is honoured for localhost only (for development and tests). */
export function relayUrl(params: URLSearchParams): string {
  const override = params.get('relay');
  if (override && /^wss?:\/\/(127\.0\.0\.1|localhost)(:\d{1,5})?\/?$/.test(override)) return override.replace(/\/$/, '');
  return RELAY_URL;
}
