import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, Check, ChevronRight, Package, QrCode, Star, Truck, X } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useState } from 'react'
import { Amount } from '../../components/Amount'
import { TrackMap } from '../../components/Maps'
import { Mono, SectionCard } from '../../components/Tech'
import { Avatar, Button, EmptyState, Field, Spinner, StatusBadge } from '../../components/ui'
import { useToast } from '../../context/ToastContext'
import { api, ApiError, REFUSE_REASONS, type Order } from '../../lib/api'
import { dateTime } from '../../lib/format'
import { getCode, groupCode } from '../../lib/secrets'
import { usePoll } from '../../lib/usePoll'
import { PageHeader } from './AppLayout'

const STEPS = [
  { key: 'awaiting_payment', label: 'Commande payée' },
  { key: 'searching_courier', label: 'Recherche d’un livreur' },
  { key: 'assigned', label: 'Livreur en route' },
  { key: 'picked_up', label: 'Colis en livraison' },
  { key: 'delivered', label: 'Livré' },
]
// 'delivery_pending' : la remise a été enregistrée, la confirmation Lightning est en cours —
// on la montre comme « Livré » en attente plutôt que de masquer le suivi.
const stepIndex = (o: Order) => {
  if (['returning', 'return_pending', 'returned', 'return_payment_pending', 'canceled', 'cancel_pending'].includes(o.status)) return -1
  if (o.status === 'delivery_pending') return STEPS.length - 1
  return STEPS.findIndex((s) => s.key === o.status)
}

export default function Purchases() {
  const { data, reload } = usePoll<{ orders: Order[] }>('/api/orders?scope=buyer', 2500)
  const [selected, setSelected] = useState<number | null>(null)
  const order = data?.orders.find((o) => o.id === selected) ?? null

  if (!data) return <div className="grid h-40 place-items-center"><Spinner /></div>

  if (selected && order) return <OrderDetail order={order} onBack={() => setSelected(null)} onChange={reload} />

  return (
    <>
      <PageHeader title="Mes achats" text="Vos commandes, du paiement à la livraison." />
      {!data.orders.length ? (
        <EmptyState icon={<Package />} title="Aucun achat" text="Vos commandes apparaîtront ici après votre premier achat." />
      ) : (
        <div className="flex flex-col divide-y divide-line rounded-2xl border border-line bg-surface">
          {data.orders.map((o) => (
            <button key={o.id} onClick={() => setSelected(o.id)} className="flex items-center gap-4 p-4 text-left transition hover:bg-subtle sm:p-5">
              <Avatar name={o.seller?.shop_name || o.seller?.name || '?'} url={o.seller?.avatar_url} size={42} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{o.title}</p>
                <p className="truncate text-sm text-muted">{o.seller?.shop_name || o.seller?.name} · {dateTime(o.created_at)}</p>
              </div>
              <Amount value={o.total_sat} className="items-end" />
              <StatusBadge status={o.status} />
              <ChevronRight className="h-4 w-4 shrink-0 text-muted" />
            </button>
          ))}
        </div>
      )}
    </>
  )
}

