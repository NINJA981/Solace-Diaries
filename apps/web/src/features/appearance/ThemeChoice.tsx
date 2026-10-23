import { clsx } from 'clsx';
import { resolveTheme, useTheme, type ThemePreference } from '@/lib/theme';

/** Light, dark or the device's own setting, as a radio group. Saved on this device. */
export function ThemeChoice({ name = 'theme', className }: { name?: string; className?: string }) {
  const { theme, setTheme } = useTheme();
  const system = resolveTheme('system');
  const options: { value: ThemePreference; label: string }[] = [
    { value: 'system', label: `Match this device (currently ${system})` },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ];
  return (
    <fieldset className={className}>
      <legend className="mb-2 text-sm font-medium text-fg">Light or dark</legend>
      <div className="flex max-w-md flex-col gap-2">
        {options.map((o) => (
          <label
            key={o.value}
            className={clsx(
              'flex h-11 cursor-pointer items-center gap-3 rounded-control border px-3.5 text-sm transition-colors',
              'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus',
              theme === o.value ? 'border-accent/60 bg-accent-soft text-fg' : 'border-line text-fg-muted hover:border-line-strong',
            )}
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={theme === o.value}
              onChange={() => setTheme(o.value)}
              className="size-4 accent-accent"
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
