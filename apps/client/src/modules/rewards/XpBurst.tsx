/**
 * XpBurst — a floating "+N XP" label with optional combo fire.
 * Mounts at a screen position, animates up and fades, then unmounts.
 */

import { useEffect, useRef, useState } from 'react';

interface XpBurstProps {
  xp: number;
  combo?: number;
  /** Screen coordinates (clientX/clientY) where the burst originates. */
  x: number;
  y: number;
  /** Called after the animation ends. */
  onEnd?: () => void;
}

export function XpBurst({ xp, combo, x, y, onEnd }: XpBurstProps) {
  const [visible, setVisible] = useState(true);
  const elRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(() => onEnd?.(), 200);
    }, 1200);
    return () => clearTimeout(timer);
  }, [onEnd]);

  if (!visible) return null;

  const style: React.CSSProperties = {
    left: x ?? '50%',
    top: y ?? '50%',
    transform: x !== undefined || y !== undefined ? 'translate(-50%, -50%)' : 'translate(-50%, -50%)',
  };

  return (
    <div className="xp-burst" ref={elRef} style={style} role="status" aria-live="polite">
      <span className="xp-burst-value">+{xp} XP</span>
      {combo && combo >= 2 && <span className="xp-burst-combo">🔥 ×{combo}</span>}
    </div>
  );
}