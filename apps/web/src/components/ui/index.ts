// Owned by the web platform layer. STUB — replaced in Phase 1 (agent C).
//
// UI kit contract for consumers (agent D). All components are styled with the tokens in
// styles/tokens.css, forward refs, accept className, and are keyboard + screen-reader complete.
//   Button        { variant?: 'primary'|'secondary'|'ghost'|'danger', size?: 'sm'|'md', loading?: boolean, icon?: ReactNode } & button props
//   IconButton    { label: string (required, becomes aria-label), icon: ReactNode, variant? } & button props
//   Input, Textarea  { label?: string, hint?: string, error?: string } & native props (label wired via htmlFor)
//   Select        { label?: string, options: {value,label}[] } & native select props
//   Dialog        { open, onOpenChange, title, description?, children, footer? } — focus-trapped, Esc closes
//   ConfirmDialog { open, onOpenChange, title, description, confirmLabel, tone?: 'danger'|'default', onConfirm }
//   Tabs          { value, onValueChange, items: {value,label}[] } — roving tabindex
//   Chip          { selected?, onClick?, tone?: 'default'|'lamp'|'dusk' } & children
//   Skeleton      { className } ; Spinner { label?: string }
//   EmptyState    { title, description?, action?: ReactNode, icon?: ReactNode }
//   Card          { as?, className, children }
//   SafeMarkdown  { children: string } — react-markdown with images, raw HTML and non-http(s)/mailto links stripped
//   MoodDot       { mood: Mood | null, size?: number } — uses --mood-N tokens
//   toast(message: string, opts?: { tone?: 'default'|'success'|'danger', action?: { label, onClick } })
//   VisuallyHidden
export {};
