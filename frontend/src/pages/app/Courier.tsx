import { AnimatePresence, motion } from 'framer-motion'
import { Bike, Check, Clock, LogOut, MapPin, Navigation, Package, Power, Satellite, ScanLine, UserX, Wallet, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Amount } from '../../components/Amount'
import { FleetMap, TrackMap } from '../../components/Maps'
import { Concept, SectionCard } from '../../components/Tech'
import { Avatar, Button, cx, EmptyState, Field, Spinner, StatusBadge } from '../../components/ui'
import { useToast } from '../../context/ToastContext'
import { api, ApiError, type CourierMe } from '../../lib/api'
import { dateTime } from '../../lib/format'
import { usePoll } from '../../lib/usePoll'
import { PageHeader } from './AppLayout'
import { ReviewBox } from './Purchases'

export default function Courier() {
  const { data, reload } = usePoll<CourierMe>('/api/courier/me', 2000)
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const watchId = useRef<number | null>(null)

  const online = data?.courier.status !== 'offline'
  const mode = data?.courier.mode ?? 'sim'

  // Mode GPS réel : envoie la position du navigateur toutes les ~15 s.
  useEffect(() => {
    if (!online || mode !== 'gps' || !('geolocation' in navigator)) return
    const send = (pos: GeolocationPosition) => {
      api('/api/courier/location', { body: { lat: pos.coords.latitude, lng: pos.coords.longitude } }).catch(() => {})
    }
    watchId.current = navigator.geolocation.watchPosition(send, () => toast('Localisation indisponible : vérifiez les autorisations du navigateur (HTTPS requis).', 'error'), {
      enableHighAccuracy: true,
      maximumAge: 10000,
    })
    const interval = window.setInterval(() => navigator.geolocation.getCurrentPosition(send), 15000)
    return () => {
      if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current)
      window.clearInterval(interval)
    }
  }, [online, mode, toast])

  async function toggleOnline() {
    setBusy('status')
    try {
      await api('/api/courier/status', { body: { status: online ? 'offline' : 'available' } })
      reload()
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Erreur', 'error')
    } finally {
      setBusy(null)
    }
  }

  async function setMode(m: 'gps' | 'sim') {
    setBusy('mode')
    try {
      await api('/api/courier/status', { body: { mode: m } })
      reload()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Erreur', 'error')
    } finally {
      setBusy(null)
    }
  }

  if (!data) return <div className="grid h-40 place-items-center"><Spinner /></div>

  return (
    <>
      <PageHeader
        title="Espace livreur"
        text="Activez-vous pour recevoir des offres de course."
        action={
          <div className="flex items-center gap-3">
            <Amount value={data.earnings_sat} className="items-end" />
          </div>
        }
      />

      <div className="card mb-6 flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex items-center gap-3">
          <span className={cx('grid h-11 w-11 place-items-center rounded-xl', online ? (data.courier.status === 'busy' ? 'bg-warn-soft text-warn' : 'bg-brand-soft text-brand') : 'bg-subtle text-muted')}>
            <Power className="h-5 w-5" />
          </span>
          <div>
            <p className="font-semibold">{data.courier.status === 'busy' ? 'En course' : online ? 'En ligne, disponible' : 'Hors ligne'}</p>
            <p className="text-xs text-muted">
              {data.courier.offers_accepted}/{data.courier.offers_received} offres acceptées · fiabilité {Math.round(data.courier.acceptance_rate * 100)} % · note de service {data.courier.service.score}/5
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div role="tablist" className="inline-flex rounded-xl border border-line bg-subtle p-1">
            <button role="tab" aria-selected={mode === 'gps'} disabled={data.courier.status === 'busy' || busy === 'mode'} onClick={() => setMode('gps')} className={cx('flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition', mode === 'gps' ? 'bg-surface shadow-sm' : 'text-muted')}>
              <Satellite className="h-3.5 w-3.5" /> GPS réel
            </button>
            <button role="tab" aria-selected={mode === 'sim'} disabled={data.courier.status === 'busy' || busy === 'mode'} onClick={() => setMode('sim')} className={cx('flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition', mode === 'sim' ? 'bg-surface shadow-sm' : 'text-muted')}>
              <Navigation className="h-3.5 w-3.5" /> Simulé
            </button>
          </div>
          <Button variant={online ? 'danger' : 'primary'} loading={busy === 'status'} disabled={data.courier.status === 'busy'} onClick={toggleOnline}>
            <Power className="h-4 w-4" /> {online ? 'Passer hors ligne' : 'Passer en ligne'}
          </Button>
        </div>
      </div>

      {data.current ? (
        <ActiveRide order={data.current} radius={data.radius_km} onChange={reload} />
      ) : data.courier.position ? (
        <SectionCard title="Ma position" icon={<MapPin />} className="mb-6">
          <FleetMap points={[{ id: 'me', lat: data.courier.position.lat, lng: data.courier.position.lng, status: 'available', label: 'Moi' }]} height={240} />
          <p className="text-xs text-muted">En attente d’une offre de course…</p>
        </SectionCard>
      ) : (
        <EmptyState icon={<Bike />} title="Pas encore localisé" text="Passez en ligne pour être localisé (mode simulé) ou autorisez la géolocalisation (mode GPS)." />
      )}

      <Concept title="L’attribution automatique" to="/app/academie">
        Chaque commande cherche le livreur disponible le moins coûteux (distance + fiabilité + note). Il reçoit une offre de 30 s : accepter, refuser, ou laisser expirer passe au suivant.
      </Concept>

      <SectionCard title="Historique" icon={<Wallet />} className="mt-6">
        {!data.history.length ? (
          <p className="text-sm text-muted">Aucune course encore.</p>
        ) : (
          <div className="divide-y divide-line">
            {data.history.map((o) => (
              <div key={o.id} className="flex flex-wrap items-center gap-3 py-3">
                <Avatar name={o.buyer?.name ?? '?'} url={o.buyer?.avatar_url} size={34} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{o.title}</p>
                  <p className="text-xs text-muted">{dateTime(o.created_at)}</p>
                </div>
                <Amount value={o.fee_sat} />
                <StatusBadge status={o.status} />
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <AnimatePresence>{data.offer && <OfferModal offer={data.offer} onChange={reload} />}</AnimatePresence>
    </>
  )
}

function OfferModal({ offer, onChange }: { offer: NonNullable<CourierMe['offer']>; onChange: () => void }) {
  const toast = useToast()
  const [left, setLeft] = useState(offer.seconds_left)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    setLeft(Math.max(0, offer.expires_at - Math.floor(Date.now() / 1000)))
    const id = window.setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000)
    return () => window.clearInterval(id)
  }, [offer.id, offer.expires_at])

  async function respond(action: 'accept' | 'decline') {
    setBusy(action)
    try {
      await api(`/api/courier/offers/${offer.id}/${action}`, { method: 'POST' })
      if (action === 'accept') toast('Course acceptée')
      onChange()
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Erreur', 'error')
      onChange()
    } finally {
      setBusy(null)
    }
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <motion.div initial={{ scale: 0.9, y: 20, opacity: 0 }} animate={{ scale: 1, y: 0, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="w-full max-w-sm overflow-hidden rounded-3xl bg-surface shadow-float">
        <div className="relative h-1.5 w-full bg-subtle">
          <motion.div className="absolute inset-y-0 left-0 bg-brand" initial={false} animate={{ width: `${(left / 30) * 100}%` }} transition={{ ease: 'linear', duration: 1 }} />
        </div>
        <div className="flex flex-col gap-5 p-6 text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-brand-soft text-brand"><Bike className="h-7 w-7" /></span>
          <div>
            <p className="text-lg font-bold">Nouvelle course</p>
            <p className="text-sm text-muted">{offer.order?.title}</p>
          </div>
          <div className="flex items-center justify-center gap-6">
            <div>
              <p className="text-xs text-muted">Distance jusqu’à la boutique</p>
              <p className="font-display text-xl font-bold">{offer.distance_to_shop_km} km</p>
            </div>
            <div>
              <p className="text-xs text-muted">Frais de livraison</p>
              <Amount value={offer.order?.fee_sat ?? 0} />
            </div>
          </div>
          <p className="flex items-center justify-center gap-1.5 text-sm font-semibold text-warn"><Clock className="h-4 w-4" /> {left} s</p>
          <div className="grid grid-cols-2 gap-3">
            <Button variant="secondary" loading={busy === 'decline'} onClick={() => respond('decline')}>Refuser</Button>
            <Button loading={busy === 'accept'} disabled={left <= 0} onClick={() => respond('accept')}>Accepter</Button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}

function ActiveRide({ order, radius, onChange }: { order: CourierMe['current']; radius: { pickup: number; absent: number }; onChange: () => void }) {
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [absentOpen, setAbsentOpen] = useState(false)
  const [abandonOpen, setAbandonOpen] = useState(false)
  if (!order) return null

  async function run(action: string, fn: () => Promise<unknown>, okMsg?: string) {
    setBusy(action)
    try {
      await fn()
      if (okMsg) toast(okMsg)
      onChange()
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Erreur', 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <SectionCard title="Course en cours" icon={<Package />} action={<StatusBadge status={order.status} />} className="mb-6">
      <div className="flex items-center gap-3">
        <Avatar name={order.buyer?.name ?? '?'} url={order.buyer?.avatar_url} size={40} />
        <div>
          <p className="font-semibold">{order.title}</p>
          <p className="text-xs text-muted">Client : {order.buyer?.name} · {order.delivery.address || 'sans précision'}</p>
        </div>
        <Amount value={order.fee_sat} className="ml-auto items-end" />
      </div>

      <TrackMap shop={order.shop} delivery={order.delivery} courier={order.courier?.position} />

      {order.status === 'assigned' && (
        <div className="flex flex-col gap-3">
          <Button loading={busy === 'pickup'} onClick={() => run('pickup', () => api(`/api/orders/${order.id}/pickup`, { method: 'POST' }), 'Colis récupéré')}>
            <Check className="h-4 w-4" /> Colis récupéré (à moins de {radius.pickup} km de la boutique)
          </Button>
          <Button variant="ghost" className="text-danger hover:bg-danger-soft" onClick={() => setAbandonOpen(true)}>
            <LogOut className="h-4 w-4" /> Abandonner cette course
          </Button>
        </div>
      )}

      {order.status === 'picked_up' && (
        <div className="flex flex-col gap-3">
          <Field
            label="Code de livraison du client"
            icon={<ScanLine className="h-4 w-4" />}
            value={code}
            onChange={(e) => setCode(e.target.value.trim())}
            placeholder="Scanné ou saisi (64 caractères)"
            className="[&_input]:font-mono [&_input]:text-xs"
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <Button loading={busy === 'deliver'} disabled={!code} onClick={() => run('deliver', () => api(`/api/orders/${order.id}/deliver`, { body: { code } }), 'Livraison confirmée : vous êtes payé')}>
              <Check className="h-4 w-4" /> Valider la remise
            </Button>
            <Button variant="secondary" onClick={() => setAbsentOpen(true)}>
              <UserX className="h-4 w-4" /> Client absent
            </Button>
          </div>
          <Button variant="ghost" className="text-danger hover:bg-danger-soft" onClick={() => setAbandonOpen(true)}>
            <LogOut className="h-4 w-4" /> Abandonner (retour obligatoire)
          </Button>
        </div>
      )}

      {order.status === 'delivery_pending' && <p className="rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn">Remise enregistrée, confirmation du paiement en cours.</p>}
      {['returning', 'return_pending'].includes(order.status) && <p className="rounded-xl bg-subtle px-4 py-3 text-sm text-muted">Ramenez le colis à la boutique. Les frais vous seront versés à la confirmation du vendeur.</p>}
      {order.status === 'return_payment_pending' && <p className="rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn">Retour confirmé : paiement de vos frais en cours de confirmation.</p>}

      {['delivered', 'returning', 'return_pending', 'returned', 'return_payment_pending'].includes(order.status) && (
        <div className="rounded-xl border border-line p-4">
          <p className="mb-2 text-sm font-semibold">Votre avis sur le client</p>
          <ReviewBox order={order} target="client" label={order.buyer?.name ?? 'le client'} canReview={order.can_review.client} mine={order.my_reviews.client} onChange={onChange} />
        </div>
      )}

      <AnimatePresence>
        {absentOpen && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={() => setAbsentOpen(false)}>
            <motion.div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-2xl bg-surface p-6">
              <h3 className="text-lg font-bold">Déclarer le client absent</h3>
              <p className="mt-1 text-sm text-muted">Possible seulement à moins de {radius.absent} km du point de livraison. Le prix sera remboursé au client ; vos frais restent dus.</p>
              <div className="mt-5 grid grid-cols-2 gap-3">
                <Button variant="secondary" onClick={() => setAbsentOpen(false)}>Annuler</Button>
                <Button variant="danger" loading={busy === 'absent'} onClick={() => run('absent', () => api(`/api/orders/${order.id}/absent`, { method: 'POST' }), 'Absence déclarée').then(() => setAbsentOpen(false))}>
                  <X className="h-4 w-4" /> Confirmer
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>{abandonOpen && <AbandonModal order={order} onClose={() => setAbandonOpen(false)} onDone={onChange} />}</AnimatePresence>
    </SectionCard>
  )
}

function AbandonModal({ order, onClose, onDone }: { order: NonNullable<CourierMe['current']>; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const afterPickup = order.status === 'picked_up'

  async function submit() {
    if (!reason) return
    setBusy(true)
    try {
      await api(`/api/orders/${order.id}/abandon`, { body: { reason } })
      toast(afterPickup ? 'Course abandonnée : vous devez rapporter le colis à la boutique' : 'Course abandonnée : réattribuée à un autre livreur')
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
      <motion.div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-2xl bg-surface p-6">
        <h3 className="text-lg font-bold">Abandonner cette course</h3>
        <p className="mt-1 text-sm text-muted">
          {afterPickup
            ? 'Le colis est déjà récupéré : vous devrez le rapporter à la boutique avant d’être payé. Cet incident est compté dans votre note de service.'
            : 'La course sera réattribuée à un autre livreur, sans aucun mouvement financier. Cet incident est compté dans votre note de service.'}
        </p>
        <Field label="Motif (obligatoire)" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Panne, imprévu…" className="mt-4" />
        <div className="mt-5 grid grid-cols-2 gap-3">
          <Button variant="secondary" onClick={onClose}>Annuler</Button>
          <Button variant="danger" loading={busy} disabled={!reason} onClick={submit}>Confirmer l’abandon</Button>
        </div>
      </motion.div>
    </motion.div>
  )
}
