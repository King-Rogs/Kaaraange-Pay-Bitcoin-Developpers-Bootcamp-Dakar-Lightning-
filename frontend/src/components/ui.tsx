import { Loader2, Eye, EyeOff } from 'lucide-react'
import { forwardRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { OrderStatus } from '../lib/api'
import { initials } from '../lib/format'

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'dark' | 'invert'
type Size = 'sm' | 'md' | 'lg'

const variants: Record<Variant, string> = {
  primary: 'bg-brand text-brand-fg hover:bg-brand-strong shadow-sm',
  secondary: 'border border-line bg-surface text-fg hover:bg-subtle',
  ghost: 'text-fg hover:bg-subtle',
  danger: 'bg-danger-soft text-danger hover:brightness-95',
  dark: 'bg-fg text-bg hover:opacity-90',
  // Bouton blanc à contraste fixe (indépendant du thème clair/sombre) : pour un fond coloré (bannière d'appel à l'action).
  invert: 'bg-white text-[#075C31] hover:bg-white/90 shadow-sm',
}
const sizes: Record<Size, string> = {
  sm: 'h-9 px-3.5 text-sm gap-1.5 rounded-lg',
  md: 'h-11 px-5 text-sm gap-2 rounded-xl',
  lg: 'h-12 px-6 text-[15px] gap-2 rounded-xl',
}

export function btnClass(variant: Variant = 'primary', size: Size = 'md', extra = '') {
  return cx(
    'inline-flex select-none items-center justify-center font-semibold transition disabled:pointer-events-none disabled:opacity-50',
    variants[variant],
    sizes[size],
    extra,
  )
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean }

export function Button({ variant = 'primary', size = 'md', loading, className, children, disabled, ...rest }: BtnProps) {
  return (
    <button className={btnClass(variant, size, className)} disabled={disabled || loading} {...rest}>
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  )
}

export function LinkButton({ to, variant = 'primary', size = 'md', className, children }: { to: string; variant?: Variant; size?: Size; className?: string; children: ReactNode }) {
  return (
    <Link to={to} className={btnClass(variant, size, className)}>
      {children}
    </Link>
  )
}

type FieldProps = InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: ReactNode; icon?: ReactNode; trailing?: ReactNode }

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, error, hint, icon, trailing, id, className, type, ...rest },
  ref,
) {
  const [show, setShow] = useState(false)
  const inputId = id ?? `f-${label.replace(/\W+/g, '-').toLowerCase()}`
  const isPw = type === 'password'
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={inputId} className="text-sm font-medium">
        {label}
      </label>
      <div
        className={cx(
          'flex h-12 items-center gap-2.5 rounded-xl border bg-surface px-3.5 transition focus-within:ring-4',
          error ? 'border-danger focus-within:ring-danger/15' : 'border-line focus-within:border-brand focus-within:ring-brand/15',
        )}
      >
        {icon && <span className="text-muted [&>svg]:h-[18px] [&>svg]:w-[18px]">{icon}</span>}
        <input
          ref={ref}
          id={inputId}
          type={isPw && show ? 'text' : type}
          aria-invalid={!!error}
          aria-describedby={error ? `${inputId}-err` : undefined}
          className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted/70"
          {...rest}
        />
        {isPw && (
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="-mr-1 grid h-9 w-9 place-items-center rounded-lg text-muted hover:bg-subtle hover:text-fg"
            aria-label={show ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
          >
            {show ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
          </button>
        )}
        {trailing}
      </div>
      {error ? (
        <p id={`${inputId}-err`} className="text-[13px] text-danger">
          {error}
        </p>
      ) : (
        hint && <p className="text-[13px] text-muted">{hint}</p>
      )}
    </div>
  )
})

const STATUS: Record<OrderStatus, { label: string; cls: string; pulse?: boolean }> = {
  awaiting_payment: { label: 'En attente de paiement', cls: 'bg-subtle text-muted' },
  searching_courier: { label: 'Recherche d’un livreur', cls: 'bg-warn-soft text-warn' },
  assigned: { label: 'Livreur en route', cls: 'bg-warn-soft text-warn' },
  picked_up: { label: 'Colis en livraison', cls: 'bg-warn-soft text-warn' },
  buyer_accepted: { label: 'Colis accepté · validation livreur', cls: 'bg-brand-soft text-brand' },
  delivered: { label: 'Livré · payé', cls: 'bg-brand-soft text-brand' },
  returning: { label: 'Retour en cours', cls: 'bg-danger-soft text-danger' },
  returned: { label: 'Retourné', cls: 'bg-danger-soft text-danger' },
  canceled: { label: 'Remboursé', cls: 'bg-danger-soft text-danger' },
  // États transitoires : une opération financière est enregistrée, la confirmation LND est en
  // cours (reprise automatique côté serveur). Jamais présentés comme un échec.
  cancel_pending: { label: 'Annulation en cours', cls: 'bg-warn-soft text-warn', pulse: true },
  delivery_pending: { label: 'Règlement en cours', cls: 'bg-warn-soft text-warn', pulse: true },
  return_pending: { label: 'Retour en préparation', cls: 'bg-warn-soft text-warn', pulse: true },
  return_payment_pending: { label: 'Retour : confirmation en cours', cls: 'bg-warn-soft text-warn', pulse: true },
}

export function StatusBadge({ status }: { status: OrderStatus }) {
  const s = STATUS[status] ?? { label: status, cls: 'bg-subtle text-muted' }
  return (
    <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold', s.cls)}>
      <span className={cx('h-1.5 w-1.5 rounded-full bg-current', s.pulse && 'animate-pulseDot')} aria-hidden />
      {s.label}
    </span>
  )
}

export function Avatar({ name, url, size = 40, className }: { name: string; url?: string | null; size?: number; className?: string }) {
  return url ? (
    <img src={url} alt="" width={size} height={size} className={cx('shrink-0 rounded-full object-cover', className)} style={{ width: size, height: size }} />
  ) : (
    <span
      aria-hidden
      className={cx('grid shrink-0 place-items-center rounded-full bg-brand-soft font-display font-bold text-brand', className)}
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initials(name)}
    </span>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('h-5 w-5 animate-spin text-muted', className)} aria-label="Chargement" />
}

export function EmptyState({ icon, title, text, action }: { icon: ReactNode; title: string; text: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line px-6 py-12 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-subtle text-muted [&>svg]:h-6 [&>svg]:w-6">{icon}</span>
      <div className="flex flex-col gap-1">
        <p className="font-semibold">{title}</p>
        <p className="max-w-sm text-sm text-muted">{text}</p>
      </div>
      {action}
    </div>
  )
}
