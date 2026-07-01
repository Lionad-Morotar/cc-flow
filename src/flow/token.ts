/**
 * Token primitives shared by bootstrap (generation) and bridge (verification).
 *
 * Kept as a deep module: a tiny interface (generate / compare) hiding the
 * crypto details, so callers depend on behavior, not on node:crypto quirks.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Generate a 256bit bearer token as a 64-char hex string.
 *
 * Why 256bit despite the token persisting in plaintext on disk: online brute
 * force is not the primary threat (disk/argv leakage is), but 256bit costs
 * nothing, removes the low-entropy smell, and future-proofs any path that
 * later stops persisting the token.
 */
export function generateToken(): string {
  return randomBytes(32).toString('hex')
}

/**
 * Constant-time string comparison.
 *
 * Why: loopback timing noise dwarfs byte-compare deltas today, so this is not
 * about an exploitable side-channel now — it is zero-cost hygiene that also
 * hardens any future non-loopback path. Length is checked first because
 * timingSafeEqual throws on mismatched Buffer lengths, and length is not a
 * secret (tokens have a fixed shape).
 */
export function safeCompare(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}
