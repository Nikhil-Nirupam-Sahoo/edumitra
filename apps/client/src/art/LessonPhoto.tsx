/**
 * LessonPhoto — the chapter photograph on a lesson card or reel.
 *
 * Resolves to nothing until the image has downloaded, so the card never shows a
 * broken frame or a layout that jumps once the bytes land. A chapter with no
 * photo, or one that fails to download, renders nothing at all and the card
 * falls back to its Manim figure.
 */

import { useEffect, useState } from 'react';
import { loadChapterPhoto, type ChapterPhoto } from '../content/photos';
import { createTranslator, type LocaleCode } from '../i18n';

export function LessonPhoto({
  lessonId,
  locale,
  size = 'card',
  alt,
  className,
}: {
  lessonId: string;
  locale: LocaleCode;
  size?: 'card' | 'hero';
  /** Defaults to the chapter title; pass '' for a decorative reel cover. */
  alt?: string;
  className?: string;
}) {
  const { t } = createTranslator(locale);
  const [photo, setPhoto] = useState<ChapterPhoto | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setReady(false);
    setPhoto(null);
    loadChapterPhoto(lessonId)
      .then((result) => {
        if (cancelled) return;
        setPhoto(result);
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, [lessonId]);

  const url = photo ? (size === 'hero' ? photo.heroUrl : photo.cardUrl) : null;
  if (!ready || !photo || !url) return null;

  return (
    <figure className={`lesson-photo ${className ?? ''}`}>
      <img
        src={url}
        alt={alt ?? ''}
        loading="lazy"
        decoding="async"
        width={size === 'hero' ? 1280 : 640}
        height={size === 'hero' ? 720 : 360}
      />
      {/* CC BY requires crediting the photographer — not optional decoration. */}
      <figcaption>
        <a href={photo.sourceUrl} target="_blank" rel="noopener noreferrer">
          {photo.credit || t('settings.photo_unknown_credit')}
        </a>
        {' · '}
        {photo.license}
      </figcaption>
    </figure>
  );
}