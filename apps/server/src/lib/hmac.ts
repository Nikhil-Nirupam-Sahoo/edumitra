import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * HMAC-SHA256 request signing for sync batches.
 *
 * Scheme: signature = hex(hmac_sha256(secret, `${timestamp}.${rawBody}`))
 * The timestamp is included to bound replay windows; the raw body is included
 * so no field can be altered in transit. Comparison is constant-time.
 */

export function computeSignature(secret: string, timestamp: number, rawBody: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

export interface VerifyResult {
  ok: boolean;
  reason?: 'missing_headers' | 'bad_timestamp' | 'skew' | 'bad_signature';
}

export function verifySignature(options: {
  secret: string;
  timestampHeader: string | undefined;
  signatureHeader: string | undefined;
  rawBody: string;
  maxSkewMs: number;
  now?: number;
}): VerifyResult {
  const { secret, timestampHeader, signatureHeader, rawBody, maxSkewMs } = options;
  const now = options.now ?? Date.now();

  if (!timestampHeader || !signatureHeader) {
    return { ok: false, reason: 'missing_headers' };
  }
  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return { ok: false, reason: 'bad_timestamp' };
  }
  if (Math.abs(now - timestamp) > maxSkewMs) {
    return { ok: false, reason: 'skew' };
  }
  const expected = computeSignature(secret, timestamp, rawBody);
  // Both are hex strings; compare as buffers with equal-length guard.
  if (expected.length !== signatureHeader.length) {
    return { ok: false, reason: 'bad_signature' };
  }
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const providedBuffer = Buffer.from(signatureHeader.toLowerCase(), 'utf8');
  if (expectedBuffer.length !== providedBuffer.length) {
    return { ok: false, reason: 'bad_signature' };
  }
  if (!timingSafeEqual(expectedBuffer, providedBuffer)) {
    return { ok: false, reason: 'bad_signature' };
  }
  return { ok: true };
}
