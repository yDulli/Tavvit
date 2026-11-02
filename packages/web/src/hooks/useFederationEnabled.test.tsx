import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { InstanceInfoResponse } from '@backspace/shared';

const info = vi.hoisted(() => ({ value: null as Partial<InstanceInfoResponse> | null }));
vi.mock('./useHomeInstanceInfo', () => ({ useHomeInstanceInfo: () => info.value }));

import { useFederationEnabled } from './useFederationEnabled';

describe('useFederationEnabled', () => {
  it('is unknown until the instance has answered', () => {
    info.value = null;
    expect(renderHook(() => useFederationEnabled()).result.current).toBeNull();
  });

  it('is true when the instance says it federates', () => {
    info.value = { federationEnabled: true };
    expect(renderHook(() => useFederationEnabled()).result.current).toBe(true);
  });

  it('is false when the instance says it does not', () => {
    info.value = { federationEnabled: false };
    expect(renderHook(() => useFederationEnabled()).result.current).toBe(false);
  });

  it('treats a server that does not say as federating: an older one does', () => {
    info.value = {};
    expect(renderHook(() => useFederationEnabled()).result.current).toBe(true);
  });
});
