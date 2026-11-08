import { type ComponentPropsWithRef, type ReactNode } from 'react'
import * as AvatarPrimitive from '@radix-ui/react-avatar'
import * as Dialog from '@radix-ui/react-dialog'
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import * as ProgressPrimitive from '@radix-ui/react-progress'
import * as SelectPrimitive from '@radix-ui/react-select'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import clsx, { type ClassValue } from 'clsx'
import { Check, ChevronDown, Loader2, X } from 'lucide-react'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/* ------------------------------------------------------------------ Button */

export type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'danger' | 'quiet'
export type ButtonSize = 'sm' | 'md' | 'lg'

export const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-forest text-paper hover:bg-forest-deep active:bg-forest-deep',
  outline: 'border border-line bg-paper text-ink hover:border-ink/30 hover:bg-cream',
  ghost: 'text-ink hover:bg-cream',
  danger: 'border border-transparent text-ember hover:border-ember/30 hover:bg-ember/10',
  quiet: 'text-muted hover:text-ink hover:bg-cream',
}

const sizeVariants: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-[13px]',
  md: 'h-10 px-4 text-sm',
  lg: 'h-11 px-6 text-sm',
}

const buttonBase =
  'inline-flex items-center justify-center gap-2 rounded-[3px] font-medium tracking-tight whitespace-nowrap transition-colors duration-150 select-none disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest focus-visible:ring-offset-1 focus-visible:ring-offset-paper'

export type ButtonProps = ComponentPropsWithRef<'button'> & {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(buttonBase, buttonVariants[variant], sizeVariants[size], className)}
      {...rest}
    >
      {loading && <Loader2 size={15} className="animate-spin" aria-hidden />}
      {children}
    </button>
  )
}

/* -------------------------------------------------------------- IconButton */

export type IconButtonProps = Omit<ComponentPropsWithRef<'button'>, 'children'> & {
  'aria-label': string
  children: ReactNode
  variant?: 'ghost' | 'outline'
  size?: 'sm' | 'md'
}

