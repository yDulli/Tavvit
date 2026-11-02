/**
 * Whether a space is listed in Discovery (docs/systems/admin.md, "Discovery
 * approval"): open to join (public or by request) and approved by an
 * instance admin. The Explore page, the directory document and the admin
 * overview read this one predicate over `spaces s`; nothing an owner sets
 * alone satisfies it.
 */
export const LISTED_IN_DISCOVERY_SQL = `s.visibility IN ('public', 'request') AND s.discovery_status = 'approved'`;
