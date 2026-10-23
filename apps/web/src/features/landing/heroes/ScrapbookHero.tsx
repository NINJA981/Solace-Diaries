import { clsx } from 'clsx';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { CatBody } from '@/components/companions/ScrapbookCat';
import type { HeroProps } from '@/worlds/types';
import './scrapbook-hero.css';

/**
 * Scrapbook's landing hero: one journal page that puts itself together, once, when it scrolls
 * into view. The page settles, a photo is slapped on and taped down, the date is stamped, the
 * entry is typed out a word at a time, a margin note is written with an arrow to the photo
 * and a sticker cat arrives. With reduced motion it renders the finished page, designed to be
 * read as a still. Cheap: inline SVG and CSS transforms only; nothing runs after it settles
 * except the cat's idle tail, which pauses off screen.
 */

const ENTRY =
  'Walked down to the harbour with Maya after work. First run since March, and my knee held up the whole way. Kept the ticket stub.';
const WORDS = ENTRY.split(' ');

export default function ScrapbookHero({ className }: HeroProps) {
  const rootRef = useRef<HTMLElement>(null);
  const [visible, setVisible] = useState(false);
  const [played, setPlayed] = useState(false);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        const on = Boolean(entry?.isIntersecting);
        setVisible(on);
        if (on) setPlayed(true);
      },
      { threshold: 0.25 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <figure ref={rootRef} data-visible={visible} data-played={played} className={clsx('sb-hero relative isolate', className)}>
      <div className="sb-page">
        <span className="sb-tape sb-tape-top sb-in" aria-hidden="true" />

        <div className="sb-photo sb-in" aria-hidden="true">
          <span className="sb-tape sb-tape-a" />
          <span className="sb-tape sb-tape-b" />
          <svg viewBox="0 0 200 140" className="sb-print" preserveAspectRatio="xMidYMid slice">
            <defs>
              <linearGradient id="sb-sky" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#6f86b8" />
                <stop offset="0.55" stopColor="#f0a779" />
                <stop offset="1" stopColor="#f7d29a" />
              </linearGradient>
              <linearGradient id="sb-sea" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#7f8fb4" />
                <stop offset="1" stopColor="#2f4568" />
              </linearGradient>
            </defs>
            <rect width="200" height="140" fill="url(#sb-sky)" />
            <circle cx="132" cy="70" r="15" fill="#fff0c4" opacity="0.95" />
            <path d="M0 76l28-14 22 10 26-16 24 14 30-12 70 18v44H0Z" fill="#4c5b7e" opacity="0.7" />
            <rect y="82" width="200" height="58" fill="url(#sb-sea)" />
            <path d="M118 86h26M110 94h44M122 102h22" stroke="#fbe0b0" strokeWidth="2" strokeLinecap="round" opacity="0.7" />
            <path d="M40 98l34-2-6 12H46Z" fill="#241f2c" />
            <path d="M58 96V62l16 30Z" fill="#241f2c" />
            <path d="M56 93V70L44 93Z" fill="#241f2c" opacity="0.85" />
          </svg>
          <span className="sb-caption">harbour, 6:40pm</span>
        </div>

        <div className="sb-stamp sb-in" aria-hidden="true">
          <span>14 OCT 2026</span>
        </div>

        <p className="sb-entry">
          {WORDS.map((w, i) => (
            <span key={i} className="sb-word" style={{ ['--w' as string]: i } as CSSProperties}>
              {w}{' '}
            </span>
          ))}
        </p>

        <p className="sb-note" aria-hidden="true">
          <svg viewBox="0 0 90 64" className="sb-arrow">
            <path d="M6 58C14 30 38 16 76 10" pathLength={1} />
            <path d="M62 4l16 6-12 12" pathLength={1} />
          </svg>
          <span>best evening in weeks!</span>
        </p>

        <div className="sb-cat sb-in" aria-hidden="true">
          <CatBody />
        </div>
      </div>
      <figcaption className="sr-only">
        An example journal page: a photo of the harbour at dusk taped down, a date stamp for 14 October, and a short
        entry about a walk with Maya and a first run since March, with a handwritten note that says best evening in
        weeks.
      </figcaption>
    </figure>
  );
}
