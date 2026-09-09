import { randomBytes, randomUUID, createHash } from 'node:crypto';

/** Correlates one chat request across usage, intent, impression and reward rows. */
export function newRequestId(): string {
  return `req_${randomUUID()}`;
}

export function newSessionId(): string {
  return `ses_${randomUUID()}`;
}

/** URL-safe high-entropy token, used for refresh tokens and VS Code handoff codes. */
export function newOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * One-way hash for values we must be able to compare but never read back:
 * refresh tokens, handoff codes, and normalised prompts.
 */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Normalises a prompt before hashing so trivial edits do not defeat duplicate
 * detection. The hash is one-way and never returned by any endpoint; it exists
 * only to stop the same question being farmed for rewards.
 */
export function promptFingerprint(text: string): string {
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').replace(/[^\w\s]/g, '').trim();
  return sha256(normalized);
}

/** Deterministic idempotency key so a retried grant cannot double-credit a user. */
export function idempotencyKey(...parts: (string | number)[]): string {
  return sha256(parts.join(':'));
}
