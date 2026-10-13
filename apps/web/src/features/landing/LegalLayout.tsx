import type { ReactNode } from 'react';
import { PublicPage } from './PublicChrome';

/** Long-form legal page: a readable serif column with a draft notice. */
export function LegalLayout({ title, updated, intro, children }: { title: string; updated: string; intro: ReactNode; children: ReactNode }) {
  return (
    <PublicPage>
      <article className="mx-auto max-w-[44rem] px-5 pt-12 pb-24 sm:px-8 sm:pt-20">
        <h1 className="font-serif text-5xl leading-[1.05] font-[350] tracking-[-0.02em] text-fg">{title}</h1>
        <p className="mt-4 text-sm text-fg-faint">{updated}</p>
        <div role="note" className="mt-8 rounded-card border border-dashed border-line-strong bg-sunken px-4 py-3 text-sm leading-relaxed text-fg-muted">
          This is a plain-language template written to match how Solace is built. Have it reviewed, and fill in the
          bracketed details, before launching to the public.
        </div>
        <div className="mt-10 text-lg leading-relaxed text-fg-muted">{intro}</div>
        <div className="legal mt-4">{children}</div>
      </article>
    </PublicPage>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-12">
      <h2 className="font-serif text-2xl leading-snug font-normal text-fg">{title}</h2>
      <div className="mt-4 flex flex-col gap-4 leading-relaxed text-fg-muted [&_li]:mt-2 [&_strong]:font-medium [&_strong]:text-fg [&_ul]:list-disc [&_ul]:pl-5">
        {children}
      </div>
    </section>
  );
}
