/**
 * RevealCard — a scroll-revealing wrapper for anything in a list.
 *
 * Exists as a component rather than a hook so it can be used as a drop-in
 * replacement for the element it wraps (`<article>` → `<RevealCard>`) without
 * threading refs and inline styles through every call site.
 */

import { useMemo, type ElementType, type ReactNode } from 'react';
import { prefersReducedMotion, useReveal, type Direction } from './scroll';

export interface RevealCardProps {
  children: ReactNode;
  className?: string;
  delay?: number;
  direction?: Direction;
  distance?: number;
  duration?: number;
  /** Skip the animation entirely and render the final state. */
  disabled?: boolean;
  /** Rendered as this element; defaults to a div. */
  as?: ElementType;
  onClick?: () => void;
  [key: string]: unknown;
}

export function RevealCard({
  children,
  className,
  delay = 0,
  direction = 'up',
  distance = 20,
  duration = 560,
  disabled,
  as,
  onClick,
  ...rest
}: RevealCardProps) {
  // Honour the OS setting by default: motion here is decoration, and a student
  // who has asked for less of it should never have to opt out per screen.
  const reduced = useMemo(() => prefersReducedMotion(), []);
  const reveal = useReveal({
    delay,
    direction,
    distance,
    duration,
    disabled: disabled || reduced,
  });
  const Tag = (as ?? 'div') as ElementType;

  return (
    <Tag
      ref={reveal.ref}
      className={reveal.className + (className ? ` ${className}` : '')}
      onClick={onClick}
      {...rest}
    >
      {children}
    </Tag>
  );
}