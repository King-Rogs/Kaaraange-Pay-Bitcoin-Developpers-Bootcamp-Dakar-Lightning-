import { AnimatePresence, motion } from 'framer-motion'
import { Lock, MapPin, Search, ShieldCheck, ShoppingBag, Star, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Amount } from '../../components/Amount'
import { Concept } from '../../components/Tech'
import { ICONS, MapPicker } from '../../components/Maps'
import { Avatar, Button, EmptyState, Field, Spinner } from '../../components/ui'
import { useToast } from '../../context/ToastContext'
import { api, ApiError, type Article, type Quote } from '../../lib/api'
import { int } from '../../lib/format'
import { newDeliverySecret, saveCode } from '../../lib/secrets'
import { usePoll } from '../../lib/usePoll'
import { PageHeader } from './AppLayout'

export default function Buy() {
  const { data } = usePoll<{ articles: Article[] }>('/api/articles', 10000)
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<Article | null>(null)

  const filtered = useMemo(() => {
    const list = data?.articles ?? []
    const needle = q.trim().toLowerCase()
    return needle ? list.filter((a) => `${a.title} ${a.seller.name} ${a.seller.shop_name}`.toLowerCase().includes(needle)) : list
  }, [data, q])

  return (
    <>
      <PageHeader title="Acheter" text="Parcourez les articles disponibles. Chaque paiement bloque les fonds jusqu’à la livraison." />
      <Field label="Rechercher" icon={<Search className="h-4 w-4" />} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom d’article, boutique, vendeur…" className="mb-6 max-w-md" />

      {!data ? (
        <div className="grid h-40 place-items-center">
          <Spinner />
        </div>
      ) : !filtered.length ? (
        <EmptyState icon={<ShoppingBag />} title="Aucun article" text="Revenez plus tard : les vendeurs ajoutent régulièrement de nouveaux articles." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((a, i) => (
            <motion.button
              key={a.id}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i, 8) * 0.03 }}
              onClick={() => setPicked(a)}
              className="card flex flex-col gap-4 p-5 text-left transition hover:border-brand/40 hover:shadow-card"
            >
              {a.image_url ? (
                <img src={a.image_url} alt="" className="h-32 w-full rounded-xl object-cover" />
              ) : (
                <div className="flex h-32 items-center justify-center rounded-xl bg-gradient-to-br from-brand-soft to-btc-soft text-4xl font-display font-bold text-brand/70">
                  {a.title.slice(0, 1).toUpperCase()}
                </div>
              )}
              <div className="flex flex-col gap-1">
                <span className="line-clamp-1 font-semibold">{a.title}</span>
                {a.description && <span className="line-clamp-2 text-xs text-muted">{a.description}</span>}
                {a.rating.count > 0 && (
                  <span className="flex items-center gap-1 text-[11px] text-muted">
                    <Star className="h-3 w-3 fill-warn text-warn" /> {a.rating.avg} ({a.rating.count} avis produit)
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Avatar name={a.seller.shop_name || a.seller.name} url={a.seller.avatar_url} size={28} />
                  <div className="flex flex-col">
                    <span className="truncate text-xs font-semibold">{a.seller.shop_name || a.seller.name}</span>
                    {a.seller.rating?.count ? (
                      <span className="flex items-center gap-1 text-[11px] text-muted">
                        <Star className="h-3 w-3 fill-warn text-warn" /> {a.seller.rating.avg}
                      </span>
                    ) : (
                      <span className="text-[11px] text-muted">Nouveau vendeur</span>
                    )}
                  </div>
                </div>
              </div>
              <Amount value={a.price_sat} big />
            </motion.button>
          ))}
        </div>
      )}

      <AnimatePresence>{picked && <OrderModal article={picked} onClose={() => setPicked(null)} />}</AnimatePresence>
    </>
  )
}

