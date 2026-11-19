import { cx } from '../../components/ui'
import { sats } from '../../lib/format'

/** Montant en BTC avec son équivalent en sats (bitcoins de test : pas de valeur en FCFA). */
export function Btc({ value, big, className }: { value: number; big?: boolean; className?: string }) {
  const btc = value / 1e8
  return (
    <div className={cx('flex flex-col', className)}>
      <span className={cx('font-display font-bold tabular', big ? 'text-3xl' : 'text-base')}>
        {btc.toLocaleString('fr-FR', { maximumFractionDigits: 8 })} <span className="font-sans text-base font-semibold text-btc-ink">BTC</span>
      </span>
      <span className="text-xs tabular text-muted">{sats(value)} sats · regtest</span>
    </div>
  )
}
