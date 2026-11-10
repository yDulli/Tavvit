/** The parts of a raw HTTP response that ending it needs. */
export interface EndableResponse {
  headersSent: boolean;
  writableEnded: boolean;
  statusCode: number;
  end: () => unknown;
  destroy: () => unknown;
}

/**
 * Ends a raw response whose handler failed outside Fastify (a hijacked reply, routes/files.ts):
 * a 500 when nothing was sent yet, else the connection, since half an answer cannot be taken
 * back. Never throws: it runs where a failure is already being handled.
 */
export function endRawResponse(response: EndableResponse): void {
  try {
    if (response.writableEnded) return;
    if (response.headersSent) {
      response.destroy();
      return;
    }
    response.statusCode = 500;
    response.end();
  } catch {
    // The connection is gone already.
  }
}