export function IconButton({
  variant = 'ghost',
  size = 'md',
  className,
  children,
  type = 'button',
  ...rest
}: IconButtonProps) {
  const dims = size === 'sm' ? 'h-8 w-8' : 'h-9 w-9'
  const tones =
    variant === 'outline'
      ? 'border border-line bg-paper text-muted hover:text-ink hover:border-ink/30'
      : 'text-muted hover:text-ink hover:bg-cream'
  return (
    <button
      type={type}
      className={cn(
        buttonBase,
        dims,
        'rounded-[3px] p-0',
        tones,
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}

/* ------------------------------------------------------------ Input/Text */

export type InputProps = ComponentPropsWithRef<'input'> & {
  invalid?: boolean
}

export function Input({ className, invalid, ...rest }: InputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cn(
        'h-10 w-full rounded-[3px] border bg-paper px-3 text-sm text-ink placeholder:text-muted',
        'transition-colors duration-150 disabled:cursor-not-allowed disabled:bg-cream disabled:text-muted',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest focus-visible:ring-offset-0',
        invalid ? 'border-ember' : 'border-line hover:border-ink/25',
        className,
      )}
      {...rest}
    />
  )
}

export type TextareaProps = ComponentPropsWithRef<'textarea'> & {
  invalid?: boolean
}

export function Textarea({ className, invalid, ...rest }: TextareaProps) {
  return (
    <textarea
      aria-invalid={invalid || undefined}
      className={cn(
        'w-full rounded-[3px] border bg-paper px-3 py-2 text-sm text-ink placeholder:text-muted',
        'transition-colors duration-150 disabled:cursor-not-allowed disabled:bg-cream',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest focus-visible:ring-offset-0',
        'min-h-[88px] resize-y',
        invalid ? 'border-ember' : 'border-line hover:border-ink/25',
        className,
      )}
      {...rest}
    />
  )
}

export function Label({
  className,
  children,
  ...rest
}: ComponentPropsWithRef<'label'>) {
  return (
    <label className={cn('label-mono mb-1.5 block text-muted', className)} {...rest}>
      {children}
    </label>
  )
}

export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
  className,
}: {
  label: string
  htmlFor?: string
  error?: string
  hint?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('w-full', className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p role="alert" className="mt-1.5 text-xs text-ember">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1.5 text-xs text-muted">{hint}</p>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ Card */

export function Card({
  className,
  children,
  ...rest
}: ComponentPropsWithRef<'div'>) {
  return (
    <div
      className={cn('rounded-[4px] border border-line bg-cream', className)}
      {...rest}
    >
      {children}
    </div>
  )
}

/* ------------------------------------------------------------------ Chip */

export function Chip({
  className,
  children,
  ...rest
}: ComponentPropsWithRef<'span'>) {
  return (
    <span
      className={cn(
        'label-mono inline-flex items-center gap-1.5 border border-line bg-paper px-2 py-[3px] text-muted',
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  )
}

const ROLE_STYLES: Record<string, string> = {
  head: 'border-forest/35 bg-forest/8 text-forest',
  owner: 'border-forest/35 bg-forest/8 text-forest',
  lead: 'border-forest-soft/35 bg-forest-soft/10 text-forest-soft',
  member: 'border-line bg-cream text-muted',
  successor: 'border-ember/35 bg-ember/8 text-ember',
}

export function RoleChip({ role, className }: { role?: string | null; className?: string }) {
  if (!role) return null
  const tone = ROLE_STYLES[role] ?? ROLE_STYLES.member
  return (
    <span
      className={cn(
        'label-mono inline-flex items-center border px-2 py-[3px]',
        tone,
        className,
      )}
    >
      {role}
    </span>
  )
}

type StatusTone = {
  label: string
  className: string
}

const STATUS_TONES: Record<string, StatusTone> = {
  completed: { label: 'completed', className: 'border-forest/35 bg-forest/8 text-forest' },
  verified: { label: 'verified', className: 'border-forest/35 bg-forest/8 text-forest' },
  accepted: { label: 'accepted', className: 'border-forest/35 bg-forest/8 text-forest' },
  approved: { label: 'approved', className: 'border-forest/35 bg-forest/8 text-forest' },
  shared: { label: 'shared', className: 'border-forest/35 bg-forest/8 text-forest' },
  supported: { label: 'supported', className: 'border-forest/35 bg-forest/8 text-forest' },
  active: { label: 'active', className: 'border-forest/35 bg-forest/8 text-forest' },
  corrected: { label: 'corrected', className: 'border-forest-soft/35 bg-forest-soft/10 text-forest-soft' },
  pending: { label: 'pending', className: 'border-line bg-cream text-muted' },
  queued: { label: 'queued', className: 'border-line bg-cream text-muted' },
  uploaded: { label: 'uploaded', className: 'border-line bg-cream text-muted' },
  draft: { label: 'draft', className: 'border-line bg-cream text-muted' },
  invited: { label: 'invited', className: 'border-line bg-cream text-muted' },
  processing: { label: 'processing', className: 'border-ember/35 bg-ember/8 text-ember' },
  needs_review: { label: 'needs review', className: 'border-ember/35 bg-ember/8 text-ember' },
  changes_requested: { label: 'changes requested', className: 'border-ember/35 bg-ember/8 text-ember' },
  inferred: { label: 'inferred', className: 'border-ember/35 bg-ember/8 text-ember' },
  conflicting: { label: 'conflicting', className: 'border-ember/35 bg-ember/8 text-ember' },
  missing: { label: 'missing', className: 'border-ember/35 bg-ember/8 text-ember' },
  failed: { label: 'failed', className: 'border-ember/45 bg-ember/12 text-ember' },
  rejected: { label: 'rejected', className: 'border-ember/45 bg-ember/12 text-ember' },
  archived: { label: 'archived', className: 'border-line bg-cream text-muted' },
  deactivated: { label: 'deactivated', className: 'border-line bg-cream text-muted' },
}

export function StatusBadge({ status, className }: { status?: string | null; className?: string }) {
  if (!status) return null
  const tone = STATUS_TONES[status]
  const label = tone?.label ?? status.replace(/_/g, ' ')
  const cls = tone?.className ?? 'border-line bg-cream text-muted'
  return (
    <span className={cn('label-mono inline-flex items-center border px-2 py-[3px]', cls, className)}>
      {label}
    </span>
  )
}

/* ----------------------------------------------------- Empty / Loading */

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-[4px] border border-dashed border-line bg-cream/50 px-6 py-14 text-center',
        className,
      )}
    >
      {icon ? <div className="mb-1 text-muted">{icon}</div> : null}
      <p className="font-display text-lg text-ink">{title}</p>
      {description ? <p className="max-w-md text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  )
}

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={cn('animate-spin text-forest', className)} aria-hidden />
}

export function CenteredSpinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center" role="status">
      <Spinner size={22} />
      <span className="sr-only">{label}</span>
    </div>
  )
}

