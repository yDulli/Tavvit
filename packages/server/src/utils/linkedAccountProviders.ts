import { LINKED_ACCOUNT_PROVIDERS, type LinkedAccountProvider } from '@backspace/shared';
import { twitchAvailable } from './twitchApi.js';

/**
 * The services whose accounts people can link on this instance now: those its
 * operator set up (docs/systems/linked-accounts.md). Kept apart from the
 * linking itself (utils/linkedAccounts.ts), so the public instance info can
 * say it without loading the socket server.
 */
export function availableProviders(): LinkedAccountProvider[] {
  return LINKED_ACCOUNT_PROVIDERS.filter((provider) => {
    switch (provider) {
      case 'twitch': return twitchAvailable();
    }
  });
}
