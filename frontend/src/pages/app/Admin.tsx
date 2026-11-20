import { motion } from 'framer-motion'
import {
  AlertTriangle, Bike, Download, Package, ScrollText, Search, Server, ShieldAlert, ShieldCheck, ShoppingBag,
  Tag, Trash2, Undo2, Users as UsersIcon, Wallet, Zap,
} from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { Amount } from '../../components/Amount'
import { FleetMap, type DispatchPoint } from '../../components/Maps'
import { Mono, SectionCard } from '../../components/Tech'
import { Avatar, Button, cx, EmptyState, Field, Spinner, StatusBadge } from '../../components/ui'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { api, ApiError, type AdminStats, type AdminUser, type AuditEntry, type DispatchSnapshot, type Order, type OrderStatus, type SystemInfo, type Article } from '../../lib/api'
import { dateTime, int } from '../../lib/format'
import { usePoll } from '../../lib/usePoll'
import { PageHeader } from './AppLayout'

export function AdminGuard({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="grid h-40 place-items-center"><Spinner /></div>
  if (!user?.is_admin) return <Navigate to="/app" replace />
  return (
    <>
      <AdminBadge />
      {children}
    </>
  )
}

function AdminBadge() {
  return (
    <div className="mb-6 flex items-center gap-2 rounded-xl border border-btc/25 bg-btc-soft px-4 py-2.5 text-sm font-semibold text-btc-ink">
      <ShieldCheck className="h-4 w-4" /> Espace administrateur · toutes les actions sont journalisées
    </div>
  )
}

/* ==================================================================== vue d'ensemble */

export function AdminOverview() {
  const { data } = usePoll<AdminStats>('/api/admin/stats', 4000)
  if (!data) return <div className="grid h-40 place-items-center"><Spinner /></div>

  const maxVol = Math.max(1, ...data.activity_14d.map((d) => d.volume_sat))

  return (
    <>
      <PageHeader title="Vue d’ensemble" text="L’état global de la plateforme." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi icon={<UsersIcon />} label="Utilisateurs" value={data.users.total} sub={`${data.users.active_7d} actifs sur 7 j · ${data.users.suspended} suspendus`} />
        <Kpi icon={<Bike />} label="Livreurs" value={data.couriers.online + data.couriers.busy} sub={`${data.couriers.online} en ligne · ${data.couriers.busy} en course`} />
        <Kpi icon={<Package />} label="Commandes" value={data.orders.total} sub={`${data.returns_in_progress} retours en cours`} />
        <Kpi icon={<Wallet />} label="Fonds bloqués" value={<Amount value={data.locked_sat} />} sub="En séquestre Lightning" tone="warn" />
      </div>

      {data.alerts.length > 0 && (
        <div className="card mt-6 p-5">
          <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4 text-warn" /> Alertes ({data.alerts.length})</p>
          <div className="mt-3 flex flex-col gap-2">
            {data.alerts.map((a) => (
              <Link
                key={a.id}
                to={a.path}
                className={cx(
                  'flex items-center justify-between gap-3 rounded-xl px-4 py-2.5 text-sm transition hover:brightness-95',
                  a.severity === 'critical' ? 'bg-danger-soft text-danger' : 'bg-warn-soft text-warn',
                )}
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold">{a.title}</p>
                  <p className="truncate text-xs opacity-80">{a.detail}</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {data.expiring_soon.length > 0 && (
        <div className="card mt-6 border-warn/30 p-5">
          <p className="flex items-center gap-2 font-semibold text-warn"><AlertTriangle className="h-4 w-4" /> Séquestres qui expirent dans moins de 30 min</p>
          <div className="mt-3 flex flex-col gap-2">
            {data.expiring_soon.map((o) => (
              <div key={o.id} className="flex items-center justify-between rounded-xl bg-warn-soft px-4 py-2.5 text-sm">
                <span className="font-semibold">#{o.id} · {o.title}</span>
                <span>{dateTime(o.deadline_at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <SectionCard title="Commandes par statut" icon={<Package />}>
          <div className="flex flex-col gap-2">
            {Object.entries(data.orders.by_status).map(([status, n]) => (
              <div key={status} className="flex items-center justify-between text-sm">
                <StatusBadge status={status as OrderStatus} />
                <span className="font-semibold tabular">{n}</span>
              </div>
            ))}
          </div>
        </SectionCard>
        <SectionCard title="Versé aux vendeurs et livreurs" icon={<Wallet />}>
          <div className="flex items-center justify-between py-1.5">
            <span className="text-sm text-muted">Vendeurs (articles livrés)</span>
            <Amount value={data.paid_sellers_sat} />
          </div>
          <div className="flex items-center justify-between py-1.5">
            <span className="text-sm text-muted">Livreurs (frais réglés)</span>
            <Amount value={data.paid_couriers_sat} />
          </div>
        </SectionCard>
      </div>

      <SectionCard title="Activité sur 14 jours" icon={<ShoppingBag />} className="mt-6">
        <div className="flex h-40 items-end gap-1.5">
          {data.activity_14d.map((d) => (
            <div key={d.date} className="group relative flex-1">
              <div className="rounded-t bg-brand/70 transition group-hover:bg-brand" style={{ height: `${Math.max(4, (d.volume_sat / maxVol) * 140)}px` }} />
              <div className="pointer-events-none absolute -top-16 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-fg px-2 py-1 text-[11px] text-bg group-hover:flex">
                {d.date} · {d.orders} cmd · {int(d.volume_sat)} sats
              </div>
            </div>
          ))}
        </div>
      </SectionCard>
    </>
  )
}

function Kpi({ icon, label, value, sub, tone }: { icon: ReactNode; label: string; value: ReactNode; sub: string; tone?: 'warn' }) {
  return (
    <div className="card flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted">{label}</span>
        <span className={cx('grid h-9 w-9 place-items-center rounded-xl [&>svg]:h-[18px] [&>svg]:w-[18px]', tone === 'warn' ? 'bg-warn-soft text-warn' : 'bg-brand-soft text-brand')}>{icon}</span>
      </div>
      <div className="font-display text-2xl font-bold">{value}</div>
      <span className="text-xs text-muted">{sub}</span>
    </div>
  )
}

/* ==================================================================== utilisateurs */

export function AdminUsers() {
  const toast = useToast()
  const [q, setQ] = useState('')
  const { data, reload } = usePoll<{ users: AdminUser[] }>(`/api/admin/users?q=${encodeURIComponent(q)}`, 6000)

  async function toggle(u: AdminUser, field: 'is_suspended' | 'is_admin') {
    try {
      await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: { [field]: !u[field] } })
      toast(field === 'is_suspended' ? (u.is_suspended ? 'Compte réactivé' : 'Compte suspendu') : 'Rôle mis à jour')
      reload()
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Erreur', 'error')
    }
  }

  return (
    <>
      <PageHeader
        title="Utilisateurs"
        text="Recherche, notes, ventes, achats, refus et livraisons."
        action={
          <a href={`/api/admin/users?format=csv&q=${encodeURIComponent(q)}`} className="inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-surface px-3.5 text-sm font-semibold hover:bg-subtle">
            <Download className="h-4 w-4" /> Export CSV
          </a>
        }
      />
      <Field label="Rechercher" icon={<Search className="h-4 w-4" />} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nom, e-mail, boutique…" className="mb-5 max-w-md" />
      {!data ? (
        <div className="grid h-40 place-items-center"><Spinner /></div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full min-w-[920px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-muted">
                <th className="p-3.5 font-semibold">Utilisateur</th>
                <th className="p-3.5 font-semibold">Notes</th>
                <th className="p-3.5 font-semibold">Ventes / achats</th>
                <th className="p-3.5 font-semibold">Refus / absences</th>
                <th className="p-3.5 font-semibold">Livraisons</th>
                <th className="p-3.5 font-semibold">Statut</th>
                <th className="p-3.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.users.map((u) => (
                <tr key={u.id}>
                  <td className="p-3.5">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={u.name} url={u.avatar_url} size={32} />
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{u.name}{u.is_bot && <span className="ml-1.5 rounded-full bg-subtle px-1.5 py-0.5 text-[10px] text-muted">bot</span>}</p>
                        <p className="truncate text-xs text-muted">{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="p-3.5 text-xs">
                    <p>Vendeur {u.ratings.vendeur.avg ?? '—'} ({u.ratings.vendeur.count})</p>
                    <p>Livreur {u.ratings.livreur.avg ?? '—'} ({u.ratings.livreur.count})</p>
                    <p>Client {u.ratings.client.avg ?? '—'} ({u.ratings.client.count})</p>
                    {(u.courier_service.missed_deliveries > 0 || u.courier_service.abandonments > 0 || u.courier_service.late_returns > 0) && (
                      <p className="mt-0.5 text-danger">
                        Service {u.courier_service.score}/5 · {u.courier_service.missed_deliveries} non-présentation(s), {u.courier_service.abandonments} abandon(s), {u.courier_service.late_returns} retour(s) en retard
                      </p>
                    )}
                  </td>
                  <td className="p-3.5 tabular">{u.sales} / {u.purchases}</td>
                  <td className="p-3.5 tabular">{u.refusals} / {u.absences}</td>
                  <td className="p-3.5 tabular">{u.deliveries}</td>
                  <td className="p-3.5">
                    <div className="flex flex-col gap-1">
                      {u.is_admin && <span className="inline-flex items-center gap-1 rounded-full bg-btc-soft px-2 py-0.5 text-[11px] font-semibold text-btc-ink"><ShieldCheck className="h-3 w-3" /> Admin</span>}
                      {u.is_suspended && <span className="inline-flex items-center gap-1 rounded-full bg-danger-soft px-2 py-0.5 text-[11px] font-semibold text-danger">Suspendu</span>}
                    </div>
                  </td>
                  <td className="p-3.5 text-right">
                    {!u.is_bot && (
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant={u.is_suspended ? 'secondary' : 'danger'} onClick={() => toggle(u, 'is_suspended')}>
                          {u.is_suspended ? 'Réactiver' : 'Suspendre'}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => toggle(u, 'is_admin')}>
                          {u.is_admin ? 'Retirer admin' : 'Nommer admin'}
                        </Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

/* ==================================================================== commandes et litiges */

const STATUSES: OrderStatus[] = [
  'awaiting_payment', 'searching_courier', 'assigned', 'picked_up', 'delivered',
  'returning', 'returned', 'canceled',
  'cancel_pending', 'delivery_pending', 'return_pending', 'return_payment_pending',
]

export function AdminOrders() {
  const [status, setStatus] = useState('')
  const { data, reload } = usePoll<{ orders: Order[] }>(`/api/admin/orders?status=${status}`, 5000)
  const [dispute, setDispute] = useState<Order | null>(null)

  return (
    <>
      <PageHeader title="Commandes et litiges" text="Remboursements, retours bloqués et remboursement des frais par le vendeur." />
      <div className="mb-5 flex flex-wrap gap-2">
        <button onClick={() => setStatus('')} className={cx('rounded-full px-3 py-1.5 text-xs font-semibold', status === '' ? 'bg-brand text-brand-fg' : 'bg-subtle text-muted')}>Tous</button>
        {STATUSES.map((s) => (
          <button key={s} onClick={() => setStatus(s)} className={cx('rounded-full px-3 py-1.5 text-xs font-semibold', status === s ? 'bg-brand text-brand-fg' : 'bg-subtle text-muted')}>
            {s}
          </button>
        ))}
      </div>
      {!data ? (
        <div className="grid h-40 place-items-center"><Spinner /></div>
      ) : !data.orders.length ? (
        <EmptyState icon={<Package />} title="Aucune commande" text="Rien à afficher pour ce filtre." />
      ) : (
        <div className="flex flex-col divide-y divide-line rounded-2xl border border-line bg-surface">
          {data.orders.map((o) => (
            <div key={o.id} className="flex flex-wrap items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">#{o.id} · {o.title}</p>
                <p className="text-xs text-muted">{o.buyer?.name} → {o.seller?.name}{o.courier ? ` → ${o.courier.name}` : ''}</p>
              </div>
              <Amount value={o.total_sat} />
              <StatusBadge status={o.status} />
              {(['awaiting_payment', 'searching_courier', 'assigned', 'picked_up', 'returning'].includes(o.status)) && (
                <Button size="sm" variant="secondary" onClick={() => setDispute(o)}>Gérer</Button>
              )}
            </div>
          ))}
        </div>
      )}
      {dispute && <DisputeDialog order={dispute} onClose={() => setDispute(null)} onDone={reload} />}
    </>
  )
}

function DisputeDialog({ order: o, onClose, onDone }: { order: Order; onClose: () => void; onDone: () => void }) {
  const toast = useToast()
  const [refundReason, setRefundReason] = useState('')
  const [feeReason, setFeeReason] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  async function run(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key)
    try {
      const r = (await fn()) as { order?: Order } | undefined
      toast(r?.order?.financial_pending ? `${ok} (confirmation Lightning en cours)` : ok)
      onDone()
      onClose()
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Erreur', 'error')
    } finally {
      setBusy(null)
    }
  }

  const canRefundTotal = ['awaiting_payment', 'searching_courier', 'assigned', 'picked_up'].includes(o.status)
  const canFee = o.status === 'returning'
  const canRefundFee = o.fee_refund_status === 'pending'

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <motion.div onClick={(e) => e.stopPropagation()} initial={{ scale: 0.96 }} animate={{ scale: 1 }} className="w-full max-w-lg rounded-2xl bg-surface p-6">
        <h3 className="text-lg font-bold">Commande #{o.id} · {o.title}</h3>
        <p className="mt-1 text-sm text-muted">Statut actuel : <StatusBadge status={o.status} /></p>
        {o.financial_pending && (
          <p className="mt-3 rounded-xl bg-warn-soft px-3.5 py-2.5 text-sm text-warn">
            Une opération ({o.financial_action}) est enregistrée et attend sa confirmation Lightning. {o.financial_error ? `Dernier incident : ${o.financial_error}` : 'Nouvelle tentative automatique en cours.'}
          </p>
        )}

        {canRefundTotal && (
          <div className="mt-5 flex flex-col gap-2">
            <p className="text-sm font-semibold">Remboursement total avant remise</p>
            <Field label="Motif (obligatoire)" value={refundReason} onChange={(e) => setRefundReason(e.target.value)} placeholder="Article en rupture de stock" />
            <Button variant="danger" loading={busy === 'refund'} disabled={!refundReason} onClick={() => run('refund', () => api(`/api/admin/orders/${o.id}/refund`, { body: { reason: refundReason } }), 'Commande remboursée')}>
              <Undo2 className="h-4 w-4" /> Rembourser intégralement
            </Button>
          </div>
        )}

        {canFee && (
          <div className="mt-5 flex flex-col gap-2 border-t border-line pt-5">
            <p className="text-sm font-semibold">Retour bloqué : le vendeur n’a pas confirmé</p>
            <Field label="Motif (obligatoire)" value={feeReason} onChange={(e) => setFeeReason(e.target.value)} placeholder="Retour du colis vérifié auprès du vendeur" />
            <div className="grid grid-cols-2 gap-3">
              <Button variant="secondary" loading={busy === 'pay'} disabled={!feeReason} onClick={() => run('pay', () => api(`/api/admin/orders/${o.id}/fee`, { body: { action: 'pay', reason: feeReason } }), 'Livreur payé')}>Payer le livreur</Button>
              <Button variant="danger" loading={busy === 'cancel'} disabled={!feeReason} onClick={() => run('cancel', () => api(`/api/admin/orders/${o.id}/fee`, { body: { action: 'cancel', reason: feeReason } }), 'Frais annulés')}>Annuler les frais</Button>
            </div>
          </div>
        )}

        {canRefundFee && (
          <div className="mt-5 flex flex-col gap-2 border-t border-line pt-5">
            <p className="text-sm font-semibold">Rembourser les frais de livraison au client</p>
            <p className="text-xs text-muted">Une facture est créée par le nœud acheteur et payée par le vendeur. Nouvelle tentative possible si la précédente a échoué (sans créer de second débit).</p>
            {o.fee_refund_error && <p className="text-xs text-danger">Dernière tentative : {o.fee_refund_error}</p>}
            <Button loading={busy === 'refund-fee'} onClick={() => run('refund-fee', () => api(`/api/admin/orders/${o.id}/refund-fee`, { method: 'POST' }), 'Frais remboursés par le vendeur')}>Rembourser les frais</Button>
          </div>
        )}
        {o.fee_refund_status === 'awaiting_return' && <p className="mt-4 text-xs text-muted">Remboursement des frais prévu une fois le retour confirmé.</p>}

        {!canRefundTotal && !canFee && !canRefundFee && <p className="mt-4 text-sm text-muted">Aucune action disponible pour ce statut.</p>}

        <div className="mt-6 flex justify-end">
          <Button variant="ghost" onClick={onClose}>Fermer</Button>
        </div>
      </motion.div>
    </motion.div>
  )
}

/* ==================================================================== dispatch */

export function AdminDispatch() {
  const { data } = usePoll<DispatchSnapshot>('/api/admin/dispatch', 2500)
  if (!data) return <div className="grid h-40 place-items-center"><Spinner /></div>

  const points: DispatchPoint[] = data.couriers.filter((c) => c.position).map((c) => ({ id: c.user.id, lat: c.position!.lat, lng: c.position!.lng, status: c.status, label: `${c.user.name} · ${c.status}` }))

  return (
    <>
      <PageHeader title="Dispatch" text="Carte de tous les livreurs, commandes en cours et journal des offres." />
      <FleetMap points={points} className="mb-6" height={440} />

      <div className="grid gap-6 lg:grid-cols-2">
        <SectionCard title="Livreurs" icon={<Bike />}>
          <div className="flex flex-col divide-y divide-line">
            {data.couriers.map((c) => (
              <div key={c.user.id} className="flex items-center gap-3 py-2.5 text-sm">
                <Avatar name={c.user.name} url={c.user.avatar_url} size={28} />
                <div className="min-w-0 flex-1">
                  <p className="truncate">{c.user.name}</p>
                  <p className="text-xs text-muted">Service {c.service.score}/5</p>
                </div>
                <span className={cx('rounded-full px-2 py-0.5 text-xs font-semibold', c.status === 'available' ? 'bg-brand-soft text-brand' : c.status === 'busy' ? 'bg-warn-soft text-warn' : 'bg-subtle text-muted')}>{c.status}</span>
              </div>
            ))}
          </div>
        </SectionCard>
        <SectionCard title="Commandes en cours" icon={<Package />}>
          <div className="flex flex-col divide-y divide-line">
            {data.orders.length === 0 ? <p className="text-sm text-muted">Aucune course active.</p> : data.orders.map((o) => (
              <div key={o.id} className="flex items-center gap-3 py-2.5 text-sm">
                <span className="flex-1 truncate">#{o.id} · {o.title}</span>
                <StatusBadge status={o.status} />
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <SectionCard title="Journal des offres" icon={<ScrollText />} className="mt-6">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-muted">
                <th className="pb-2 font-semibold">Livreur</th>
                <th className="pb-2 font-semibold">Commande</th>
                <th className="pb-2 font-semibold">Coût</th>
                <th className="pb-2 font-semibold">Distance</th>
                <th className="pb-2 font-semibold">Statut</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {data.offers.map((f) => (
                <tr key={f.id}>
                  <td className="py-2 pr-4">{f.courier_name}</td>
                  <td className="py-2 pr-4">#{f.order_id} · {f.title}</td>
                  <td className="py-2 pr-4 tabular">{f.cost}</td>
                  <td className="py-2 pr-4 tabular">{f.distance_km} km</td>
                  <td className="py-2">
                    <span className={cx('rounded-full px-2 py-0.5 text-xs font-semibold', { pending: 'bg-warn-soft text-warn', accepted: 'bg-brand-soft text-brand', declined: 'bg-subtle text-muted', expired: 'bg-subtle text-muted', canceled: 'bg-danger-soft text-danger' }[f.status])}>{f.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </>
  )
}

/* ==================================================================== modération */

export function AdminArticles() {
  const toast = useToast()
  const { data, reload } = usePoll<{ articles: Article[] }>('/api/admin/articles', 6000)
  const [target, setTarget] = useState<Article | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  async function remove() {
    if (!target || !reason) return
    setBusy(true)
    try {
      await api(`/api/admin/articles/${target.id}`, { method: 'DELETE', body: { reason } })
      toast('Article retiré')
      setTarget(null)
      setReason('')
      reload()
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Erreur', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader title="Modération" text="Retrait d’articles, avec motif obligatoire." />
      {!data ? (
        <div className="grid h-40 place-items-center"><Spinner /></div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {data.articles.map((a) => (
            <div key={a.id} className={cx('card flex flex-col gap-2 p-4', !a.is_active && 'opacity-60')}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{a.title}</p>
                  <p className="text-xs text-muted">{a.seller.name}</p>
                </div>
                <Amount value={a.price_sat} />
              </div>
              {a.removed_reason ? (
                <span className="rounded-lg bg-danger-soft px-2.5 py-1 text-xs text-danger">Retiré : {a.removed_reason}</span>
              ) : (
                <Button size="sm" variant="danger" className="self-start" onClick={() => setTarget(a)}>
                  <Trash2 className="h-3.5 w-3.5" /> Retirer
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
      {target && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={() => setTarget(null)}>
          <motion.div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm rounded-2xl bg-surface p-6">
            <h3 className="text-lg font-bold">Retirer « {target.title} »</h3>
            <Field label="Motif" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Contenu non conforme" className="mt-4" />
            <div className="mt-5 grid grid-cols-2 gap-3">
              <Button variant="secondary" onClick={() => setTarget(null)}>Annuler</Button>
              <Button variant="danger" loading={busy} disabled={!reason} onClick={remove}>Retirer</Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </>
  )
}

/* ==================================================================== santé du système */

export function AdminSystem() {
  const { data } = usePoll<SystemInfo>('/api/admin/system', 5000)
  if (!data) return <div className="grid h-40 place-items-center"><Spinner /></div>

  return (
    <>
      <PageHeader title="Santé du système" text="Les trois nœuds, bitcoind, les modes et les réglages." />
      <div className="grid gap-4 sm:grid-cols-3">
        {data.nodes.map((n) => (
          <div key={n.id} className="card p-5">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 font-semibold"><Zap className="h-4 w-4 text-brand" /> {n.id}</span>
              <span className={cx('h-2.5 w-2.5 rounded-full', n.reachable ? 'bg-up' : 'bg-down')} />
            </div>
            <p className="mt-2 text-xs text-muted">{n.role} · {n.mode}</p>
            {n.reachable ? (
              <dl className="mt-3 flex flex-col gap-1 text-xs">
                <div className="flex justify-between"><dt className="text-muted">Bloc</dt><dd>{n.block_height}</dd></div>
                <div className="flex justify-between"><dt className="text-muted">Canaux</dt><dd>{n.channels}</dd></div>
                <div className="flex justify-between"><dt className="text-muted">Local</dt><dd>{n.local_sat?.toLocaleString('fr-FR')} sats</dd></div>
              </dl>
            ) : (
              <p className="mt-2 text-xs text-danger">{n.error}</p>
            )}
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <SectionCard title="Bitcoin Core" icon={<Server />}>
          <Row k="Mode" v={data.bitcoind.mode} />
          <Row k="Accessible" v={data.bitcoind.reachable ? 'Oui' : 'Non'} />
          {data.bitcoind.chain && <Row k="Chaîne" v={data.bitcoind.chain} />}
          {data.bitcoind.blocks != null && <Row k="Hauteur" v={data.bitcoind.blocks} />}
        </SectionCard>
        <SectionCard title="Cours et réglages" icon={<ShieldAlert />}>
          <Row k="Cours BTC/FCFA" v={`${int(data.price.btc_xof)} (${data.price.source})`} />
          {Object.entries(data.settings).map(([k, v]) => (
            <Row key={k} k={k} v={v} />
          ))}
        </SectionCard>
      </div>
    </>
  )
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-line py-2 text-sm last:border-0">
      <span className="text-muted">{k}</span>
      <span className="font-semibold">{v}</span>
    </div>
  )
}

/* ==================================================================== journal d'audit */

export function AdminAudit() {
  const [q, setQ] = useState('')
  const { data } = usePoll<{ entries: AuditEntry[] }>(`/api/admin/audit?q=${encodeURIComponent(q)}`, 6000)

  return (
    <>
      <PageHeader title="Journal d’audit" text="Comptes, commandes et actions d’administration." />
      <Field label="Rechercher" icon={<Search className="h-4 w-4" />} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Action, utilisateur…" className="mb-5 max-w-md" />
      {!data ? (
        <div className="grid h-40 place-items-center"><Spinner /></div>
      ) : (
        <div className="flex flex-col divide-y divide-line rounded-2xl border border-line bg-surface">
          {data.entries.map((e) => (
            <div key={e.id} className="flex flex-wrap items-center gap-3 p-3.5 text-sm">
              <Tag className="h-3.5 w-3.5 shrink-0 text-muted" />
              <span className="font-mono text-xs font-semibold">{e.action}</span>
              {e.user && <span className="text-muted">· {e.user.name}</span>}
              {e.target && <Mono value={e.target} className="text-xs" />}
              <span className="ml-auto text-xs text-muted">{dateTime(e.at)}</span>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