function OrderModal({ article, onClose }: { article: Article; onClose: () => void }) {
  const toast = useToast()
  const nav = useNavigate()
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(null)
  const [address, setAddress] = useState('')
  const [quote, setQuote] = useState<Quote | null>(null)
  const [loadingQuote, setLoadingQuote] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function pick(lat: number, lng: number) {
    setPoint({ lat, lng })
    setLoadingQuote(true)
    setError(null)
    try {
      setQuote(await api<Quote>('/api/quote', { body: { article_id: article.id, lat, lng } }))
    } catch (err) {
      setQuote(null)
      setError(err instanceof Error ? err.message : 'Erreur')
    } finally {
      setLoadingQuote(false)
    }
  }

  async function confirm() {
    if (!point) return
    setBusy(true)
    setError(null)
    try {
      const { preimage, hash } = await newDeliverySecret()
      const order = await api<{ order: { id: number } }>('/api/orders', { body: { article_id: article.id, lat: point.lat, lng: point.lng, address, item_hash: hash } })
      saveCode(String(order.order.id), preimage)
      const paid = await api<{ order: { status: string; financial_pending: boolean } }>(`/api/orders/${order.order.id}/pay`, { method: 'POST' })
      toast(paid.order.financial_pending ? 'Paiement envoyé : confirmation Lightning en cours' : 'Commande payée : fonds bloqués jusqu’à la livraison')
      nav('/app/achats')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur inattendue')
    } finally {
      setBusy(false)
    }
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-6" onClick={onClose}>
      <motion.div
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 20, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-y-auto rounded-t-3xl bg-surface p-6 sm:rounded-3xl sm:p-7"
      >
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold">{article.title}</h2>
            <p className="text-sm text-muted">Vendu par {article.seller.shop_name || article.seller.name}</p>
          </div>
          <button onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg hover:bg-subtle" aria-label="Fermer">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2 text-sm font-semibold"><MapPin className="h-4 w-4 text-brand" /> Où livrer ?</div>
          <MapPicker value={point} onChange={pick} icon={ICONS.delivery} height={240} />
          <Field label="Adresse (facultatif, précise au livreur)" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Près de la mosquée, Plateau" />

          {error && <p className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">{error}</p>}

          {loadingQuote ? (
            <div className="flex items-center gap-2 text-sm text-muted">
              <Spinner className="h-4 w-4" /> Calcul du devis…
            </div>
          ) : quote ? (
            <div className="flex flex-col gap-3 rounded-2xl border border-line bg-subtle p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted">Distance estimée</span>
                <span className="font-semibold">{quote.distance_km.toLocaleString('fr-FR')} km</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted">Frais de livraison</span>
                <span className="font-semibold">{int(quote.fee_xof)} FCFA</span>
              </div>
              <div className="h-px bg-line" />
              <div className="flex items-center justify-between">
                <span className="font-semibold">Total à payer</span>
                <Amount value={quote.total_sat} />
              </div>
            </div>
          ) : point ? (
            <p className="text-sm text-danger">Devis indisponible pour ce point.</p>
          ) : (
            <p className="text-sm text-muted">Cliquez sur la carte pour estimer les frais.</p>
          )}

          <Concept title="Deux factures, un seul paiement" to="/app/academie">
            Le paiement bloque deux factures Lightning distinctes : une pour l’article (chez le vendeur), une pour la livraison (chez le livreur). Votre code secret, généré ici sur votre appareil, débloquera les deux d’un coup à la remise.
          </Concept>

          <Button size="lg" disabled={!quote || busy} loading={busy} onClick={confirm}>
            <Lock className="h-4 w-4" /> {quote ? `Payer ${quote.total_sat.toLocaleString('fr-FR')} sats` : 'Payer'}
          </Button>
          <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted">
            <ShieldCheck className="h-3.5 w-3.5" /> Remboursé automatiquement si le colis n’arrive jamais.
          </p>
        </div>
      </motion.div>
    </motion.div>
  )
}
