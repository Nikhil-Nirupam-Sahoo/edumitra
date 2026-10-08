/**
 * Diagnostic: reproduce the two-device concurrent convergence scenario over
 * the real HTTP layer, printing intermediate results.
 */

import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createHarness } from './helpers.js';
import { PROGRESS_KEYS } from '../src/sync/crdt.js';

const SECRET = 'test-secret-at-least-16-chars';

function envelope(body: Record<string, unknown>) {
  const raw = JSON.stringify(body);
  const timestamp = Date.now();
  return {
    raw,
    headers: {
      'content-type': 'application/json',
      'x-sync-timestamp': String(timestamp),
      'x-sync-signature': createHmac('sha256', SECRET).update(`${timestamp}.${raw}`).digest('hex'),
    },
  };
}

describe('diagnostic: HTTP concurrent convergence', () => {
  it('debug output', async () => {
    const harness = await createHarness();
    try {
      const deviceA = envelope({
        deviceId: 'device-a',
        statements: [],
        checkpoints: [
          {
            id: 'a-status',
            studentId: 'student-1',
            lessonId: 'math-1',
            key: PROGRESS_KEYS.completionStatus,
            value: 1,
            ts: 10_000,
            op: 'put',
            sourceStatementId: 'a-start',
          },
        ],
      });
      const deviceB = envelope({
        deviceId: 'device-b',
        statements: [],
        checkpoints: [
          {
            id: 'b-status',
            studentId: 'student-1',
            lessonId: 'math-1',
            key: PROGRESS_KEYS.completionStatus,
            value: 2,
            ts: 20_000,
            op: 'put',
            sourceStatementId: 'b-done',
          },
        ],
      });

      for (const [name, batch] of [
        ['A', deviceA],
        ['B', deviceB],
      ] as const) {
        const response = await harness.app.inject({
          method: 'POST',
          url: '/api/v1/sync/progress',
          payload: batch.raw,
          headers: batch.headers,
        });
        console.log(`RESPONSE ${name}:`, response.statusCode, response.body.slice(0, 300));
      }

      const registers = await harness.db.query('SELECT * FROM progress_state');
      console.log('REGISTERS:', JSON.stringify(registers));
      const heads = await harness.db.query('SELECT * FROM progress_heads');
      console.log('HEADS:', JSON.stringify(heads));

      const state = await harness.app.inject({
        method: 'GET',
        url: '/api/v1/cmi5/state?student=student-1',
      });
      console.log('STATE:', state.body.slice(0, 400));
    } finally {
      await harness.close();
    }
    expect(true).toBe(true);
  });
});
