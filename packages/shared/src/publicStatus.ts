/**
 * `GET /api/status`, for the public page at `/status` (docs/systems/operations.md, "Status page").
 * Whether each part runs, and nothing about how: no counts, versions or addresses.
 */
export type ServiceState = 'ok' | 'down' | 'off';

export const PUBLIC_SERVICES = ['chat', 'uploads', 'voice', 'mail'] as const;
export type PublicService = (typeof PUBLIC_SERVICES)[number];

/** What the operator says about a problem, from an announcement marked for this page. */
export interface StatusNote {
  id: string;
  tone: 'info' | 'warning';
  body: string;
  createdAt: number;
  /** When it ended; null while it goes on. */
  endedAt: number | null;
}

export interface PublicStatus {
  checkedAt: number;
  services: Record<PublicService, ServiceState>;
  notes: StatusNote[];
}
