import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, CheckCircle2, FileText, Network, Radio, ScanSearch, Server, Zap } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useEffect, useState, type FormEvent } from 'react'
import { Cli, Concept, Mono, SectionCard, sha256Hex } from '../../components/Tech'
import { Button, cx, Field, Spinner } from '../../components/ui'
import { useToast } from '../../context/ToastContext'
import { api, ApiError, type Decoded, type LnHistory, type LnNode, type PayResult } from '../../lib/api'
import { dateTime, sats } from '../../lib/format'
import { usePoll } from '../../lib/usePoll'
import { PageHeader } from './AppLayout'

const ROLE_LABEL: Record<string, string> = { acheteur: 'Nœud acheteur', vendeur: 'Nœud vendeur', livreur: 'Nœud livreur' }

export default function Lightning() {
  const { data, reload } = usePoll<{ mode: string; nodes: LnNode[] }>('/api/ln/nodes', 3000)
  const [sel, setSel] = useState<string>('alice')
  const node = data?.nodes.find((n) => n.id === sel)
  const others = data?.nodes.filter((n) => n.id !== sel).map((n) => n.id) ?? []

  return (
    <>
      <PageHeader
        title="Console Lightning"
        text="Vos trois nœuds (alice, bob, carol), leurs canaux, les factures et les paiements."
        action={
          <div role="tablist" className="inline-flex rounded-2xl border border-line bg-surface p-1.5">
            {(data?.nodes.map((n) => n.id) ?? ['alice', 'bob', 'carol']).map((k) => (
              <button
                key={k}
                role="tab"
                aria-selected={sel === k}
                onClick={() => setSel(k)}
                className={cx('relative flex h-11 items-center gap-2 rounded-xl px-4 text-sm font-semibold transition', sel === k ? 'text-brand-fg' : 'text-muted hover:text-fg')}
              >
                {sel === k && <motion.span layoutId="node-pill" className="absolute inset-0 rounded-xl bg-brand" transition={{ type: 'spring', duration: 0.35 }} />}
                <span className="relative flex items-center gap-2">
                  <Server className="h-4 w-4" /> {k}
                </span>
              </button>
            ))}
          </div>
        }
      />

      {!data || !node ? (
        <div className="grid h-40 place-items-center">
          <Spinner />
        </div>
      ) : !node.reachable ? (
        <div className="card p-6 text-sm">
          <p className="font-semibold text-danger">Nœud {sel} injoignable</p>
          <p className="mt-1 text-muted">{node.error}</p>
          <p className="mt-3 text-muted">Vérifiez que le réseau Polar est démarré et que les chemins du macaroon et du certificat TLS sont corrects (README).</p>
        </div>
      ) : (
        <>
          <div className="grid gap-6 xl:grid-cols-[1fr_1.2fr]">
            <NodeCard node={node} mode={data.mode} />
            <ChannelCard node={node} />
          </div>
          <div className="mt-6 grid gap-6 xl:grid-cols-2">
            <InvoiceCard k={sel} onDone={reload} />
            <PayCard k={sel} others={others} onDone={reload} />
          </div>
          <HistoryCard k={sel} />
        </>
      )}
    </>
  )
}