function Tracker({ order }: { order: Order }) {
  const idx = stepIndex(order)
  if (idx < 0) return null
  const pendingLast = order.status === 'delivery_pending'
  return (
    <div className="flex items-center">
      {STEPS.map((s, i) => {
        const isLastPending = pendingLast && i === idx
        return (
          <div key={s.key} className="flex flex-1 items-center last:flex-none">
            <div className="flex flex-col items-center gap-1.5 text-center">
              <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${isLastPending ? 'bg-warn-soft text-warn' : i <= idx ? 'bg-brand text-brand-fg' : 'border-2 border-line text-muted'}`}>
                {isLastPending ? <span className="h-2 w-2 animate-pulseDot rounded-full bg-current" /> : i < idx ? <Check className="h-4 w-4" strokeWidth={3} /> : <span className="text-xs font-bold">{i + 1}</span>}
              </span>
              <span className={`max-w-[80px] text-[11px] leading-tight ${i <= idx ? 'font-semibold' : 'text-muted'}`}>{s.label}{isLastPending ? ' (en cours)' : ''}</span>
            </div>
            {i < STEPS.length - 1 && <span className={`mx-1 h-0.5 flex-1 rounded ${i < idx ? 'bg-brand' : 'bg-line'}`} />}
          </div>
        )
      })}
    </div>
  )
}

function OrderDetail({ order, onBack, onChange }: { order: Order; onBack: () => void; onChange: () => void }) {
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [refuseOpen, setRefuseOpen] = useState(false)
  const code = getCode(String(order.id))

  async function receive() {
    if (!code) {
      toast('Code de livraison introuvable sur cet appareil.', 'error')
      return
    }
    setBusy('deliver')
    try {
      const r = await api<{ order: Order }>(`/api/orders/${order.id}/deliver`, { body: { code } })
      toast(r.order.financial_pending ? 'Remise enregistrée : confirmation du paiement en cours' : 'Livraison confirmée : vendeur et livreur sont payés')
      onChange()
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Erreur', 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <button onClick={onBack} className="mb-5 flex items-center gap-2 text-sm font-semibold text-muted hover:text-fg">
        <ArrowLeft className="h-4 w-4" /> Mes achats
      </button>
      <PageHeader title={order.title} text={`Chez ${order.seller?.shop_name || order.seller?.name}`} action={<StatusBadge status={order.status} />} />

      <div className="card mb-6 p-6">
        <Tracker order={order} />
        {['returning', 'return_pending'].includes(order.status) && (
          <p className="mt-5 rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">
            Colis {order.return_cause === 'refus' ? `refusé (${order.refuse_reason_label})` : order.return_cause === 'vendeur' ? 'retourné à la demande du vendeur' : order.return_cause === 'abandon' ? 'non livré (livreur indisponible)' : 'non remis (client absent)'} : le livreur rapporte le colis au vendeur. Le prix vous a été remboursé ; les frais de livraison restent dus au livreur.
          </p>
        )}
        {['returned', 'return_payment_pending'].includes(order.status) && (
          <p className="mt-5 rounded-xl bg-subtle px-4 py-3 text-sm text-muted">
            Colis retourné au vendeur. Le livreur {order.status === 'return_payment_pending' ? 'est en cours de paiement' : 'a été payé'} pour son déplacement.
            {order.fee_refund_status === 'completed' && ' Vos frais de livraison vous ont été remboursés par le vendeur.'}
            {order.fee_refund_status === 'pending' && ' Le remboursement de vos frais de livraison par le vendeur est en cours.'}
          </p>
        )}
        {['canceled', 'cancel_pending'].includes(order.status) && (
          <p className="mt-5 rounded-xl bg-subtle px-4 py-3 text-sm text-muted">
            {order.status === 'cancel_pending' ? 'Annulation en cours de confirmation' : 'Commande annulée'}{order.cancel_reason ? ` (${order.cancel_reason.replace(/_/g, ' ')})` : ''} : tout ce qui était payé vous {order.status === 'cancel_pending' ? 'sera' : 'a été'} remboursé.
          </p>
        )}
        {order.financial_pending && !['cancel_pending', 'return_pending', 'return_payment_pending', 'delivery_pending'].includes(order.status) && (
          <p className="mt-3 text-xs text-warn">Une confirmation Lightning est en cours ({order.financial_action}).</p>
        )}
      </div>

      {['assigned', 'picked_up', 'delivery_pending'].includes(order.status) && order.courier && (
        <SectionCard title="Livreur en direct" icon={<Truck />} className="mb-6">
          <div className="flex items-center gap-3">
            <Avatar name={order.courier.name} url={order.courier.avatar_url} size={40} />
            <div>
              <p className="font-semibold">{order.courier.name}</p>
              {order.courier.rating.count ? <p className="flex items-center gap-1 text-xs text-muted"><Star className="h-3 w-3 fill-warn text-warn" /> {order.courier.rating.avg} ({order.courier.rating.count})</p> : null}
            </div>
          </div>
          <TrackMap shop={order.shop} delivery={order.delivery} courier={order.courier.position} />
        </SectionCard>
      )}

      {['searching_courier', 'assigned', 'picked_up', 'delivery_pending'].includes(order.status) && (
        <SectionCard title="Code de livraison" icon={<QrCode />} className="mb-6">
          {code ? (
            <>
              <p className="text-sm text-muted">Montrez ce QR code au livreur à la remise, ou confirmez vous-même la réception ci-dessous.</p>
              <div className="mx-auto rounded-2xl border border-line bg-white p-3">
                <QRCodeSVG value={code} size={160} />
              </div>
              <div className="rounded-xl bg-subtle p-3 text-center font-mono text-sm tracking-wide">{groupCode(code)}</div>
            </>
          ) : (
            <p className="text-sm text-danger">Code introuvable sur cet appareil (navigateur différent ?) : demandez au livreur de passer par la confirmation du vendeur ou contactez l’administration.</p>
          )}
          {order.status === 'delivery_pending' && <p className="text-sm text-warn">Remise enregistrée, confirmation Lightning en cours (quelques secondes).</p>}
          {order.status === 'picked_up' && (
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button className="flex-1" loading={busy === 'deliver'} disabled={!code} onClick={receive}>
                <Check className="h-4 w-4" /> J’ai reçu mon colis
              </Button>
              <Button variant="danger" className="flex-1" onClick={() => setRefuseOpen(true)}>
                <X className="h-4 w-4" /> Refuser le colis
              </Button>
            </div>
          )}
        </SectionCard>
      )}

      {order.status === 'delivered' && <ReviewSection order={order} onChange={onChange} />}
      {['returning', 'return_pending', 'returned', 'return_payment_pending'].includes(order.status) && (
        <SectionCard title="Votre avis sur le livreur" icon={<Star />}>
          <ReviewBox order={order} target="livreur" label={order.courier?.name ?? 'le livreur'} canReview={order.can_review.livreur} mine={order.my_reviews.livreur} onChange={onChange} />
        </SectionCard>
      )}

      <SectionCard title="Sous le capot : les deux factures Lightning" icon={<QrCode />} className="mt-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <InvoiceBlock label="A · article" inv={order.invoices.item} />
          <InvoiceBlock label="B · livraison" inv={order.invoices.fee} />
        </div>
        <p className="text-xs text-muted">Le secret de la facture B (livraison) n’est jamais exposé par l’API : seul le serveur peut la régler. Votre code de livraison débloque la facture A, et sa confirmation déclenche automatiquement le règlement de B.</p>
      </SectionCard>

      <AnimatePresence>{refuseOpen && <RefuseModal order={order} onClose={() => setRefuseOpen(false)} onDone={onChange} />}</AnimatePresence>
    </>
  )
}

function InvoiceBlock({ label, inv }: { label: string; inv: Order['invoices']['item'] }) {
  const cls = { OPEN: 'bg-subtle text-muted', ACCEPTED: 'bg-warn-soft text-warn', SETTLED: 'bg-brand-soft text-brand', CANCELED: 'bg-danger-soft text-danger' }[inv.state]
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-line p-4">
      <div className="flex items-center justify-between">
        <span className="font-semibold">{label}</span>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${cls}`}>{inv.state}</span>
      </div>
      <p className="text-sm text-muted">Nœud {inv.node} · {inv.sats.toLocaleString('fr-FR')} sats</p>
      <Mono value={inv.hash} label="le payment_hash" />
    </div>
  )
}

function RefuseModal({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [reason, setReason] = useState('')
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!reason) return
    setBusy(true)
    try {
      await api(`/api/orders/${order.id}/refuse`, { body: { reason, comment } })
      toast('Colis refusé : le prix vous est remboursé, le livreur rapporte le colis')
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
        <h3 className="text-lg font-bold">Refuser le colis</h3>
        <p className="mt-1 text-sm text-muted">Le prix de l’article vous sera remboursé. Les frais de livraison restent dus au livreur qui s’est déplacé.</p>
        <div className="mt-4 flex flex-col gap-2">
          {Object.entries(REFUSE_REASONS).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2.5 rounded-xl border border-line p-3 text-sm">
              <input type="radio" name="reason" checked={reason === key} onChange={() => setReason(key)} className="accent-[rgb(var(--brand))]" />
              {label}
            </label>
          ))}
        </div>
        <Field label="Commentaire (facultatif)" value={comment} onChange={(e) => setComment(e.target.value)} className="mt-4" />
        <div className="mt-5 grid grid-cols-2 gap-3">
          <Button variant="secondary" onClick={onClose}>Annuler</Button>
          <Button variant="danger" loading={busy} disabled={!reason} onClick={submit}>Confirmer le refus</Button>
        </div>
      </motion.div>
    </motion.div>
  )
}

function ReviewSection({ order, onChange }: { order: Order; onChange: () => void }) {
  return (
    <div className="mb-6 grid gap-6 sm:grid-cols-2">
      <SectionCard title="Votre avis sur l’article" icon={<Star />}>
        <ReviewBox order={order} target="produit" label={order.title} canReview={order.can_review.produit} mine={order.my_reviews.produit} onChange={onChange} />
      </SectionCard>
      <SectionCard title="Votre avis sur le vendeur" icon={<Star />}>
        <ReviewBox order={order} target="vendeur" label={order.seller?.shop_name || order.seller?.name || 'le vendeur'} canReview={order.can_review.vendeur} mine={order.my_reviews.vendeur} onChange={onChange} />
      </SectionCard>
      {order.courier && (
        <SectionCard title="Votre avis sur le livreur" icon={<Star />}>
          <ReviewBox order={order} target="livreur" label={order.courier.name} canReview={order.can_review.livreur} mine={order.my_reviews.livreur} onChange={onChange} />
        </SectionCard>
      )}
    </div>
  )
}

export function ReviewBox({ order, target, label, canReview, mine, onChange }: { order: Order; target: 'vendeur' | 'livreur' | 'client' | 'produit'; label: string; canReview: boolean; mine: number | null; onChange: () => void }) {
  const toast = useToast()
  const [rating, setRating] = useState(5)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)

  if (mine != null) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <div className="flex">{[1, 2, 3, 4, 5].map((n) => <Star key={n} className={`h-4 w-4 ${n <= mine ? 'fill-warn text-warn' : 'text-line'}`} />)}</div>
        <span className="text-muted">Avis envoyé pour {label}</span>
      </div>
    )
  }
  if (!canReview) return <p className="text-sm text-muted">Disponible après la livraison ou le retour.</p>

  async function submit() {
    setBusy(true)
    try {
      await api(`/api/orders/${order.id}/review`, { body: { target, rating, comment } })
      toast('Merci pour votre avis')
      onChange()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Erreur', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">Notez {label} :</p>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} onClick={() => setRating(n)} aria-label={`${n} étoile${n > 1 ? 's' : ''}`}>
            <Star className={`h-6 w-6 transition ${n <= rating ? 'fill-warn text-warn' : 'text-line'}`} />
          </button>
        ))}
      </div>
      <Field label="Commentaire (facultatif)" value={comment} onChange={(e) => setComment(e.target.value)} />
      <Button loading={busy} onClick={submit}>Envoyer mon avis</Button>
    </div>
  )
}
