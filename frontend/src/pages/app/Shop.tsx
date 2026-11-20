import { AnimatePresence, motion } from 'framer-motion'
import { Camera, MapPin, Package, Plus, RotateCcw, Store, Trash2, Undo2 } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import { Amount } from '../../components/Amount'
import { ICONS, MapPicker } from '../../components/Maps'
import { Avatar, Button, EmptyState, Field, StatusBadge } from '../../components/ui'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { api, ApiError, type Article, type Order } from '../../lib/api'
import { btc, int } from '../../lib/format'
import { useConversions } from '../../lib/market'
import { usePoll } from '../../lib/usePoll'
import { PageHeader } from './AppLayout'

const REFUNDABLE = ['awaiting_payment', 'searching_courier', 'assigned', 'picked_up']

export default function Shop() {
  const toast = useToast()
  const { user, refresh } = useAuth()
  const { data: articles, reload: reloadArticles } = usePoll<{ articles: Article[] }>('/api/articles?mine=1', 10000)
  const { data: orders, reload: reloadOrders } = usePoll<{ orders: Order[] }>('/api/orders?scope=seller', 3000)
  const { satsToXof } = useConversions()
  const [form, setForm] = useState({ title: '', description: '', price: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [addr, setAddr] = useState(user?.shop?.address ?? '')
  const [savingShop, setSavingShop] = useState(false)
  const [refundTarget, setRefundTarget] = useState<Order | null>(null)

  async function saveShop(lat: number, lng: number) {
    setSavingShop(true)
    try {
      await api('/api/me', { method: 'PATCH', body: { shop: { lat, lng, address: addr } } })
      await refresh()
      toast('Position de la boutique enregistrée')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Erreur', 'error')
    } finally {
      setSavingShop(false)
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault()
    if (!user?.shop) {
      toast('Placez d’abord votre boutique sur la carte.', 'error')
      return
    }
    setBusy(true)
    setErrors({})
    try {
      await api('/api/articles', { body: { title: form.title, description: form.description, price_sat: Number(form.price) } })
      setForm({ title: '', description: '', price: '' })
      toast('Article mis en vente')
      reloadArticles()
    } catch (err) {
      if (err instanceof ApiError && err.field) setErrors({ [err.field]: err.message })
      else toast(err instanceof Error ? err.message : 'Erreur', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: number) {
    try {
      await api(`/api/articles/${id}`, { method: 'DELETE' })
      toast('Article retiré')
      reloadArticles()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Erreur', 'error')
    }
  }

  async function confirmReturn(id: number) {
    try {
      await api(`/api/orders/${id}/confirm-return`, { method: 'POST' })
      toast('Retour confirmé : le livreur a été payé pour son déplacement')
      reloadOrders()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Erreur', 'error')
    }
  }

  async function uploadImage(articleId: number, file: File) {
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) return toast('Choisissez une image PNG, JPG ou WebP', 'error')
    if (file.size > 2 * 1024 * 1024) return toast('Image trop lourde (2 Mo maximum)', 'error')
    const form = new FormData()
    form.append('image', file)
    try {
      await api(`/api/articles/${articleId}/image`, { form })
      toast('Photo mise à jour')
      reloadArticles()
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Erreur', 'error')
    }
  }

  const xof = satsToXof(Number(form.price) || 0)
  const pendingReturns = orders?.orders.filter((o) => ['returning', 'return_pending', 'return_payment_pending'].includes(o.status)) ?? []

  return (
    <>
      <PageHeader title="Ma boutique" text="Placez votre boutique, mettez vos articles en vente et suivez vos commandes." />

      <div className="card mb-6 flex flex-col gap-4 p-6">
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand-soft text-brand"><MapPin className="h-4 w-4" /></span>
          <h2 className="text-lg font-bold">Position de la boutique</h2>
        </div>
        <p className="text-sm text-muted">Cliquez sur la carte pour placer le point : il sert à calculer les frais de livraison de tous vos articles.</p>
        <MapPicker value={user?.shop ? { lat: user.shop.lat, lng: user.shop.lng } : null} onChange={saveShop} icon={ICONS.shop} />
        <div className="flex flex-wrap items-end gap-3">
          <Field
            label="Adresse (facultatif)"
            value={addr}
            onChange={(e) => setAddr(e.target.value)}
            placeholder="Médina, Dakar"
            className="min-w-[240px] flex-1"
            onBlur={() => user?.shop && addr !== user.shop.address && saveShop(user.shop.lat, user.shop.lng)}
          />
          {savingShop && <span className="pb-3 text-sm text-muted">Enregistrement…</span>}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[380px_1fr]">
        <form onSubmit={add} className="card flex h-fit flex-col gap-5 p-6">
          <h2 className="text-lg font-bold">Nouvel article</h2>
          <Field label="Titre de l’article" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Boubou bazin brodé" error={errors.title} />
          <Field label="Description (facultatif)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Taille L, bleu nuit" />
          <Field
            label="Prix"
            inputMode="numeric"
            value={form.price}
            onChange={(e) => setForm({ ...form, price: e.target.value.replace(/\D/g, '') })}
            placeholder="25000"
            error={errors.price_sat}
            trailing={<span className="text-sm font-semibold text-btc-ink">sats</span>}
            hint={form.price ? `${btc(Number(form.price))} BTC${xof != null ? ` · ≈ ${int(xof)} FCFA au cours actuel` : ''}` : 'Le prix est fixé en satoshis.'}
          />
          <Button type="submit" loading={busy}>
            <Plus className="h-4 w-4" /> Mettre en vente
          </Button>
        </form>

        <div className="flex flex-col gap-6">
          {pendingReturns.length > 0 && (
            <section className="card border-danger/30 p-6">
              <h2 className="flex items-center gap-2 text-lg font-bold text-danger"><RotateCcw className="h-5 w-5" /> Retours à confirmer</h2>
              <p className="mt-1 text-sm text-muted">Le livreur rapporte le colis. Confirmez la réception pour le libérer et le payer pour son déplacement.</p>
              <div className="mt-4 flex flex-col gap-3">
                {pendingReturns.map((o) => (
                  <div key={o.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line p-4">
                    <div>
                      <p className="font-semibold">{o.title}</p>
                      <p className="text-xs text-muted">
                        {o.return_cause === 'refus' ? `Refusé : ${o.refuse_reason_label}` : o.return_cause === 'vendeur' ? 'Retour que vous avez demandé' : o.return_cause === 'abandon' ? 'Livreur indisponible' : 'Client absent'} · livreur {o.courier?.name}
                      </p>
                    </div>
                    {o.status === 'returning' ? (
                      <Button size="sm" onClick={() => confirmReturn(o.id)}>
                        <RotateCcw className="h-3.5 w-3.5" /> Confirmer le retour
                      </Button>
                    ) : (
                      <span className="rounded-full bg-warn-soft px-2.5 py-1 text-xs font-semibold text-warn">Confirmation en cours</span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="card p-6">
            <h2 className="text-lg font-bold">Commandes reçues</h2>
            {!orders?.orders.length ? (
              <div className="mt-4">
                <EmptyState icon={<Package />} title="Pas encore de commande" text="Quand un client achète, la commande apparaît ici avec le statut du paiement et de la livraison." />
              </div>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wider text-muted">
                      <th className="pb-3 font-semibold">Client</th>
                      <th className="pb-3 font-semibold">Article</th>
                      <th className="pb-3 font-semibold">Montant</th>
                      <th className="pb-3 font-semibold">Statut</th>
                      <th className="pb-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {orders.orders.map((o) => (
                      <tr key={o.id}>
                        <td className="py-4 pr-4">
                          <div className="flex items-center gap-3">
                            <Avatar name={o.buyer?.name ?? '?'} url={o.buyer?.avatar_url} size={34} />
                            <div className="flex flex-col">
                              <span className="font-semibold">{o.buyer?.name}</span>
                              <span className="text-xs text-muted">{o.delivery.address}</span>
                            </div>
                          </div>
                        </td>
                        <td className="py-4 pr-4">{o.title}</td>
                        <td className="py-4 pr-4">
                          <Amount value={o.item_sat} />
                        </td>
                        <td className="py-4 pr-4">
                          <StatusBadge status={o.status} />
                        </td>
                        <td className="py-4 text-right">
                          {REFUNDABLE.includes(o.status) && (
                            <Button size="sm" variant="danger" onClick={() => setRefundTarget(o)}>
                              <Undo2 className="h-3.5 w-3.5" /> Rembourser
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card p-6">
            <h2 className="text-lg font-bold">Mes articles</h2>
            {!articles?.articles.length ? (
              <div className="mt-4">
                <EmptyState icon={<Store />} title="Votre boutique est vide" text="Ajoutez votre premier article avec le formulaire." />
              </div>
            ) : (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {articles.articles.map((a) => (
                  <ArticleCard key={a.id} article={a} onRemove={() => remove(a.id)} onUpload={(f) => uploadImage(a.id, f)} />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      <AnimatePresence>{refundTarget && <RefundModal order={refundTarget} onClose={() => setRefundTarget(null)} onDone={reloadOrders} />}</AnimatePresence>
    </>
  )
}

function ArticleCard({ article: a, onRemove, onUpload }: { article: Article; onRemove: () => void; onUpload: (f: File) => void }) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <div className="flex items-start gap-3 rounded-xl border border-line p-4">
      <button
        type="button"
        onClick={() => input.current?.click()}
        className="group relative grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-lg bg-subtle"
        aria-label={`Changer la photo de ${a.title}`}
      >
        {a.image_url ? <img src={a.image_url} alt="" className="h-full w-full object-cover" /> : <Store className="h-6 w-6 text-muted" />}
        <span className="absolute inset-0 grid place-items-center bg-black/0 opacity-0 transition group-hover:bg-black/40 group-hover:opacity-100">
          <Camera className="h-4 w-4 text-white" />
        </span>
      </button>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) onUpload(f)
          e.target.value = ''
        }}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate font-semibold">{a.title}</span>
        {a.description && <span className="truncate text-xs text-muted">{a.description}</span>}
        <Amount value={a.price_sat} className="mt-1" />
        {a.rating.count > 0 && <span className="text-xs text-muted">Note produit : {a.rating.avg}/5 ({a.rating.count})</span>}
      </div>
      <button onClick={onRemove} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-danger-soft hover:text-danger" aria-label={`Retirer ${a.title}`}>
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  )
}

function RefundModal({ order: o, onClose, onDone }: { order: Order; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const afterPickup = o.status === 'picked_up'

  async function submit() {
    if (!reason) return
    setBusy(true)
    try {
      const r = await api<{ order: Order }>(`/api/orders/${o.id}/refund`, { body: { reason } })
      toast(r.order.financial_pending ? 'Remboursement enregistré, confirmation en cours' : afterPickup ? 'Retour demandé : le livreur rapportera le colis' : 'Commande remboursée')
      onDone()
      onClose()
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Erreur', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl bg-surface p-6">
        <h3 className="text-lg font-bold">Rembourser « {o.title} »</h3>
        <p className="mt-1 text-sm text-muted">
          {afterPickup
            ? 'Le colis est déjà en livraison : le livreur devra le rapporter. Le prix est remboursé immédiatement, les frais de livraison restent dus au livreur.'
            : 'La commande sera annulée et intégralement remboursée à l’acheteur.'}
        </p>
        <Field label="Motif (obligatoire)" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Article en rupture de stock" className="mt-4" />
        <div className="mt-5 grid grid-cols-2 gap-3">
          <Button variant="secondary" onClick={onClose}>Annuler</Button>
          <Button variant="danger" loading={busy} disabled={!reason} onClick={submit}>Confirmer</Button>
        </div>
      </motion.div>
    </motion.div>
  )
}
