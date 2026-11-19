import { motion, AnimatePresence } from 'framer-motion'
import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import { useId, useState } from 'react'
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useHistory, useMarket, type Range } from '../lib/market'
import { pct, usd } from '../lib/format'
import { cx, Spinner } from './ui'

export function LiveDot({ className, compact }: { className?: string; compact?: boolean }) {
  const { status } = useMarket()
  const label = { live: 'En direct', polling: 'Actualisé toutes les 15 s', connecting: 'Connexion…', offline: 'Hors ligne' }[status]
  const color = status === 'live' ? 'bg-up' : status === 'offline' ? 'bg-down' : 'bg-warn'
  return (
    <span className={cx('inline-flex items-center gap-2 text-xs font-medium text-muted', className)}>
      <span className="relative flex h-2 w-2">
        {status === 'live' && <span className={cx('absolute inline-flex h-full w-full animate-ping rounded-full opacity-60', color)} />}
        <span className={cx('relative inline-flex h-2 w-2 rounded-full', color)} />
      </span>
      {compact ? <span className="sr-only">{label}</span> : label}
    </span>
  )
}

/** Prix qui « clignote » en vert ou rouge à chaque variation. */
export function LivePrice({ className }: { className?: string }) {
  const { ticker, dir } = useMarket()
  if (!ticker) return <span className={cx('inline-block h-[1em] w-40 animate-pulse rounded bg-subtle', className)} />
  return (
    <span className={cx('relative inline-block tabular', className)}>
      <AnimatePresence initial={false}>
        <motion.span
          key={ticker.price}
          initial={{ color: dir === 'up' ? 'rgb(var(--up))' : dir === 'down' ? 'rgb(var(--down))' : 'rgb(var(--fg))' }}
          animate={{ color: 'rgb(var(--fg))' }}
          transition={{ duration: 1.2 }}
        >
          {usd(ticker.price)}
        </motion.span>
      </AnimatePresence>
    </span>
  )
}

export function ChangePill({ value, className }: { value: number | undefined; className?: string }) {
  if (value == null) return null
  const up = value >= 0
  const Icon = up ? ArrowUpRight : ArrowDownRight
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold tabular',
        up ? 'bg-up/10 text-up' : 'bg-down/10 text-down',
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {pct(value)}
    </span>
  )
}

const RANGES: Range[] = ['1H', '24H', '7J', '30J']

export function RangeTabs({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  return (
    <div role="tablist" aria-label="Période" className="inline-flex rounded-xl border border-line bg-subtle p-1">
      {RANGES.map((r) => (
        <button
          key={r}
          role="tab"
          aria-selected={value === r}
          onClick={() => onChange(r)}
          className={cx(
            'relative h-8 min-w-[44px] rounded-lg px-3 text-xs font-semibold transition',
            value === r ? 'text-fg' : 'text-muted hover:text-fg',
          )}
        >
          {value === r && <motion.span layoutId="range-pill" className="absolute inset-0 rounded-lg bg-surface shadow-sm" transition={{ type: 'spring', duration: 0.35 }} />}
          <span className="relative">{r}</span>
        </button>
      ))}
    </div>
  )
}

function fmtTick(t: number, range: Range) {
  const d = new Date(t)
  if (range === '1H' || range === '24H') return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
}

export function PriceChart({ range, height = 300, axes = true }: { range: Range; height?: number; axes?: boolean }) {
  const { points, loading } = useHistory(range)
  const gid = useId().replace(/:/g, '')
  const up = points.length > 1 ? points[points.length - 1]!.p >= points[0]!.p : true
  const stroke = up ? 'rgb(var(--up))' : 'rgb(var(--down))'

  if (loading && !points.length) {
    return (
      <div className="grid place-items-center" style={{ height }}>
        <Spinner />
      </div>
    )
  }
  if (!points.length) {
    return (
      <div className="grid place-items-center text-sm text-muted" style={{ height }}>
        Données de marché indisponibles pour le moment.
      </div>
    )
  }
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 8, right: axes ? 4 : 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.22} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          {axes && (
            <XAxis
              dataKey="t"
              tickFormatter={(t) => fmtTick(t, range)}
              tick={{ fill: 'rgb(var(--muted))', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              minTickGap={48}
            />
          )}
          <YAxis
            hide={!axes}
            orientation="right"
            domain={['dataMin - 50', 'dataMax + 50']}
            tick={{ fill: 'rgb(var(--muted))', fontSize: 11 }}
            tickFormatter={(v: number) => `${Math.round(v / 1000)}k`}
            axisLine={false}
            tickLine={false}
            width={40}
          />
          <Tooltip
            cursor={{ stroke: 'rgb(var(--line))', strokeWidth: 1 }}
            content={({ active, payload }) =>
              active && payload?.length ? (
                <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-card">
                  <div className="font-semibold tabular">{usd(payload[0]!.payload.p)}</div>
                  <div className="text-muted">
                    {new Date(payload[0]!.payload.t).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })}
                  </div>
                </div>
              ) : null
            }
          />
          <Area type="monotone" dataKey="p" stroke={stroke} strokeWidth={2} fill={`url(#${gid})`} isAnimationActive={false} dot={false} activeDot={{ r: 4, strokeWidth: 0, fill: stroke }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Petite carte « BTC en direct » réutilisable. */
export function MiniTicker({ className }: { className?: string }) {
  const { ticker } = useMarket()
  const [range] = useState<Range>('1H')
  return (
    <div className={cx('card flex flex-col gap-3 p-4', className)}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold text-muted">BTC / USD</span>
        <LiveDot compact />
      </div>
      <div className="flex items-baseline justify-between gap-2">
        <LivePrice className="whitespace-nowrap font-display text-xl font-bold" />
        <ChangePill value={ticker?.changePct} />
      </div>
      <PriceChart range={range} height={70} axes={false} />
    </div>
  )
}
