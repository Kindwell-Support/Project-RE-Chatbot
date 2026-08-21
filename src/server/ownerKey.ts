/**
 * Chat ownership resolution — THE single seam (Phase 1 ruling R3).
 *
 * PHASE 3 IS THIS MODULE'S CALLER-IN-WAITING. When GHL email gating lands,
 * Phase 3 replaces the BODY of `resolveOwnerKey` with a verified-token lookup
 * and nothing else in the codebase changes: no route handler reads an owner
 * key from a query string, a body, or a header directly, so every listing and
 * mutation path inherits verified identity the moment this function returns
 * one. Phase 3 also rewrites stored `device:<uuid>` values to
 * `email:<verified-addr>` in place, which is why `chats.owner_key` is an
 * unconstrained TEXT column.
 *
 * WHY A HEADER AND NOT A QUERY PARAM: the owner key is an unguessable BEARER
 * CAPABILITY this phase — whoever holds it can list and delete those chats.
 * Query strings land in web-server access logs, proxy logs and Referer
 * headers; a header does not. It is also the shape Phase 3 wants (an
 * Authorization-style credential), so the transport does not change under it.
 */

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

/**
 * The owner key for this request, or throw. Never returns a fallback or a
 * shared "anonymous" value: pooling keyless clients under one owner would
 * make every one of them able to list and delete the others' chats.
 */
export function resolveOwnerKey(request: OwnerKeyRequest): string {
  const raw = request.headers?.[OWNER_KEY_HEADER];
  // A repeated header arrives as an array; two different asserted owners is
  // ambiguity, and ambiguity is never guessed.
  const value = Array.isArray(raw) ? (raw.length === 1 ? raw[0] : undefined) : raw;
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
