import { ArrowRight, Bike, Lock, Package, ShoppingBag, Store, Undo2, Wallet } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Amount } from '../../components/Amount'
import { BitcoinLogo } from '../../components/Logo'
import { ChangePill, LiveDot, LivePrice, PriceChart, RangeTabs } from '../../components/Market'
import { Avatar, EmptyState, StatusBadge } from '../../components/ui'
import { useAuth } from '../../context/AuthContext'
import type { Order, Stats, Wallet as WalletInfo } from '../../lib/api'
import { dateTime } from '../../lib/format'
import { useMarket, type Range } from '../../lib/market'
import { usePoll } from '../../lib/usePoll'
import { PageHeader } from './AppLayout'

export default function Overview() {
  const { user } = useAuth()
  const { data } = usePoll<{ stats: Stats; recent: Order[] }>('/api/stats', 4000)
  const { data: wallet } = usePoll<WalletInfo>('/api/wallet', 4000)
  const { ticker } = useMarket()
  const [range, setRange] = useState<Range>('24H')

  const s = data?.stats
  const hour = new Date().getHours()
  const hello = hour < 12 ? 'Bonjour' : hour < 18 ? 'Bon après-midi' : 'Bonsoir'

  const cards = [
    { label: 'Fonds bloqués (mes achats)', icon: <Lock />, tone: 'bg-warn-soft text-warn', v: s?.locked_sat, n: null },
    { label: 'Encaissé en tant que vendeur', icon: <Store />, tone: 'bg-brand-soft text-brand', v: s?.earned_seller_sat, n: s?.counts.sales },
    { label: 'Gains de livraison', icon: <Bike />, tone: 'bg-btc-soft text-btc-ink', v: s?.courier_earned_sat, n: s?.counts.deliveries },
    { label: 'Remboursé', icon: <Undo2 />, tone: 'bg-danger-soft text-danger', v: s?.refunded_sat, n: null },
  ]

  return (
    <>
      <PageHeader title={`${hello}, ${user!.name.split(' ')[0]}`} text="Voici l’état de vos ventes, achats et livraisons." />

      <Link to="/app/portefeuille" className="card relative mb-4 block overflow-hidden p-6 transition hover:border-brand/40">
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-btc/15 blur-3xl" aria-hidden />
        <p className="text-sm font-medium text-muted">Solde total du compte</p>
        <Amount value={wallet?.exists ? wallet.balances?.total_sat ?? wallet.balances?.trusted_sat ?? 0 : 0} big className="mt-2" />
      </Link>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="card flex flex-col gap-4 p-5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-muted">{c.label}</span>
              <span className={`grid h-9 w-9 place-items-center rounded-xl [&>svg]:h-[18px] [&>svg]:w-[18px] ${c.tone}`}>{c.icon}</span>
            </div>
            <Amount value={c.v ?? 0} big />
            <span className="text-xs text-muted">{c.n != null ? `${c.n} commande${c.n > 1 ? 's' : ''}` : ' '}</span>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1.4fr_1fr]">
        <div className="card flex flex-col gap-5 p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <BitcoinLogo size={40} />
              <div className="flex flex-col">
                <div className="flex items-center gap-3">
                  <LivePrice className="font-display text-2xl font-bold" />
                  <ChangePill value={ticker?.changePct} />
                </div>
                <LiveDot />
              </div>
            </div>
            <RangeTabs value={range} onChange={setRange} />
          </div>
          <PriceChart range={range} height={260} />
        </div>

        <div className="card flex flex-col p-6">
          <h2 className="text-lg font-bold">Actions rapides</h2>
          <div className="mt-4 flex flex-col gap-2">
            {[
              { to: '/app/boutique', icon: <Store />, t: 'Mettre un article en vente', d: 'Ajoutez un produit et son prix' },
              { to: '/app/marche', icon: <ShoppingBag />, t: 'Acheter en toute sécurité', d: 'Parcourez les articles disponibles' },
              { to: '/app/livreur', icon: <Bike />, t: 'Passer en livreur', d: 'Activez-vous et recevez des offres' },
              { to: '/app/portefeuille', icon: <Wallet />, t: 'Mon portefeuille Bitcoin', d: 'Acheter, recevoir, envoyer' },
            ].map((a) => (
              <Link key={a.to} to={a.to} className="group flex items-center gap-4 rounded-xl border border-line p-4 transition hover:border-brand/40 hover:bg-subtle">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-soft text-brand [&>svg]:h-5 [&>svg]:w-5">{a.icon}</span>
                <div className="flex-1">
                  <p className="text-sm font-semibold">{a.t}</p>
                  <p className="text-xs text-muted">{a.d}</p>
                </div>
                <ArrowRight className="h-4 w-4 text-muted transition group-hover:translate-x-0.5 group-hover:text-fg" />
              </Link>
            ))}
          </div>
        </div>
      </div>

      <div className="card mt-6 p-6">
        <h2 className="text-lg font-bold">Activité récente</h2>
        {!data?.recent.length ? (
          <div className="mt-4">
            <EmptyState icon={<Package />} title="Aucune commande pour l’instant" text="Vos ventes, achats et livraisons apparaîtront ici." />
          </div>
        ) : (
          <div className="mt-4 divide-y divide-line">
            {data.recent.map((o) => {
              const other = o.role === 'seller' ? o.buyer : o.role === 'courier' ? o.buyer : o.seller
              const sub =
                o.role === 'seller' ? `Vente à ${o.buyer?.name}` : o.role === 'courier' ? `Livraison pour ${o.buyer?.name}` : `Achat chez ${o.seller?.shop_name || o.seller?.name}`
              return (
                <div key={o.id} className="flex flex-wrap items-center gap-4 py-4">
                  <Avatar name={other?.shop_name || other?.name || '?'} url={other?.avatar_url} size={40} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{o.title}</p>
                    <p className="text-sm text-muted">
                      {sub} · {dateTime(o.created_at)}
                    </p>
                  </div>
                  <Amount value={o.role === 'courier' ? o.fee_sat : o.item_sat} className="items-end" />
                  <StatusBadge status={o.status} />
                </div>
              )
            })}
          </div>
        )}
      </div>
    </>
  )
}
