// UI kit. All components are styled with the tokens in styles/tokens.css, accept className,
// take `ref` as a prop (React 19), and are keyboard + screen-reader complete.
//   Button        { variant?: 'primary'|'secondary'|'ghost'|'danger', size?: 'sm'|'md', loading?: boolean, icon?: ReactNode } & button props
//   IconButton    { label: string (required, becomes aria-label), icon: ReactNode, variant?, size? } & button props
//   Input, Textarea  { label?: string, hint?: ReactNode, error?: string } & native props (label wired via htmlFor)
//   Select        { label?: string, options: {value,label}[] } & native select props
//   Dialog        { open, onOpenChange, title, description?, children, footer? } — native <dialog>, Esc closes, focus returns
//   ConfirmDialog { open, onOpenChange, title, description, confirmLabel, tone?: 'danger'|'default', onConfirm (may be async), children?, confirmDisabled? }
//   Tabs          { value, onValueChange, items: {value,label}[], label? } — roving tabindex
//   Chip          { selected?, onClick?, tone?: 'default'|'lamp'|'dusk' } & children
//   Skeleton      { className } ; Spinner { label?: string }
//   EmptyState    { title, description?, action?: ReactNode, icon?: ReactNode }
//   Card          { as?, className, children }
//   SafeMarkdown  { children: string } — react-markdown with images, raw HTML and non-http(s)/mailto links stripped
//   MoodDot       { mood: Mood | null, size?: number } — uses --mood-N tokens
//   toast(message, opts?: { tone?: 'default'|'success'|'danger', action?: { label, onClick }, duration?, id? }); toast.dismiss(id)
//   VisuallyHidden
// Public pages import from the individual files to keep the landing bundle small.
export { Button, IconButton, buttonClasses, type ButtonProps, type IconButtonProps } from './Button';
export { Input, Textarea, Select, type InputProps, type TextareaProps, type SelectProps, type SelectOption } from './fields';
export { Dialog, ConfirmDialog, type DialogProps, type ConfirmDialogProps } from './Dialog';
export { Tabs, type TabItem, type TabsProps } from './Tabs';
export { Card, Chip, EmptyState, Skeleton, VisuallyHidden, type ChipProps, type ChipTone } from './feedback';
export { Spinner } from './Spinner';
export { MoodDot, moodLevel } from './MoodDot';
export { SafeMarkdown, safeUrl } from './SafeMarkdown';
export { toast, Toaster, type ToastOptions, type ToastTone } from './toast';
