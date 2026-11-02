import { hasLeadingZeroBits, type SignupChallengeResponse, type SignupChallengeSolution } from '@backspace/shared/src/signupChallenge';

/** The work itself: the nonce whose hash starts with enough zero bits. */
export async function findNonce(salt: string, bits: number): Promise<string> {
  const encoder = new TextEncoder();
  for (let nonce = 0; ; nonce += 1) {
    const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`${salt}:${nonce}`));
    if (hasLeadingZeroBits(new Uint8Array(digest), bits)) return String(nonce);
  }
}

/** On a worker where there is one, so the page stays alive while it counts. */
function solveAside(salt: string, bits: number): Promise<string> {
  if (typeof Worker === 'undefined') return findNonce(salt, bits);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./signupChallenge.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<string>) => {
      resolve(event.data);
      worker.terminate();
    };
    worker.onerror = () => {
      worker.terminate();
      // A worker that did not start (a strict setup) leaves the page to do it.
      findNonce(salt, bits).then(resolve, reject);
    };
    worker.postMessage({ salt, bits });
  });
}

/**
 * The answer to what this instance asks of a new account, or nothing when it asks nothing.
 * An instance from before this answers 404 to the question: that is nothing too. Without
 * `crypto.subtle` (a page not on https) there is no answer, and the server says so.
 */
export async function solveSignupChallenge(
  ask: () => Promise<SignupChallengeResponse>,
): Promise<SignupChallengeSolution | undefined> {
  let task: SignupChallengeResponse;
  try {
    task = await ask();
  } catch {
    return undefined;
  }
  if (task.level === 'off' || !globalThis.crypto?.subtle) return undefined;
  const nonce = await solveAside(task.salt, task.bits);
  return { salt: task.salt, bits: task.bits, signature: task.signature, nonce };
}
