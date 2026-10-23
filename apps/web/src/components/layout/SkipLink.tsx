export function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only z-[70] rounded-control bg-accent px-4 py-2 text-sm font-medium text-accent-fg focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
    >
      Skip to content
    </a>
  );
}