function NodeCard({ node, mode }: { node: Extract<LnNode, { reachable: true }>; mode: string }) {
  const i = node.info
  const rows: [string, React.ReactNode][] = [
    ['Alias', <b key="a">{i.alias}</b>],
    ['Rôle', ROLE_LABEL[node.role] ?? node.role],
    ['Clé publique (identité)', <Mono key="p" value={i.public_key} label="la clé publique" />],
    ['Hauteur de bloc', <span key="h" className="tabular">{i.block_height}</span>],
    ['Synchronisé', i.synced ? <span key="s" className="font-semibold text-brand">Oui</span> : <span key="s" className="text-warn">Non</span>],
    ['Pairs · canaux actifs', `${i.peers} · ${i.active_channels}`],
    ['Version', <span key="v" className="text-muted">{i.version}</span>],
  ]
  return (
    <SectionCard title={`${ROLE_LABEL[node.role] ?? node.role} · ${i.alias}`} icon={<Server />} action={mode === 'mock' ? <span className="rounded-full bg-subtle px-2.5 py-1 text-xs font-semibold text-muted">Simulé</span> : <span className="rounded-full bg-brand-soft px-2.5 py-1 text-xs font-semibold text-brand">Polar</span>}>
      <dl className="divide-y divide-line text-sm">
        {rows.map(([k2, v]) => (
          <div key={k2} className="flex items-center justify-between gap-4 py-2.5">
            <dt className="text-muted">{k2}</dt>
            <dd className="min-w-0 text-right">{v}</dd>
          </div>
        ))}
      </dl>
      <Cli cmd={`lncli --rpcserver=127.0.0.1:1000x --network=regtest getinfo`} />
      <Concept title="Macaroon et TLS" to="/app/academie">
        L’API gRPC de LND est protégée par un certificat <b>TLS</b> (chiffrement) et un <b>macaroon</b> (jeton d’autorisation). Polar les fournit dans l’onglet « Connect » de chaque nœud.
      </Concept>
    </SectionCard>
  )
}

function ChannelCard({ node }: { node: Extract<LnNode, { reachable: true }> }) {
  const b = node.balances
  const channels = node.channels
  return (
    <SectionCard title="Canaux et liquidité" icon={<Network />}>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-subtle p-4">
          <p className="text-xs text-muted">On-chain (portefeuille du nœud)</p>
          <p className="mt-1 font-display text-xl font-bold tabular">{sats(b.onchain_sat)} <span className="text-sm font-semibold text-muted">sats</span></p>
        </div>
        <div className="rounded-xl bg-brand-soft p-4">
          <p className="text-xs text-muted">Dans les canaux (envoyable)</p>
          <p className="mt-1 font-display text-xl font-bold tabular text-brand">{sats(b.offchain_local_sat)} <span className="text-sm font-semibold">sats</span></p>
        </div>
      </div>
      {channels.length === 0 ? (
        <p className="text-sm text-muted">Aucun canal. Dans Polar, ouvrez un canal entre les nœuds pour router les paiements.</p>
      ) : (
        channels.map((c) => {
          const pct = c.capacity ? (c.local_balance / c.capacity) * 100 : 0
          return (
            <div key={c.id} className="flex flex-col gap-3 rounded-2xl border border-line p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 font-semibold">
                  <span className={cx('h-2 w-2 rounded-full', c.is_active ? 'bg-up' : 'bg-down')} /> {node.id} ↔ {c.partner_alias}
                </span>
                <span className="text-muted">Capacité {sats(c.capacity)} sats</span>
              </div>
              <div className="relative h-4 overflow-hidden rounded-full bg-btc/30" role="img" aria-label={`Liquidité locale ${Math.round(pct)} %`}>
                <motion.div className="absolute inset-y-0 left-0 rounded-full bg-brand" initial={false} animate={{ width: `${pct}%` }} transition={{ type: 'spring', stiffness: 80, damping: 18 }} />
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-brand" />Local <b className="tabular">{sats(c.local_balance)}</b></span>
                <span className="flex items-center gap-2">Distant <b className="tabular">{sats(c.remote_balance)}</b><span className="h-2.5 w-2.5 rounded-full bg-btc/60" /></span>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                <span>{c.initiator ? 'Ouvert par ce nœud' : 'Ouvert par le pair'}</span>
                {c.unsettled_balance > 0 && <span className="font-semibold text-warn">{sats(c.unsettled_balance)} sats en HTLC</span>}
              </div>
            </div>
          )
        })
      )}
      <Concept title="Liquidité locale et distante" to="/app/academie">
        Un canal est une transaction 2-sur-2 sur la blockchain. Chaque paiement déplace la répartition : votre solde <b>local</b> est ce que vous pouvez envoyer, le solde <b>distant</b> ce que vous pouvez recevoir.
      </Concept>
    </SectionCard>
  )
}

