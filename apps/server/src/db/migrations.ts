/**
 * Schema migrations — ordered, append-only, dialect-portable SQL.
 *
 * Notes:
 *  - All epoch-ms columns are BIGINT: 32-bit INTEGER would overflow (ms epoch
 *    is ~1.7e12 > 2^31). SQLite has no width limits; Postgres needs BIGINT.
 *  - JSON is stored as TEXT in both dialects (SQLite has no jsonb); services
 *    parse/stringify at the boundary.
 *  - Booleans are INTEGER 0/1 for portability.
 *  - `ON CONFLICT ... DO NOTHING/UPDATE` is supported by SQLite >= 3.24 and
 *    PostgreSQL >= 9.5.
 */

import type { Migration } from './types.js';

export const MIGRATIONS: readonly Migration[] = [
  {
    id: '0001_core',
    sql: `
      -- Mirrors of client data: full xAPI statement log (the source of truth).
      CREATE TABLE IF NOT EXISTS xapi_statements (
        id TEXT PRIMARY KEY,
        student_id TEXT NOT NULL,
        lesson_id TEXT,
        verb TEXT NOT NULL,
        statement_json TEXT NOT NULL,
        timestamp_ms BIGINT NOT NULL,
        stored_at_ms BIGINT NOT NULL,
        device_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_xapi_student_time ON xapi_statements (student_id, timestamp_ms);
      CREATE INDEX IF NOT EXISTS idx_xapi_lesson_time ON xapi_statements (lesson_id, timestamp_ms);
      CREATE INDEX IF NOT EXISTS idx_xapi_stored ON xapi_statements (stored_at_ms);
      CREATE INDEX IF NOT EXISTS idx_xapi_verb ON xapi_statements (verb);

      -- CRDT register store: one row per (student, lesson, checkpoint key).
      CREATE TABLE IF NOT EXISTS progress_state (
        student_id TEXT NOT NULL,
        lesson_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value DOUBLE PRECISION NOT NULL,
        ts BIGINT NOT NULL,
        op TEXT NOT NULL,
        source_statement_id TEXT NOT NULL,
        updated_at BIGINT NOT NULL,
        PRIMARY KEY (student_id, lesson_id, key)
      );
      CREATE INDEX IF NOT EXISTS idx_progress_state_updated ON progress_state (updated_at);

      -- Dedupe ledger for additive (count-inc) checkpoints.
      CREATE TABLE IF NOT EXISTS checkpoint_applied (
        student_id TEXT NOT NULL,
        lesson_id TEXT NOT NULL,
        key TEXT NOT NULL,
        source_statement_id TEXT NOT NULL,
        applied_at BIGINT NOT NULL,
        PRIMARY KEY (lesson_id, key, source_statement_id)
      );
      CREATE INDEX IF NOT EXISTS idx_checkpoint_applied_at ON checkpoint_applied (applied_at);

      -- Denormalized per-lesson head so clients can bootstrap without replay.
      CREATE TABLE IF NOT EXISTS progress_heads (
        student_id TEXT NOT NULL,
        lesson_id TEXT NOT NULL,
        completion_status TEXT NOT NULL,
        score DOUBLE PRECISION NOT NULL,
        last_card_index INTEGER NOT NULL,
        time_on_task_ms BIGINT NOT NULL,
        latest_ts BIGINT NOT NULL,
        head_statement_id TEXT NOT NULL,
        updated_at BIGINT NOT NULL,
        PRIMARY KEY (student_id, lesson_id)
      );
      CREATE INDEX IF NOT EXISTS idx_progress_heads_updated ON progress_heads (updated_at);

      -- Device sync cursors (delta pull).
      CREATE TABLE IF NOT EXISTS device_cursors (
        device_id TEXT PRIMARY KEY,
        last_seen_at BIGINT NOT NULL,
        last_statement_ts BIGINT NOT NULL
      );

      -- Batch audit log (observability + replay forensics).
      CREATE TABLE IF NOT EXISTS sync_batches (
        batch_id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL,
        received_at BIGINT NOT NULL,
        statement_count INTEGER NOT NULL,
        accepted INTEGER NOT NULL,
        duplicates INTEGER NOT NULL,
        rejected INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sync_batches_device ON sync_batches (device_id, received_at);

      -- Tombstones for statements purged by retention; lets offline devices
      -- drop local copies without re-uploading them.
      CREATE TABLE IF NOT EXISTS purged_tombstones (
        statement_id TEXT PRIMARY KEY,
        purged_at BIGINT NOT NULL,
        device_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_tombstones_purged ON purged_tombstones (purged_at);

      -- Lessons: curriculum content synced from server.
      CREATE TABLE IF NOT EXISTS lessons (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        language TEXT NOT NULL,
        version INTEGER NOT NULL,
        content_json TEXT NOT NULL,
        updated_at BIGINT NOT NULL,
        grade INTEGER,
        subject TEXT,
        content_version INTEGER DEFAULT 1
      );
      CREATE INDEX IF NOT EXISTS idx_lessons_grade_subject ON lessons (grade, subject);

      -- Students: roster managed by teacher or self-registration.
      CREATE TABLE IF NOT EXISTS students (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        class_id TEXT NOT NULL,
        guardian_phone TEXT,
        created_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_students_class ON students (class_id);
    `,
  },
  {
    id: '0002_sync_metrics',
    sql: `
      CREATE TABLE IF NOT EXISTS sync_metrics_daily (
        day TEXT NOT NULL,
        device_id TEXT NOT NULL,
        statements_ingested BIGINT NOT NULL DEFAULT 0,
        statements_duplicate BIGINT NOT NULL DEFAULT 0,
        statements_rejected BIGINT NOT NULL DEFAULT 0,
        batches INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (day, device_id)
      );
    `,
  },
  {
    id: '0004_users',
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        role TEXT NOT NULL,
        display_name TEXT NOT NULL,
        class_id TEXT,
        password_hash TEXT NOT NULL,
        created_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);
    `,
  },
  {
    id: '0005_support_requests',
    sql: `
      -- Questions a student sends to their mentor. The id is a client-generated
      -- UUID rather than a serial so the same DDL works on SQLite and Postgres.
      CREATE TABLE IF NOT EXISTS support_requests (
        id TEXT PRIMARY KEY,
        student_id TEXT NOT NULL,
        student_name TEXT NOT NULL,
        subject TEXT NOT NULL,
        body TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        created_at BIGINT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_support_requests_created ON support_requests (created_at);
      CREATE INDEX IF NOT EXISTS idx_support_requests_status ON support_requests (status, created_at);
    `,
  },
  {
    id: '0006_users_auth_provider',
    sql: `
      -- Self-registration and Google sign-in.
      --
      -- auth_provider records how the account authenticates ('password' or
      -- 'google') so an account created by Google is never asked for a
      -- password, and one created with a password is never offered Google.
      --
      -- google_sub is Google's stable account id: unlike an email address it
      -- never changes, so it is what an account is linked by. The unique index
      -- is what stops one Google account creating two local users.
      ALTER TABLE users ADD COLUMN email TEXT;
      ALTER TABLE users ADD COLUMN google_sub TEXT;
      ALTER TABLE users ADD COLUMN auth_provider TEXT NOT NULL DEFAULT 'password';
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users (google_sub);
      CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
    `,
  },
  {
    id: '0007_users_profile',
    sql: `
      -- Extended profile fields for students and teachers.
      --
      -- board_id: CBSE | BSE_ODISHA | CHSE | ICSE | STATE_OTHER
      -- school_id: free text, user-entered
      -- font_size: user preference (1.0 = default, 0.85 = small, 1.15 = large)
      -- avatar_url: local or remote URL for profile picture
      -- preferences_json: catch-all for future prefs without migrations
      ALTER TABLE users ADD COLUMN board_id TEXT;
      ALTER TABLE users ADD COLUMN school_id TEXT;
      ALTER TABLE users ADD COLUMN avatar_url TEXT;
      ALTER TABLE users ADD COLUMN font_size REAL DEFAULT 1.0;
      ALTER TABLE users ADD COLUMN preferences_json TEXT DEFAULT '{}';
      CREATE INDEX IF NOT EXISTS idx_users_board ON users (board_id);
    `,
  },
  {
    id: '0008_video_content',
    sql: `
      -- Video lectures sourced from open educational repos (NCERT DIKSHA, BSE Odisha,
      -- CHSE, ICSE YouTube channels, etc.). Each video maps to a lesson or a
      -- standalone topic.
      --
      -- source: youtube | local | diksha | other
      -- subtitles_json: [{ lang, label, url, format: vtt|srt, color, background }]
      -- languages_json: audio track availability per language
      -- thumbnail_webp: compressed thumbnail stored locally
      -- duration_sec: for UI and progress tracking
      CREATE TABLE IF NOT EXISTS video_lectures (
        id TEXT PRIMARY KEY,
        lesson_id TEXT REFERENCES lessons(id),
        topic_id TEXT,
        title TEXT NOT NULL,
        description TEXT,
        board_id TEXT NOT NULL,
        class_id TEXT NOT NULL,
        subject TEXT NOT NULL,
        source TEXT NOT NULL,
        source_url TEXT NOT NULL,
        youtube_id TEXT,
        duration_sec INTEGER,
        thumbnail_webp TEXT,
        subtitles_json TEXT DEFAULT '[]',
        languages_json TEXT DEFAULT '[]',
        downloadable INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_video_lesson ON video_lectures(lesson_id);
      CREATE INDEX IF NOT EXISTS idx_video_board_class ON video_lectures(board_id, class_id, subject);
      CREATE INDEX IF NOT EXISTS idx_video_topic ON video_lectures(topic_id);
    `,
  },
  {
    id: '0009_video_progress',
    sql: `
      -- Per-student video progress: position, completed, speed, subtitle prefs.
      CREATE TABLE IF NOT EXISTS video_progress (
        student_id TEXT NOT NULL,
        video_id TEXT NOT NULL,
        position_sec REAL DEFAULT 0,
        completed INTEGER DEFAULT 0,
        playback_speed REAL DEFAULT 1.0,
        subtitle_lang TEXT,
        subtitle_color TEXT,
        subtitle_bg TEXT,
        last_watched_at INTEGER,
        PRIMARY KEY (student_id, video_id)
      );
      CREATE INDEX IF NOT EXISTS idx_vp_student ON video_progress(student_id);
    `,
  },
  {
    id: '0010_assignments_mocks',
    sql: `
      -- Weekly assignments and mock tests. Linked to lessons/topics, auto-graded
      -- where possible, with PDF generation for offline use.
      CREATE TABLE IF NOT EXISTS assignments (
        id TEXT PRIMARY KEY,
        lesson_id TEXT,
        topic_id TEXT,
        board_id TEXT NOT NULL,
        class_id TEXT NOT NULL,
        subject TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        type TEXT NOT NULL, -- 'weekly' | 'mock'
        questions_json TEXT NOT NULL, -- [{ id, type, prompt, options, answer, explanation, marks }]
        total_marks INTEGER,
        time_limit_min INTEGER,
        opens_at INTEGER,
        closes_at INTEGER,
        pdf_url TEXT,
        created_by TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_assign_class ON assignments(board_id, class_id, subject);
      CREATE INDEX IF NOT EXISTS idx_assign_lesson ON assignments(lesson_id);

      CREATE TABLE IF NOT EXISTS assignment_submissions (
        student_id TEXT NOT NULL,
        assignment_id TEXT NOT NULL,
        answers_json TEXT NOT NULL,
        score REAL,
        graded INTEGER DEFAULT 0,
        feedback_json TEXT,
        submitted_at INTEGER NOT NULL,
        PRIMARY KEY (student_id, assignment_id)
      );
      CREATE INDEX IF NOT EXISTS idx_sub_student ON assignment_submissions(student_id);
    `,
  },
  {
    id: '0011_student_stats',
    sql: `
      -- Aggregated study time per student per subject, per day. Populated by
      -- the sync engine from xAPI statements.
      CREATE TABLE IF NOT EXISTS student_daily_stats (
        student_id TEXT NOT NULL,
        day TEXT NOT NULL, -- ISO date YYYY-MM-DD
        subject TEXT NOT NULL,
        time_sec INTEGER DEFAULT 0,
        lessons_completed INTEGER DEFAULT 0,
        questions_answered INTEGER DEFAULT 0,
        videos_watched INTEGER DEFAULT 0,
        xp_earned INTEGER DEFAULT 0,
        PRIMARY KEY (student_id, day, subject)
      );
      CREATE INDEX IF NOT EXISTS idx_sds_student ON student_daily_stats(student_id, day);
    `,
  },
  {
    id: '0012_teacher_notes_doubts',
    sql: `
      -- Teacher notes (elaborated) and student doubt threads.
      CREATE TABLE IF NOT EXISTS teacher_notes (
        id TEXT PRIMARY KEY,
        lesson_id TEXT NOT NULL,
        teacher_id TEXT NOT NULL,
        content_md TEXT NOT NULL,
        pdf_url TEXT,
        version INTEGER DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS tn_lesson ON teacher_notes(lesson_id);

      CREATE TABLE IF NOT EXISTS doubt_threads (
        id TEXT PRIMARY KEY,
        student_id TEXT NOT NULL,
        lesson_id TEXT NOT NULL,
        question_md TEXT NOT NULL,
        status TEXT DEFAULT 'open', -- 'open' | 'answered' | 'closed'
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS dt_student ON doubt_threads(student_id);
      CREATE INDEX IF NOT EXISTS dt_lesson ON doubt_threads(lesson_id);

      CREATE TABLE IF NOT EXISTS doubt_replies (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        author_id TEXT NOT NULL,
        author_role TEXT NOT NULL, -- 'student' | 'teacher'
        content_md TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `,
  },
  {
    id: '0013_mindmaps',
    sql: `
      -- Concept maps per lesson/topic. Stored as JSON graph (nodes + edges).
      -- Rendered client-side with D3 or Cytoscape.
      CREATE TABLE IF NOT EXISTS mindmaps (
        id TEXT PRIMARY KEY,
        lesson_id TEXT NOT NULL,
        topic_id TEXT,
        title TEXT NOT NULL,
        nodes_json TEXT NOT NULL, -- [{ id, label, x, y, color, icon }]
        edges_json TEXT NOT NULL, -- [{ from, to, label }]
        created_by TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS mm_lesson ON mindmaps(lesson_id);
    `,
  },
  {
    id: '0014_nearby_peers',
    sql: `
      -- Anonymised "competitors nearby": students in same board/class within
      -- approx 25 km, without revealing location. Uses geohash prefix (5 chars
      -- ≈ 4.8 km) for bucketing; only counts shown, never coordinates.
      CREATE TABLE IF NOT EXISTS nearby_peers (
        student_id TEXT NOT NULL,
        peer_count INTEGER NOT NULL,
        geohash_prefix TEXT NOT NULL,
        last_updated INTEGER NOT NULL,
        PRIMARY KEY (student_id)
      );
    `,
  },
  {
    id: '0015_notes_pdfs',
    sql: `
      -- Generated PDF notes per lesson/chapter, with versioning and multilingual
      -- support. Generated server-side from lesson content + teacher notes.
      CREATE TABLE IF NOT EXISTS notes_pdfs (
        id TEXT PRIMARY KEY,
        lesson_id TEXT NOT NULL,
        lang TEXT NOT NULL, -- en | hi | ta | or | bn
        version INTEGER DEFAULT 1,
        pdf_url TEXT NOT NULL,
        generated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS np_lesson ON notes_pdfs(lesson_id, lang);
    `,
  },
  {
    id: '0015_reels',
    sql: `
      -- Reels: short-form video feed. Each reel has a figure, title, body,
      -- optional quiz, and now optional video clip.
      CREATE TABLE IF NOT EXISTS reels (
        id TEXT PRIMARY KEY,
        lesson_id TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT,
        figure_json TEXT,
        subject TEXT,
        grade INTEGER,
        is_video INTEGER DEFAULT 0,
        video_url TEXT,
        video_duration_sec INTEGER,
        video_thumbnail_webp TEXT,
        video_subtitles_json TEXT DEFAULT '[]',
        video_languages_json TEXT DEFAULT '[]',
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_reels_lesson ON reels(lesson_id);
      CREATE INDEX IF NOT EXISTS idx_reels_subject ON reels(subject);
    `,
  },
  {
    id: '0016_reels_videos',
    sql: `
      -- Reels can now be video clips or animations. Extends the reels
      -- model with video-specific fields. (Already included in 0015_reels,
      -- this migration is a no-op for new installs, kept for migration ordering.)
    `,
  },
  {
    id: '0017_student_settings',
    sql: `
      -- User-facing preferences: font size, theme, language, subtitle defaults.
      -- Stored in users.preferences_json but mirrored here for querying.
      ALTER TABLE users ADD COLUMN theme TEXT DEFAULT 'system'; -- 'light' | 'dark' | 'system'
      ALTER TABLE users ADD COLUMN preferred_subtitle_lang TEXT;
      ALTER TABLE users ADD COLUMN preferred_subtitle_color TEXT;
      ALTER TABLE users ADD COLUMN preferred_subtitle_bg TEXT;
    `,
  },
  {
    id: '0018_video_downloads',
    sql: `
      -- Offline video assets: local file references for downloaded lectures.
      -- Files stored under IndexedDB / filesystem API on client; server only tracks
      -- which videos a student has cached for re-download and quota management.
      CREATE TABLE IF NOT EXISTS video_downloads (
        id TEXT PRIMARY KEY,
        student_id TEXT NOT NULL,
        video_id TEXT NOT NULL,
        quality TEXT, -- '360p' | '480p' | '720p'
        file_size_bytes INTEGER,
        downloaded_at INTEGER NOT NULL,
        expires_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS vd_student ON video_downloads(student_id);
      CREATE INDEX IF NOT EXISTS vd_video ON video_downloads(video_id);
    `,
  },
];

