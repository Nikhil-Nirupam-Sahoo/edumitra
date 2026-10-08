import { describe, expect, it } from 'vitest';
import { mergeRegister, operationOrder } from '../src/sync/crdt.js';
import { computeSignature, verifySignature } from '../src/lib/hmac.js';

describe('CRDT register merge', () => {
  const incoming = {
    studentId: 's1',
    lessonId: 'l1',
    key: 'completed_at',
    value: 42,
    ts: 5_000,
    op: 'put' as const,
    sourceStatementId: 'stmt-1',
  };

  it('applies a brand-new register', () => {
    const decision = mergeRegister(undefined, incoming, 1_000);
    expect(decision.applied).toBe(true);
    expect(decision.state.value).toBe(42);
    expect(decision.state.ts).toBe(5_000);
  });

  it('rejects stale and duplicate puts deterministically', () => {
    const existing = { value: 10, ts: 10_000, op: 'put' as const, sourceStatementId: 'stmt-9' };
    expect(mergeRegister(existing, incoming, 0).applied).toBe(false);
    const same = mergeRegister(existing, { ...incoming, ts: 10_000, sourceStatementId: 'stmt-9' }, 0);
    expect(same).toMatchObject({ applied: false, reason: 'duplicate' });
  });

  it('count-inc accumulates once per source statement', () => {
    const existing = { value: 3, ts: 1_000, op: 'count-inc' as const, sourceStatementId: 'a' };
    const inc = { ...incoming, op: 'count-inc' as const, value: 2, sourceStatementId: 'b' };
    const first = mergeRegister(existing, inc, 0);
    expect(first.applied).toBe(true);
    expect(first.state.value).toBe(5);
    const replay = mergeRegister(first.applied ? first.state : existing, { ...inc }, 0);
    expect(replay).toMatchObject({ applied: false, reason: 'duplicate' });
  });

  it('operationOrder is total and equals tie on identical source', () => {
    expect(operationOrder({ ts: 1, sourceStatementId: 'a' }, { ts: 1, sourceStatementId: 'a' })).toBe(0);
    expect(operationOrder({ ts: 1, sourceStatementId: 'b' }, { ts: 1, sourceStatementId: 'a' })).toBeGreaterThan(0);
    expect(operationOrder({ ts: 2, sourceStatementId: 'a' }, { ts: 1, sourceStatementId: 'z' })).toBeGreaterThan(0);
  });
});

describe('HMAC request signing', () => {
  const secret = 'test-secret-key-material';
  const body = JSON.stringify({ statements: [], checkpoints: [] });
  const now = 1_700_000_000_000;

  it('accepts a correctly signed body', () => {
    const ts = now - 1_000;
    const signature = computeSignature(secret, ts, body);
    expect(verifySignature({ secret, timestampHeader: String(ts), signatureHeader: signature, rawBody: body, maxSkewMs: 300_000, now })).toEqual({ ok: true });
  });

  it('rejects tampered bodies, stale timestamps and bad signatures', () => {
    const ts = now;
    const signature = computeSignature(secret, ts, body);
    expect(verifySignature({ secret, timestampHeader: String(ts), signatureHeader: signature, rawBody: body + ' ', maxSkewMs: 300_000, now }).ok).toBe(false);
    expect(verifySignature({ secret, timestampHeader: String(now - 600_000), signatureHeader: signature, rawBody: body, maxSkewMs: 300_000, now }).reason).toBe('skew');
    expect(verifySignature({ secret, timestampHeader: String(ts), signatureHeader: 'deadbeef', rawBody: body, maxSkewMs: 300_000, now }).ok).toBe(false);
    expect(verifySignature({ secret, timestampHeader: undefined, signatureHeader: undefined, rawBody: body, maxSkewMs: 300_000, now }).reason).toBe('missing_headers');
  });
});