function InvoiceCard({ k, onDone }: { k: string; onDone: () => void }) {
  const toast = useToast()
  const [amount, setAmount] = useState('1000')
  const [memo, setMemo] = useState('Café Touba')
  const [busy, setBusy] = useState(false)
  const [inv, setInv] = useState<{ id: string; request: string } | null>(null)
  useEffect(() => setInv(null), [k])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    try {
      setInv(await api(`/api/ln/${k}/invoice`, { body: { amount_sat: Number(amount), memo } }))
      onDone()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Erreur', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit}>
      <SectionCard title={`Créer une facture (${k})`} icon={<FileText />} className="h-full">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Montant" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} trailing={<span className="text-sm font-semibold text-btc-ink">sats</span>} />
          <Field label="Description (memo)" value={memo} onChange={(e) => setMemo(e.target.value)} />
        </div>
        <Button type="submit" loading={busy}>
          <FileText className="h-4 w-4" /> Générer la facture BOLT11
        </Button>
        <AnimatePresence>
          {inv && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="grid gap-4 sm:grid-cols-[auto_1fr] sm:items-start">
              <div className="mx-auto rounded-2xl border border-line bg-white p-3">
                <QRCodeSVG value={`lightning:${inv.request}`.toUpperCase()} size={140} />
              </div>
              <div className="flex min-w-0 flex-col gap-2 text-sm">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted">Facture (payment request)</span>
                <Mono value={inv.request} label="la facture" />
                <span className="text-xs font-semibold uppercase tracking-wider text-muted">payment_hash</span>
                <Mono value={inv.id} label="le hash" />
                <p className="text-xs text-muted">Copiez la facture et payez-la depuis un autre nœud, à droite.</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <Cli cmd={`lncli --network=regtest addinvoice --amt ${amount || 0} --memo "${memo}"`} />
        <Concept title="Facture BOLT11" to="/app/academie">
          Une facture encode le montant, le destinataire et le <b>payment_hash</b> = SHA-256 d’un secret (la <b>preimage</b>) que seul le destinataire connaît.
        </Concept>
      </SectionCard>
    </form>
  )
}

function PayCard({ k, others, onDone }: { k: string; others: string[]; onDone: () => void }) {
  const toast = useToast()
  const [req, setReq] = useState('')
  const [dec, setDec] = useState<Decoded | null>(null)
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState<string | null>(null)
  const [result, setResult] = useState<(PayResult & { check?: string }) | null>(null)
  useEffect(() => {
    setDec(null)
    setResult(null)
  }, [k])

  async function decode() {
    setBusy('decode')
    setError(undefined)
    setResult(null)
    try {
      const d = await api<{ decoded: Decoded }>('/api/ln/decode', { body: { request: req } })
      setDec(d.decoded)
    } catch (err) {
      setDec(null)
      setError(err instanceof Error ? err.message : 'Erreur')
    } finally {
      setBusy(null)
    }
  }

  async function pay() {
    setBusy('pay')
    try {
      const r = await api<PayResult>(`/api/ln/${k}/pay`, { body: { request: req } })
      setResult({ ...r, check: r.preimage ? await sha256Hex(r.preimage) : undefined })
      toast('Paiement réussi')
      onDone()
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Erreur', 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <SectionCard title={`Payer une facture (depuis ${k})`} icon={<Zap />} className="h-full">
      <p className="text-xs text-muted">Collez une facture créée par {others.join(' ou ')}.</p>
      <Field label="Facture Lightning" value={req} onChange={(e) => { setReq(e.target.value.trim()); setDec(null); setResult(null) }} placeholder="lnbcrt…" className="[&_input]:font-mono [&_input]:text-sm" error={error} spellCheck={false} />
      <div className="grid grid-cols-2 gap-3">
        <Button variant="secondary" onClick={decode} loading={busy === 'decode'} disabled={!req}>
          <ScanSearch className="h-4 w-4" /> Décoder
        </Button>
        <Button onClick={pay} loading={busy === 'pay'} disabled={!dec}>
          <Zap className="h-4 w-4" /> Payer
        </Button>
      </div>
      {dec && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-xl bg-subtle p-4 text-sm">
          <dt className="text-muted">Montant</dt>
          <dd className="text-right font-semibold">{sats(dec.tokens)} sats</dd>
          <dt className="text-muted">Description</dt>
          <dd className="truncate text-right">{dec.description || '—'}</dd>
          <dt className="text-muted">Destinataire</dt>
          <dd className="text-right">{dec.destination_alias ?? <Mono value={dec.destination} label="la destination" />}</dd>
          <dt className="text-muted">payment_hash</dt>
          <dd className="text-right"><Mono value={dec.id} label="le hash" /></dd>
          <dt className="text-muted">CLTV</dt>
          <dd className="text-right">{dec.cltv_delta} blocs</dd>
        </dl>
      )}
      {result && (
        <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col gap-2 rounded-xl bg-brand-soft p-4 text-sm">
          <p className="flex items-center gap-2 font-semibold text-brand">
            <CheckCircle2 className="h-4 w-4" /> Payé · route {result.route.join(' → ')} · frais {result.fee} sat
          </p>
          {result.preimage && (
            <>
              <span className="text-xs text-muted">Preimage reçue en échange du paiement :</span>
              <Mono value={result.preimage} label="la preimage" />
              {result.check && (
                <p className={cx('text-xs font-semibold', result.check === result.id ? 'text-brand' : 'text-danger')}>
                  SHA-256(preimage) {result.check === result.id ? '=' : '≠'} payment_hash {result.check === result.id ? '✓ preuve de paiement vérifiée dans votre navigateur' : ''}
                </p>
              )}
            </>
          )}
        </motion.div>
      )}
      <Cli cmd={`lncli --network=regtest ${dec ? 'payinvoice' : 'decodepayreq'} ${req ? req.slice(0, 24) + '…' : '<facture>'}`} />
      <Concept title="Preimage = preuve de paiement" to="/app/academie">
        Le paiement voyage en <b>HTLC</b> : il n’est débloqué que contre la preimage. La recevoir prouve mathématiquement que le destinataire a été payé.
      </Concept>
    </SectionCard>
  )
}

function HistoryCard({ k }: { k: string }) {
  const { data } = usePoll<LnHistory>(`/api/ln/${k}/history`, 4000)
  const stateCls = (s: string) =>
    ({ SETTLED: 'bg-brand-soft text-brand', SUCCEEDED: 'bg-brand-soft text-brand', ACCEPTED: 'bg-warn-soft text-warn', IN_FLIGHT: 'bg-warn-soft text-warn', OPEN: 'bg-subtle text-muted', CANCELED: 'bg-danger-soft text-danger', FAILED: 'bg-danger-soft text-danger' })[s] ?? 'bg-subtle text-muted'
  return (
    <SectionCard title={`Historique · ${k}`} icon={<Radio />} className="mt-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <p className="mb-3 text-sm font-semibold">Factures reçues</p>
          {!data?.invoices.length ? (
            <p className="text-sm text-muted">Aucune facture.</p>
          ) : (
            <ul className="divide-y divide-line">
              {data.invoices.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{i.description || 'Sans description'}{i.is_hold ? ' · hold' : ''}</p>
                    <p className="text-xs text-muted">{dateTime(Math.floor(Date.parse(i.created_at) / 1000))}</p>
                  </div>
                  <span className="font-semibold tabular">{sats(i.tokens)}</span>
                  <span className={cx('rounded-full px-2.5 py-1 text-xs font-semibold', stateCls(i.state))}>{i.state}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="mb-3 text-sm font-semibold">Paiements envoyés</p>
          {!data?.payments.length ? (
            <p className="text-sm text-muted">Aucun paiement.</p>
          ) : (
            <ul className="divide-y divide-line">
              {data.payments.map((p, idx) => (
                <li key={`${p.id}-${idx}`} className="flex items-center justify-between gap-3 py-3 text-sm">
                  <Mono value={p.id} label="le hash" />
                  <span className="flex items-center gap-1 font-semibold tabular">
                    <ArrowRight className="h-3.5 w-3.5 text-muted" /> {sats(p.tokens)}
                  </span>
                  <span className={cx('rounded-full px-2.5 py-1 text-xs font-semibold', stateCls(p.status))}>{p.status}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <p className="text-xs text-muted">Les commandes Kaaraange apparaissent ici aussi : ce sont des hold invoices (ACCEPTED = fonds bloqués, SETTLED = livrée, CANCELED = remboursée).</p>
    </SectionCard>
  )
}
