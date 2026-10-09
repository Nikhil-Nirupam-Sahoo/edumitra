/**
 * First-run bootstrap.
 *
 * Content is downloaded (see `content/client.ts`) and cached in IndexedDB;
 * the student roster is device-local. Both steps are idempotent, so this runs
 * on every app start and costs one cheap manifest request when up to date.
 */

import { getAllStudents, getLessons, upsertStudents } from '../db/client';
import type { StudentRecord } from '../db/schema';
import { syncContent, type ContentSyncStatus } from '../content/client';

/** The demo roster. Real deployments replace this with the pairing flow. */
export function buildSeedStudents(): StudentRecord[] {
  const now = Date.now();
  return [
    { id: 'student-aarav', name: 'Aarav', class_id: 'class-8-a', guardian_phone: null, created_at: now },
    { id: 'student-priya', name: 'Priya', class_id: 'class-8-a', guardian_phone: null, created_at: now },
    { id: 'student-rohan', name: 'Rohan', class_id: 'class-9-a', guardian_phone: null, created_at: now },
    { id: 'student-diasha', name: 'Diasha', class_id: 'class-9-a', guardian_phone: null, created_at: now },
    { id: 'student-kabir', name: 'Kabir', class_id: 'class-10-a', guardian_phone: null, created_at: now },
    { id: 'student-ananya', name: 'Ananya', class_id: 'class-10-a', guardian_phone: null, created_at: now },
  ];
}

export interface BootstrapResult {
  content: ContentSyncStatus;
  lessons: number;
  /** True when there is genuinely nothing to show and no way to fetch it. */
  contentUnavailable: boolean;
}

/**
 * Make sure the device has a roster and a curriculum.
 * Never throws — a failure here must not blank the app.
 */
export async function bootstrap(options: { forceContent?: boolean } = {}): Promise<BootstrapResult> {
  const content = await syncContent({ force: options.forceContent });

  try {
    const students = await getAllStudents();
    if (students.length === 0) {
      await upsertStudents(buildSeedStudents());
    }
  } catch (error) {
    console.error('[seed] failed to ensure students', error);
  }

  let lessons = 0;
  try {
    lessons = (await getLessons()).length;
  } catch {
    lessons = 0;
  }

  return {
    content: content.status,
    lessons,
    // Nothing cached AND we could not reach the server: the UI must say so
    // rather than showing an empty classroom.
    contentUnavailable: lessons === 0 && content.status !== 'updated',
  };
}

/** Force a re-download of the curriculum (Settings → Download lessons). */
export async function redownloadContent(): Promise<BootstrapResult> {
  return bootstrap({ forceContent: true });
}

/** Backwards-compatible alias used by the app shell. */
export const seedIfEmpty = bootstrap;