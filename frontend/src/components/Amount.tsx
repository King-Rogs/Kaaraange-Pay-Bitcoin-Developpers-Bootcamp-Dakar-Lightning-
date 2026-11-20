import { btc, int, sats } from '../lib/format'
import { useConversions } from '../lib/market'
import { cx } from './ui'

/** Montant en sats, avec son équivalent en BTC et en FCFA affichés en même temps. */
export function Amount({ value, className, big }: { value: number; className?: string; big?: boolean }) {
  const { satsToXof } = useConversions()
  const xof = satsToXof(value)
  return (
    <span className={cx('inline-flex flex-col', className)}>
      <span className={cx('font-display font-bold tabular', big ? 'text-3xl' : 'text-base')}>
        {sats(value)} <span className={cx('font-sans font-semibold text-muted', big ? 'text-base' : 'text-xs')}>sats</span>
      </span>
      <span className={cx('tabular text-muted', big ? 'text-sm' : 'text-xs')}>
        {btc(value)} BTC{xof != null ? ` · ≈ ${int(xof)} FCFA` : ''}
      </span>
    </span>
  )
}
