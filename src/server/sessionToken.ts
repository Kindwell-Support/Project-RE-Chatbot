/**
 * Member session tokens — mint and verify (Phase 3 S2).
 *
 * Format: base64url(JSON payload) + '.' + base64url(HMAC-SHA256(payload)).
 * DELIBERATELY NOT A JWT and carrying NO algorithm field: the verifier knows
 * exactly one algorithm, so the alg-swap / "alg": "none" class is structurally
 * impossible rather than checked-for. A JWT-shaped input is just malformed.
 *
 * The payload is { email, iat, exp } and NOTHING ELSE:
 *  - bound to the VERIFIED email — the one the GHL lookup confirmed, never
 *    the string the client typed. The binding is the signature: changing the
 *    email in the payload without the key is a bad_signature, which IS the
 *    replay-for-someone-else rejection.
 *  - no {allow: true} or any claim that reads as a switch — the token's
 *    existence is the decision; there is nothing in the payload structure
 *    inviting an edit.
 *  - nothing from GHL beyond the email: no field id, no contact id, no
 *    customFields. The token crosses the wire on every call and sits in
 *    sessionStorage; it carries the minimum that lets resolveOwnerKey answer
 *    "whose chats?".
 *
 * DEPLOYMENT BINDING is the signing key itself, stated rather than duplicated
 * with a second mechanism: a token minted against a dev key cannot verify
 * against production because production holds a different SESSION_SIGNING_KEY,
 * and that is the whole property — adding an environment claim on top would be
 * a second thing to rotate with no added security.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

/** 12 hours (ruled): shorter than a working day, so a long-lived tab cannot
 * hold access indefinitely. Revocation (Retired Member mid-session) is
 * bounded by min(tab close, this TTL) — both stated properties, not defects. */
export const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

export type TokenVerification =
  | { ok: true; email: string }
  /**
   * Distinct reasons, same contract discipline as AccessDecision (S1): an
   * EXPIRED member needs re-auth and gets a fresh gate; a bad signature is an
   * attack surface observation. One deliberate collapse, because the math
   * offers no distinction: a token minted under the WRONG KEY and a FORGED
   * token are the same observation — an HMAC this deployment's key did not
   * produce — so both are 'bad_signature'. Faking a wrong_key reason would
   * claim knowledge the verifier cannot have.
   */
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' };

const b64url = (buf: Buffer): string => buf.toString('base64url');

function hmac(payloadB64: string, signingKey: string): Buffer {
  return createHmac('sha256', signingKey).update(payloadB64).digest();
}

/**
 * CONSTANT-TIME signature comparison via crypto.timingSafeEqual.
 *
 * The ONE early return is the length check, and it is a decision, not an
 * accident: timingSafeEqual throws on unequal lengths, so the check is
 * mandatory, and what it leaks is only the length of a valid signature —
 * which is fixed (HMAC-SHA256 = 32 bytes) and printed in every textbook.
 * Nothing secret rides on it. Beyond the length gate, comparison time is
 * independent of WHERE the buffers differ.
 */
export function signaturesEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function mintToken(verifiedEmail: string, signingKey: string, now = Date.now()): string {
  const payload = {
    email: verifiedEmail.trim().toLowerCase(),
    iat: now,
    exp: now + TOKEN_TTL_MS,
  };
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  return `${payloadB64}.${b64url(hmac(payloadB64, signingKey))}`;
}

export function verifyToken(
  token: unknown,
  signingKey: string,
  now = Date.now(),
): TokenVerification {
  // --- structure -----------------------------------------------------------
  if (typeof token !== 'string' || token.length === 0 || token.length > 4096) {
    return { ok: false, reason: 'malformed' };
  }
  const parts = token.split('.');
  // Exactly two parts. A three-part (JWT-shaped) token is malformed here —
  // there is no header to negotiate an algorithm with.
  if (parts.length !== 2 || !parts[0] || !parts[1]) return { ok: false, reason: 'malformed' };
  const [payloadB64, sigB64] = parts;

  let claimed: Buffer;
  try {
    claimed = Buffer.from(sigB64, 'base64url');
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  // --- signature BEFORE any claim is trusted -------------------------------
  // Order is load-bearing: an attacker-edited exp with the original signature
  // must report bad_signature, not expired — the payload is untrusted bytes
  // until the HMAC says this deployment minted it.
  if (!signaturesEqual(hmac(payloadB64, signingKey), claimed)) {
    return { ok: false, reason: 'bad_signature' };
  }

  // --- claims (now trusted) ------------------------------------------------
  let payload: { email?: unknown; exp?: unknown };
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (typeof payload.email !== 'string' || payload.email.length === 0) {
    return { ok: false, reason: 'malformed' };
  }
  if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
    return { ok: false, reason: 'malformed' };
  }
  // Expiry is verified HERE, server-side, on every call. A client-side check
  // is a UX nicety (S4 re-auths without a failed round trip); it is never the
  // enforcement.
  if (now >= payload.exp) return { ok: false, reason: 'expired' };

  return { ok: true, email: payload.email };
}

/**
 * Boot gate for the signing key. A missing key that silently degraded to an
 * unsigned or predictable token is the worst available outcome — the product
 * would LOOK gated and not be — so absence or triviality refuses boot
 * (wired into assertRuntimeConfig).
 *
 * "Trivially weak" here is a floor, not a strength meter: minimum 32 chars
 * and more than one distinct character. This rejects '', 'changeme',
 * 'aaaa...' and the placeholder left in .env.example; it does not pretend to
 * measure entropy.
 */
export function signingKeyProblem(key: string | undefined): string | null {
  if (!key || key.trim().length === 0) return 'SESSION_SIGNING_KEY is not set';
  if (key.trim().length < 32) {
    return 'SESSION_SIGNING_KEY is shorter than 32 characters — trivially weak';
  }
  if (new Set(key.trim()).size < 8) {
    return 'SESSION_SIGNING_KEY has fewer than 8 distinct characters — trivially weak';
  }
  return null;
}
