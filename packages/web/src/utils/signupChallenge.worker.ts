import { findNonce } from './signupChallenge';

// Solves the task at sign-up apart from the page (utils/signupChallenge.ts).
self.onmessage = (event: MessageEvent<{ salt: string; bits: number }>) => {
  void findNonce(event.data.salt, event.data.bits).then((nonce) => self.postMessage(nonce));
};
