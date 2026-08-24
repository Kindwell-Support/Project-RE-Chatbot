/**
 * Chat ownership resolution — THE single seam (Phase 1 ruling R3), now in its
 * PHASE 3 SHAPE: the note that sat here since Phase 1 is finally the code.
 *
 * The client no longer asserts an owner on production paths. Identity is the
 * HMAC-signed session token (minted by POST /auth after GHL verification,
 * carried as `Authorization: Bearer`); this function verifies it and returns
 * `email:<verified>`. Forgery requires the signing key, not a guessed string.
 * The token lives in sessionStorage — deliberately not a cookie (the widget
 * is third-party to the API origin; cookie blocking would break it) — so it
 * survives refresh and dies on tab close.
 *
 * `device:<uuid>` via x-james-owner survives as the LOCAL/DEV FALLBACK ONLY,
 * gated on `allowDeviceFallback` which callers derive from
 * `!config.isProduction` — NODE_ENV alone, no dedicated flag production could
 * flip (a dev path reachable in production by configuration is a gate with a
 * bypass; reaching ours means redefining the deployment as non-production).
 *
 * SUPERSEDED and deleted from the old note, so nobody builds it: the planned
 * in-place rewrite of stored `device:` keys to `email:` keys. The Phase 3
 * brief rules owner_key is `email:<verified>` FROM THE FIRST WRITE — the
 * chats table is empty, so chats follow the member across devices by
 * construction. No migration, no claim step.
 *
 * WHY HEADERS AND NOT QUERY PARAMS, unchanged from Phase 1: credentials in
 * query strings land in access logs, proxy logs and Referer headers.
 */

import { verifyToken } from './sessionToken.js';

/** Thrown when a request carries no usable owner key. Handlers map this to 400. */
export class OwnerKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OwnerKeyError';
  }
}

export const OWNER_KEY_HEADER = 'x-james-owner';

/**
 * Phase 1 accepts EXACTLY ONE shape: `device:<uuid>`, generated client-side
 * and persisted in localStorage under 'james-bot-device'.
 *
 * The narrowness is a Phase 3 defence, not tidiness. If arbitrary owner keys
 * were accepted, anyone could create chats under `email:victim@example.com`
 * TODAY; when Phase 3 rewrites that member's key to exactly that value on
 * their first verified login, the attacker's planted chats would appear in
 * the victim's sidebar as if they were their own — a pre-seeding attack that
 * survives the introduction of real authentication. Rejecting every
 * non-device key now closes it before it can be planted.
 */
const DEVICE_KEY_RE = /^device:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface OwnerKeyRequest {
  headers?: Record<string, string | string[] | undefined>;
}

export interface OwnerKeyOptions {
  /** The HMAC key tokens verify against. Absent = no token can verify. */
  sessionSigningKey?: string;
  /** Dev/local ONLY — callers pass `!config.isProduction`, never a flag of
   * its own. In production this is false by construction. */
  allowDeviceFallback: boolean;
  /** Injectable clock for expiry tests. */
  now?: number;
}

function singleHeader(raw: string | string[] | undefined): string | undefined {
  // A repeated header arrives as an array; two different asserted values is
  // ambiguity, and ambiguity is never guessed.
  return Array.isArray(raw) ? (raw.length === 1 ? raw[0] : undefined) : raw;
}

/**
 * The owner key for this request, or throw. Never returns a fallback or a
 * shared "anonymous" value: pooling keyless clients under one owner would
 * make every one of them able to list and delete the others' chats.
 *
 * TOKEN FIRST, ALWAYS: a valid `Authorization: Bearer` yields
 * `email:<verified>` and any x-james-owner header alongside it is IGNORED —
 * the client stopped asserting owners, so an asserted one must never shadow
 * a verified one. The device path exists only when no token is presented AND
 * the caller allows the dev fallback.
 */
export function resolveOwnerKey(request: OwnerKeyRequest, opts: OwnerKeyOptions): string {
  const auth = singleHeader(request.headers?.authorization);
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    const verdict = verifyToken(auth.slice(7), opts.sessionSigningKey ?? '', opts.now ?? Date.now());
    if (!verdict.ok) {
      // The preHandler already 401s these before any handler runs; this
      // throw is belt-and-braces for direct callers and unit paths.
      throw new OwnerKeyError(`session token ${verdict.reason}`);
    }
    return `email:${verdict.email}`;
  }

  if (!opts.allowDeviceFallback) {
    throw new OwnerKeyError('a session token is required');
  }

  const value = singleHeader(request.headers?.[OWNER_KEY_HEADER]);
  if (typeof value !== 'string' || !value.trim()) {
    throw new OwnerKeyError(`${OWNER_KEY_HEADER} header is required`);
  }
  const trimmed = value.trim();
  if (!DEVICE_KEY_RE.test(trimmed)) {
    throw new OwnerKeyError(`${OWNER_KEY_HEADER} must be a device key`);
  }
  // Lower-cased so a client that re-cases its stored uuid cannot silently
  // orphan its own chats behind a second owner key.
  return trimmed.toLowerCase();
}
