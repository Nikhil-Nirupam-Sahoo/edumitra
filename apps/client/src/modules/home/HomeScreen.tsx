/**
 * HomeScreen — the Learn tab: class tabs, subject groups, lesson cards with stars,
 * hero bar, and daily quests. Purely reads local DB; no network.
 */

import { useEffect, useMemo, useState } from 'react';
import { createTranslator, type LocaleCode } from '../../i18n';
import { getLessons, getAllStudents, getAllProgress } from '../../db/client';
import type { LessonRecord, StudentRecord, StudentProgressRecord, SyllabusGradeId, SyllabusSubjectId } from '../../db/schema';
import { useGamification } from '../../gamification/store';
import { HeroBar } from '../rewards/HeroBar';
import { QuestList } from '../rewards/QuestList';
import { XpBurst } from '../rewards/XpBurst';
import { RevealCard } from '../../anim/RevealCard';
import { LessonPhoto } from '../../art/LessonPhoto';
import { stagger, useInView } from '../../anim/scroll';

type SubjectGroup = { subject: SyllabusSubjectId; lessons: LessonCardView[] };

interface LessonCardView {
  lesson: LessonRecord;
  stars: number;
  status: 'not_started' | 'in_progress' | 'completed';
  xpPreview: number;
}

const SUBJECT_ORDER: SyllabusSubjectId[] = ['math', 'science', 'sst', 'english', 'practice'];
const SUBJECT_ICONS: Record<SyllabusSubjectId, string> = {
  math: '📐',
  science: '🔬',
  sst: '🌍',
  english: '📖',
  practice: '🧩',
};

function starsForScore(score: number): number {
  if (score >= 0.999) return 3;
  if (score >= 0.66) return 2;
  return 1;
}

function classIdToGrade(classId: string): SyllabusGradeId | 'practice' | null {
  const m = classId.match(/class-(\d+)/);
  return m ? (parseInt(m[1], 10) as SyllabusGradeId) : 'practice';
}

