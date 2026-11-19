import { MapPin, Package, Plus, RotateCcw, Store, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Amount } from '../../components/Amount'
import { Concept } from '../../components/Tech'
import { ICONS, MapPicker } from '../../components/Maps'
import { Avatar, Button, EmptyState, Field, StatusBadge } from '../../components/ui'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { api, ApiError, type Article, type Order } from '../../lib/api'
import { int } from '../../lib/format'
import { useConversions } from '../../lib/market'
import { usePoll } from '../../lib/usePoll'
import { PageHeader } from './AppLayout'

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

  const xof = satsToXof(Number(form.price) || 0)
  const pendingReturns = orders?.orders.filter((o) => o.status === 'returning') ?? []

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
            hint={xof != null && form.price ? `≈ ${int(xof)} FCFA au cours actuel` : 'Le prix est fixé en satoshis.'}
          />
          <Button type="submit" loading={busy}>
            <Plus className="h-4 w-4" /> Mettre en vente
          </Button>
          <Concept title="Pourquoi une boutique sur la carte ?" to="/app/academie">
            Les frais de livraison sont calculés par la distance réelle entre votre boutique et le client (haversine × facteur de route), convertie en sats au cours du moment.
          </Concept>
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
                      <p className="text-xs text-muted">{o.return_cause === 'refus' ? `Refusé : ${o.refuse_reason_label}` : 'Client absent'} · livreur {o.courier?.name}</p>
                    </div>
                    <Button size="sm" onClick={() => confirmReturn(o.id)}>
                      <RotateCcw className="h-3.5 w-3.5" /> Confirmer le retour
                    </Button>
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
                  <div key={a.id} className="flex items-start justify-between gap-3 rounded-xl border border-line p-4">
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="truncate font-semibold">{a.title}</span>
                      {a.description && <span className="truncate text-xs text-muted">{a.description}</span>}
                      <Amount value={a.price_sat} className="mt-1" />
                    </div>
                    <button onClick={() => remove(a.id)} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-danger-soft hover:text-danger" aria-label={`Retirer ${a.title}`}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </>
  )
}