/* ---------------------------------------------------------------- Modal */

export const Modal = Dialog.Root
export const ModalTrigger = Dialog.Trigger
export const ModalClose = Dialog.Close

export function ModalContent({
  className,
  children,
  title,
  description,
  ...rest
}: ComponentPropsWithRef<typeof Dialog.Content> & { title: string; description?: string }) {
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="pp-modal-overlay" />
      <Dialog.Content className={cn('pp-modal-content p-6', className)} {...rest}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <Dialog.Title className="font-display text-xl leading-tight text-ink">
              {title}
            </Dialog.Title>
            {description ? (
              <Dialog.Description className="mt-1.5 text-sm text-muted">
                {description}
              </Dialog.Description>
            ) : (
              <Dialog.Description className="sr-only">{title}</Dialog.Description>
            )}
          </div>
          <Dialog.Close asChild>
            <IconButton aria-label="Close dialog" size="sm">
              <X size={15} />
            </IconButton>
          </Dialog.Close>
        </div>
        <div className="mt-5">{children}</div>
      </Dialog.Content>
    </Dialog.Portal>
  )
}

/* --------------------------------------------------------------- Select */

export type SelectOption = { value: string; label: string }

export function Select({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  ariaLabel,
  className,
  disabled,
}: {
  value?: string | null
  onChange: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  ariaLabel?: string
  className?: string
  disabled?: boolean
}) {
  const selected = options.find((o) => o.value === value)
  return (
    <SelectPrimitive.Root
      value={value ?? undefined}
      onValueChange={onChange}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger
        aria-label={ariaLabel}
        className={cn('pp-select-trigger', className)}
      >
        <span className="truncate">{selected ? selected.label : placeholder}</span>
        <SelectPrimitive.Icon asChild>
          <ChevronDown size={14} className="shrink-0 text-muted" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          className="pp-select-content"
          style={{ minWidth: 'var(--radix-select-trigger-width)' }}
        >
          <SelectPrimitive.Viewport className="p-1">
            {options.map((opt) => (
              <SelectPrimitive.Item key={opt.value} value={opt.value} className="pp-select-item">
                <SelectPrimitive.ItemText className="truncate">
                  {opt.label}
                </SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="ml-auto">
                  <Check size={13} aria-hidden />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
}

/* --------------------------------------------------------- DropdownMenu */

export const DropdownMenu = DropdownMenuPrimitive.Root
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger

export function DropdownMenuContent({
  className,
  align = 'end',
  sideOffset = 8,
  ...rest
}: ComponentPropsWithRef<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn('pp-menu-content', className)}
        {...rest}
      />
    </DropdownMenuPrimitive.Portal>
  )
}

export function DropdownMenuItem({
  className,
  ...rest
}: ComponentPropsWithRef<typeof DropdownMenuPrimitive.Item>) {
  return <DropdownMenuPrimitive.Item className={cn('pp-menu-item', className)} {...rest} />
}

export function DropdownMenuLabel({
  className,
  ...rest
}: ComponentPropsWithRef<typeof DropdownMenuPrimitive.Label>) {
  return (
    <DropdownMenuPrimitive.Label
      className={cn('label-mono px-2.5 py-1.5 text-muted', className)}
      {...rest}
    />
  )
}

export function DropdownMenuSeparator({
  className,
  ...rest
}: ComponentPropsWithRef<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      className={cn('my-1 h-px bg-line', className)}
      {...rest}
    />
  )
}

/* --------------------------------------------------------------- Tooltip */

export function Tooltip({ children }: { children: ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={200}>
      <TooltipPrimitive.Root>{children}</TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  )
}

export const TooltipTrigger = TooltipPrimitive.Trigger

export function TooltipContent({
  className,
  side = 'right',
  sideOffset = 8,
  children,
  ...rest
}: ComponentPropsWithRef<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        side={side}
        sideOffset={sideOffset}
        className={cn('pp-tooltip-content', className)}
        {...rest}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

/* ------------------------------------------------------------- Progress */

export function Progress({
  value = 0,
  label,
  className,
}: {
  value?: number
  label?: string
  className?: string
}) {
  const pct = Math.max(0, Math.min(100, Math.round(value)))
  return (
    <div className={cn('flex w-full flex-col gap-1.5', className)}>
      {label ? (
        <div className="flex items-baseline justify-between">
          <span className="label-mono text-muted">{label}</span>
          <span className="font-mono text-xs text-muted">{pct}%</span>
        </div>
      ) : null}
      <ProgressPrimitive.Root
        value={pct}
        className="h-1.5 w-full overflow-hidden rounded-full bg-line"
      >
        <ProgressPrimitive.Indicator
          className="h-full bg-forest transition-transform duration-200"
          style={{ transform: `translateX(-${100 - pct}%)` }}
        />
      </ProgressPrimitive.Root>
    </div>
  )
}

/* --------------------------------------------------------------- Switch */

export function Switch({
  className,
  ...rest
}: ComponentPropsWithRef<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-line',
        'transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest focus-visible:ring-offset-1 focus-visible:ring-offset-paper',
        'data-[state=checked]:border-forest data-[state=checked]:bg-forest data-[state=unchecked]:bg-cream',
        className,
      )}
      {...rest}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block h-3.5 w-3.5 translate-x-[2px] rounded-full bg-paper transition-transform duration-150 data-[state=checked]:translate-x-[18px] data-[state=unchecked]:translate-x-[2px]" />
    </SwitchPrimitive.Root>
  )
}

