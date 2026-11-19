import { Check, Copy, GraduationCap, Terminal } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { cx } from './ui'

export function useCopy() {
  const [copied, setCopied] = useState<string | null>(null)
  const copy = (text: string) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(text)
      window.setTimeout(() => setCopied(null), 1500)
    })
  }
  return { copied, copy }
}

/** Valeur technique (hash, txid, adresse, pubkey) en police mono, tronquée, copiable. */
export function Mono({ value, short = true, className, label }: { value: string; short?: boolean; className?: string; label?: string }) {
  const { copied, copy } = useCopy()
  const shown = short && value.length > 22 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value
  return (
    <span className={cx('inline-flex min-w-0 items-center gap-1.5', className)}>
      <code className={cx('min-w-0 font-mono text-[12.5px]', !short && 'break-all')} title={value}>
        {shown}
      </code>
      <button
        type="button"
        onClick={() => copy(value)}
        className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted transition hover:bg-subtle hover:text-fg"
        aria-label={`Copier ${label ?? 'la valeur'}`}
      >
        {copied === value ? <Check className="h-3.5 w-3.5 text-brand" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </span>
  )
}

/** La commande bitcoin-cli / lncli équivalente à ce que fait l'interface. */
export function Cli({ cmd, className }: { cmd: string; className?: string }) {
  const { copied, copy } = useCopy()
  return (
    <div className={cx('group flex items-start gap-2.5 rounded-xl bg-[#0B110E] px-3.5 py-2.5 font-mono text-[12px] leading-relaxed text-[#C9D6CE] ring-1 ring-white/5', className)}>
      <Terminal className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#5BE39A]" aria-hidden />
      <code className="min-w-0 flex-1 whitespace-pre-wrap break-all">
        <span className="text-[#5BE39A]">$ </span>
        {cmd}
      </code>
      <button type="button" onClick={() => copy(cmd)} className="shrink-0 text-white/40 transition hover:text-white" aria-label="Copier la commande">
        {copied === cmd ? <Check className="h-3.5 w-3.5 text-[#5BE39A]" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  )
}

/** Encadré « notion du bootcamp ». */
export function Concept({ title, children, to }: { title: string; children: ReactNode; to?: string }) {
  return (
    <div className="flex gap-3 rounded-xl border border-btc/25 bg-btc-soft/60 p-3.5 text-sm">
      <GraduationCap className="mt-0.5 h-4 w-4 shrink-0 text-btc-ink" aria-hidden />
      <div className="flex flex-col gap-1 leading-relaxed">
        <span className="font-semibold text-btc-ink">{title}</span>
        <span className="text-fg/80">{children}</span>
        {to && (
          <Link to={to} className="w-fit text-xs font-semibold text-btc-ink underline-offset-2 hover:underline">
            En savoir plus dans l’Académie →
          </Link>
        )}
      </div>
    </div>
  )
}

export function SectionCard({ title, icon, children, className, action }: { title: string; icon?: ReactNode; children: ReactNode; className?: string; action?: ReactNode }) {
  return (
    <section className={cx('card flex flex-col gap-5 p-6', className)}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2.5 text-lg font-bold">
          {icon && <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-soft text-brand [&>svg]:h-4 [&>svg]:w-4">{icon}</span>}
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  )
}

export const btc = (n: number) => `${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 8 })} BTC`

export async function sha256Hex(hex: string) {
  const bytes = new Uint8Array(hex.match(/.{2}/g)!.map((b) => parseInt(b, 16)))
  const d = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
