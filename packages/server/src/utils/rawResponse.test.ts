import { describe, expect, it, vi } from 'vitest';
import { endRawResponse } from './rawResponse.js';

// A hijacked reply (the tus uploads) is not behind Fastify's error handling: when its handler
// fails, this ends the response, and must itself never fail.

const response = (state: { headersSent: boolean; writableEnded: boolean }) => ({ ...state, statusCode: 200, end: vi.fn(), destroy: vi.fn() });

describe('ending a raw response that failed', () => {
  it('answers 500 when nothing was sent yet', () => {
    const fresh = response({ headersSent: false, writableEnded: false });
    endRawResponse(fresh);
    expect(fresh.statusCode).toBe(500);
    expect(fresh.end).toHaveBeenCalledOnce();
    expect(fresh.destroy).not.toHaveBeenCalled();
  });

  it('drops the connection when an answer had begun', () => {
    const begun = response({ headersSent: true, writableEnded: false });
    endRawResponse(begun);
    expect(begun.destroy).toHaveBeenCalledOnce();
    expect(begun.end).not.toHaveBeenCalled();
    expect(begun.statusCode).toBe(200);
  });

  it('leaves a finished answer alone, and never throws', () => {
    const done = response({ headersSent: true, writableEnded: true });
    endRawResponse(done);
    expect(done.destroy).not.toHaveBeenCalled();
    const broken = { headersSent: false, writableEnded: false, statusCode: 200, end: () => { throw new Error('socket gone'); }, destroy: vi.fn() };
    expect(() => endRawResponse(broken)).not.toThrow();
  });
});