export function HomeScreen({
  studentId,
  studentName,
  classId,
  locale,
  onLessonSelect,
}: {
  studentId: string;
  studentName: string;
  classId: string;
  locale: LocaleCode;
  onLessonSelect: (lessonId: string) => void;
}) {
  const { t } = createTranslator(locale);
  const [lessons, setLessons] = useState<LessonRecord[]>([]);
  const [students, setStudents] = useState<StudentRecord[]>([]);
  const [progressMap, setProgressMap] = useState<Map<string, StudentProgressRecord>>(new Map());
  const [selectedStudentId, setSelectedStudentId] = useState(studentId);
  const { state, status } = useGamification(selectedStudentId);
  const [burst, setBurst] = useState<{ xp: number; combo: number; key: number; x: number; y: number } | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [activeTab, setActiveTab] = useState<SyllabusGradeId | 'practice'>(() => {
    const grade = classIdToGrade(classId);
    return (grade as SyllabusGradeId) ?? 'practice';
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // Never let a failed read look like "this class has no lessons".
      setLoadState('loading');
      setLoadError(null);
      try {
        const [allLessons, allStudents, allProgress] = await Promise.all([
          getLessons(),
          getAllStudents(),
          getAllProgress(),
        ]);
        if (cancelled) return;
        setLessons(allLessons);
        setStudents(allStudents);
        const progMap = new Map<string, StudentProgressRecord>();
        for (const p of allProgress) {
          progMap.set(`${p.student_id}::${p.lesson_id}`, p);
        }
        setProgressMap(progMap);
        setLoadState('ready');
      } catch (error) {
        if (cancelled) return;
        console.error('[home] failed to load lessons', error);
        setLoadError(error instanceof Error ? error.message : String(error));
        setLoadState('error');
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const filteredLessons = useMemo(() => {
    if (activeTab === 'practice') {
      return lessons.filter((l) => !l.grade);
    }
    return lessons.filter((l) => l.grade === activeTab);
  }, [lessons, activeTab]);

  const subjectGroups = useMemo((): SubjectGroup[] => {
    const groups = new Map<SyllabusSubjectId, LessonCardView[]>();
    SUBJECT_ORDER.forEach((s) => groups.set(s, []));

    for (const lesson of filteredLessons) {
      const subject = (lesson.subject as SyllabusSubjectId) ?? 'practice';
      const progress = progressMap.get(`${selectedStudentId}::${lesson.id}`);
      const score = progress?.score ?? 0;
      const stars = progress ? starsForScore(score) : 0;
      const status = progress?.completion_status ?? 'not_started';
      const xpPreview = status === 'completed' ? 0 : 25;
      groups.get(subject)!.push({ lesson, stars, status, xpPreview });
    }
    return SUBJECT_ORDER.map((subject) => ({ subject, lessons: groups.get(subject)! })).filter((g) => g.lessons.length > 0);
  }, [filteredLessons, selectedStudentId, progressMap]);

  const tabs: SyllabusGradeId[] = useMemo(() => {
    // Only syllabus grades (8,9,10) go in the grade set; 'practice' lessons have no grade
    const gradeValues = lessons
      .filter((l) => l.grade && l.grade !== 'practice')
      .map((l) => l.grade!) as (8 | 9 | 10)[];
    const gradeSet = new Set<8 | 9 | 10>(gradeValues);
    const baseTabs: (8 | 9 | 10)[] = ([8, 9, 10] as const).filter((g): g is 8 | 9 | 10 => gradeSet.has(g));
    const hasPractice = lessons.some((l) => !l.grade || l.grade === 'practice');
    return hasPractice ? [...baseTabs, 'practice'] : baseTabs;
  }, [lessons]);

  const currentStudent = students.find((s) => s.id === selectedStudentId) ?? { name: studentName, class_id: classId };

  /** Sections fade their heading in; the cards inside run their own reveal. */
  const sectionRef = useInView<HTMLElement>(0.05);

  return (
    <div className="home-screen">
      <header className="home-header">
        <HeroBar studentName={currentStudent.name} state={state} locale={locale} />
        <div className="home-student-switcher">
          <label htmlFor="student-select" className="visually-hidden">{t('settings.student')}</label>
          <select
            id="student-select"
            value={selectedStudentId}
            onChange={(e) => setSelectedStudentId(e.target.value)}
            className="student-select"
          >
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.class_id.replace('class-', 'Class ').replace('-a', 'A')})
              </option>
            ))}
          </select>
        </div>
      </header>

      <nav className="home-class-tabs" role="tablist" aria-label={t('home.tab_class', { grade: '' }).replace('Class ', 'Classes')}>
        {tabs.map((tab: SyllabusGradeId) => (
          <button
            key={tab}
            role="tab"
            aria-selected={activeTab === tab}
            className={`class-tab ${activeTab === tab ? 'active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === 'practice' ? t('home.tab_practice') : t('home.tab_class', { grade: tab })}
          </button>
        ))}
      </nav>

      <main className="home-main" aria-busy={loadState === 'loading'}>
        {loadState === 'loading' && <p className="muted">{t('common.loading')}</p>}

        {loadState === 'error' && (
          <div className="home-load-error" role="alert">
            <p>{t('lesson.no_lessons')}</p>
            <p className="muted mono">{loadError}</p>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setReloadToken((n) => n + 1)}
            >
              {t('common.retry')}
            </button>
          </div>
        )}

        {loadState === 'ready' && subjectGroups.length === 0 && (
          <div className="home-load-error" role="status">
            <p>{t('lesson.no_lessons')}</p>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setReloadToken((n) => n + 1)}
            >
              {t('common.retry')}
            </button>
          </div>
        )}

        {subjectGroups.map((group) => (
          <section
            key={group.subject}
            ref={sectionRef}
            className="subject-section"
            aria-labelledby={`subject-${group.subject}`}
          >
            <h2 id={`subject-${group.subject}`} className="subject-title">
              <span className="subject-icon" aria-hidden="true">{SUBJECT_ICONS[group.subject]}</span>
              {t(`home.subject.${group.subject}`)}
            </h2>
            <div className="lesson-grid">
              {group.lessons.map((item, index) => (
                <RevealCard
                  key={item.lesson.id}
                  // Cascade the grid in rather than popping it as one block.
                  delay={stagger(index, 45)}
                  as="article"
                  className={`lesson-card ${item.status}`}
                  onClick={() => onLessonSelect(item.lesson.id)}
                >
                  <LessonPhoto
                    lessonId={item.lesson.id}
                    locale={locale}
                    alt={item.lesson.title}
                  />
                  <div className="lesson-card-header">
                    <span className="lesson-card-title">{item.lesson.title}</span>
                    <span className="lesson-card-stars" aria-label={`${item.stars} of 3 stars`}>
                      {Array.from({ length: 3 }, (_, i) => (
                        <span key={i} className={`star ${i < item.stars ? 'filled' : ''}`} aria-hidden="true">⭐</span>
                      ))}
                    </span>
                  </div>
                  <div className="lesson-card-meta">
                    {item.status === 'completed' ? (
                      <span className="lesson-completed-badge">{t('common.completed')}</span>
                    ) : (
                      <span className="lesson-xp-preview">+{item.xpPreview} XP</span>
                    )}
                    <span className="lesson-status-dot" aria-hidden="true" />
                  </div>
                </RevealCard>
              ))}
            </div>
          </section>
        ))}
      </main>

      <aside className="home-quests" aria-label={t('home.daily_quests')}>
        <h3>{t('home.daily_quests')}</h3>
        <QuestList quests={state.quests} locale={locale} />
      </aside>

      {burst && (
        <XpBurst key={burst.key} xp={burst.xp} combo={burst.combo} x={burst.x} y={burst.y} onEnd={() => setBurst(null)} />
      )}
    </div>
  );
}