import type { AuthResponse, LoginRequest } from '@backspace/shared';
import { describeError } from '../i18n/errors';
import { useMfaPromptStore } from '../stores/mfaPromptStore';
import { HttpError, type BackspaceApiClient } from './client';

/**
 * A password sign-in on another instance, where the account may have 2FA on. The one dialog
 * asks for the code, so nobody calling this has to know. Cancelling it fails the sign-in.
 */
export async function loginWithSecondFactor(client: Pick<BackspaceApiClient, 'auth'>, origin: string, data: LoginRequest): Promise<AuthResponse> {
  try {
    return await client.auth.login(data);
  } catch (err) {
    if (!(err instanceof HttpError) || err.code !== 'mfa_required') throw err;
    const ticket = (err.body as { ticket?: unknown } | undefined)?.ticket;
    if (typeof ticket !== 'string') throw err;
    let problem: string | null = null;
    for (;;) {
      const code = await useMfaPromptStore.getState().ask(origin, problem);
      try {
        return await client.auth.loginSecondFactor({ ticket, code });
      } catch (retry) {
        if (!(retry instanceof HttpError) || retry.code !== 'mfa_code_invalid') throw retry;
        problem = describeError(retry);
      }
    }
  }
}
