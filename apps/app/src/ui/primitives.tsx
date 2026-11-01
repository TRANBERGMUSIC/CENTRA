import { useCallback, useEffect, useRef, useState, type ReactNode, type ButtonHTMLAttributes, type CSSProperties } from 'react';
import { Icon, type IconName } from './Icon.tsx';

/** CSS custom properties are the only style values components pass inline (positions, ratios, hues). */
export const vars = (v: Record<string, string | number>) => v as CSSProperties;

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { ref?: React.Ref<HTMLButtonElement>; variant?: 'primary' | 'secondary' | 'text'; size?: 'sm' | 'md'; icon?: IconName; kbd?: string };
export function Btn({ variant = 'secondary', size = 'md', icon, kbd, children, className = '', ...rest }: BtnProps) {
  return (
    <button className={`btn btn--${variant} ${size === 'sm' ? 'btn--sm' : ''} ${className}`} {...rest}>
      {icon && <Icon name={icon} size={size === 'sm' ? 'sm' : 'nav'} />}
      {children}
      {kbd && <span className="kbd">{kbd}</span>}
    </button>
  );
}

export function Avatar({ initials, hue, large }: { initials: string; hue: number; large?: boolean }) {
  return <span className={`avatar ${large ? 'avatar--lg' : ''}`} style={vars({ '--h': hue })}>{initials}</span>;
}

export function Pill({ tone = 'neutral', icon, children }: { tone?: 'focus' | 'calm' | 'neutral'; icon?: IconName; children: ReactNode }) {
  return <span className={`pill pill--${tone}`}>{icon && <Icon name={icon} size="sm" />}{children}</span>;
}

export function Panel({ title, count, link, onLink, className = '', children, aside }: { title: string; count?: ReactNode; link?: string; onLink?: () => void; className?: string; children: ReactNode; aside?: ReactNode }) {
  const id = 'h-' + title.toLowerCase().replace(/[^a-zæøå]+/g, '-');
  return (
    <section className={`panel ${className}`} aria-labelledby={id} data-enter>
      <div className="panel__head">
        <h2 id={id} className="panel__title">{title}</h2>
        {count !== undefined && <span className="panel__count num">{count}</span>}
        {aside}
        {link && <button className="panel__link" onClick={onLink}>{link}</button>}
      </div>
      {children}
    </section>
  );
}

export function Wordmark({ className = 'brand__word' }: { className?: string }) {
  return (
    <svg className={className} viewBox="-6 -6 1012 112" fill="none" stroke="currentColor" strokeWidth="9" role="img" aria-label="CENTRA">
      <path d="M100,17 A58,45.5 0 1 0 100,83" /><path d="M268,4.5 H178.5 V95.5 H268 M178.5,50 H262" /><path d="M346.5,100 V8 L433.5,92 V0" />
      <path d="M498,4.5 H600 M549,4.5 V100" /><path d="M668.5,100 V4.5 H726 A24.75,24.75 0 0 1 726,54 H668.5 M716,54 L762,100" /><path d="M826,100 L878,6 L930,100" />
    </svg>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty meta">{children}</div>;
}

/**
 * Long lists draw the first `step` rows and add more as you scroll near the end (900 mails would
 * otherwise all be drawn at once). Put `<More at={more} />` after the rows; `reset` starts over.
 */
export function useProgressive(total: number, step = 60, reset?: unknown): [number, (el: HTMLElement | null) => void] {
  const [limit, setLimit] = useState(step);
  useEffect(() => setLimit(step), [reset, step]);
  const io = useRef<IntersectionObserver | null>(null);
  const at = useCallback((el: HTMLElement | null) => {
    io.current?.disconnect();
    if (!el) return;
    io.current = new IntersectionObserver((es) => { if (es.some((x) => x.isIntersecting)) setLimit((l) => l + step); }, { rootMargin: '600px' });
    io.current.observe(el);
  }, [step]);
  return [Math.min(limit, total), at];
}
export const More = ({ at, left }: { at: (el: HTMLElement | null) => void; left: number }) => (left > 0 ? <div ref={at} className="more-sentinel" aria-hidden="true" /> : null);
