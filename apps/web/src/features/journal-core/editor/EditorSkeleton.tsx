/** Placeholder while the device draft and server copy load (usually a few ms). */
export function EditorSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-5">
      <div className="flex justify-between">
        <div className="h-4 w-48 animate-pulse rounded bg-sunken" />
        <div className="h-4 w-16 animate-pulse rounded bg-sunken" />
      </div>
      <div className="h-8 w-2/3 animate-pulse rounded bg-sunken" />
      <div className="space-y-3 pt-2">
        <div className="h-4 w-full animate-pulse rounded bg-sunken" />
        <div className="h-4 w-11/12 animate-pulse rounded bg-sunken" />
        <div className="h-4 w-4/5 animate-pulse rounded bg-sunken" />
      </div>
    </div>
  );
}
