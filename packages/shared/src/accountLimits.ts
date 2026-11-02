/**
 * What one account may take up on an instance (docs/systems/uploads.md, "Limits per
 * account"). The operator sets both figures in the admin console; 0 means no limit.
 */
export const ACCOUNT_LIMITS = {
  /** What an account may keep in files until the operator says otherwise. */
  DEFAULT_STORAGE_BYTES: 5 * 1024 ** 3,
  /** How many spaces an account may own until the operator says otherwise. */
  DEFAULT_SPACES: 25,
  /** The highest figures the console takes. */
  MAX_STORAGE_GB: 1024 * 1024,
  MAX_SPACES: 100_000,
} as const;

const BYTES_PER_GB = 1024 ** 3;

/** `GET /api/users/@me/storage`. */
export interface StorageUsage {
  usedBytes: number;
  /** Null when no limit applies to this account. */
  limitBytes: number | null;
}

/** A figure in GB as bytes, or null when it is no figure the console takes. 0 stays 0: no limit. */
export function storageGbToBytes(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value < 0 || value > ACCOUNT_LIMITS.MAX_STORAGE_GB) return null;
  return Math.round(value * BYTES_PER_GB);
}

/** Bytes as a figure in GB for a field to show. A small limit must not read as 0, which means none. */
export function storageBytesToGb(bytes: number): number {
  return Number((bytes / BYTES_PER_GB).toPrecision(6));
}