/* --------------------------------------------------------------- Avatar */

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function Avatar({
  name,
  className,
  size = 32,
}: {
  name: string
  className?: string
  size?: number
}) {
  return (
    <AvatarPrimitive.Root
      className={cn(
        'relative flex shrink-0 overflow-hidden rounded-full border border-line bg-cream',
        className,
      )}
      style={{ width: size, height: size }}
    >
      <AvatarPrimitive.Fallback
        delayMs={0}
        className="flex h-full w-full items-center justify-center font-mono text-[10px] font-medium tracking-wider text-forest"
      >
        {initialsOf(name)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  )
}

/* ----------------------------------------------------------------- Kbd */

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-[2px] border border-line bg-cream px-1.5 font-mono text-[11px] text-muted',
        className,
      )}
    >
      {children}
    </kbd>
  )
}

/* ----------------------------------------------------------- PageHeader */

export function PageHeader({
  overline,
  title,
  description,
  actions,
  className,
}: {
  overline?: string
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  className?: string
}) {
  return (
    <header
      className={cn(
        'flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-b border-line pb-6',
        className,
      )}
    >
      <div className="min-w-0">
        {overline ? <p className="label-mono mb-2 text-forest">{overline}</p> : null}
        <h1 className="font-display text-3xl leading-tight tracking-tight text-ink">{title}</h1>
        {description ? (
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  )
}

/* ---------------------------------------------------------------- Table */

export function Table({ className, children, ...rest }: ComponentPropsWithRef<'table'>) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn('w-full border-collapse text-left text-sm', className)} {...rest}>
        {children}
      </table>
    </div>
  )
}

export function THead({ className, children, ...rest }: ComponentPropsWithRef<'thead'>) {
  return (
    <thead className={cn('', className)} {...rest}>
      {children}
    </thead>
  )
}

export function TBody({ className, children, ...rest }: ComponentPropsWithRef<'tbody'>) {
  return (
    <tbody className={cn('', className)} {...rest}>
      {children}
    </tbody>
  )
}

export function TRow({ className, children, ...rest }: ComponentPropsWithRef<'tr'>) {
  return (
    <tr className={cn('border-b border-line transition-colors duration-150', className)} {...rest}>
      {children}
    </tr>
  )
}

export function TH({ className, children, ...rest }: ComponentPropsWithRef<'th'>) {
  return (
    <th
      className={cn('label-mono px-3 py-2.5 font-medium text-muted', className)}
      scope="col"
      {...rest}
    >
      {children}
    </th>
  )
}

export function TD({ className, children, ...rest }: ComponentPropsWithRef<'td'>) {
  return (
    <td className={cn('px-3 py-3 align-middle text-ink', className)} {...rest}>
      {children}
    </td>
  )
}
