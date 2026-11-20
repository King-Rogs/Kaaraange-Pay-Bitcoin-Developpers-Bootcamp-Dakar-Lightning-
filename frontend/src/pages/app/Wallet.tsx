import { motion } from 'framer-motion'
import { ArrowDownLeft, ArrowUpRight, Coins, CreditCard, RefreshCw, Send, Wallet as WalletIcon } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useState, type FormEvent } from 'react'
import { Btc as BtcAmount } from './walletParts'
import { Mono, SectionCard } from '../../components/Tech'
import { Button, cx, EmptyState, Field } from '../../components/ui'
import { useToast } from '../../context/ToastContext'
import { api, ApiError, type Wallet as W, type WalletTx } from '../../lib/api'
import { btc, dateTime } from '../../lib/format'
import { usePoll } from '../../lib/usePoll'
import { PageHeader } from './AppLayout'

export default function WalletPage() {
  const { data: w, reload } = usePoll<W>('/api/wallet', 4000)
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [allTx, setAllTx] = useState(false)

  async function run<T>(key: string, fn: () => Promise<T>, ok?: (r: T) => string) {
    setBusy(key)
    try {
      const r = await fn()
      if (ok) toast(ok(r))
      await reload()
      return r
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Erreur', 'error')
    } finally {
      setBusy(null)
    }
  }

  async function buy() {
    const before = w?.balances?.trusted_sat ?? 0
    setBusy('buy')
    try {
      await api('/api/wallet/mine', { body: { blocks: 101 } })
      const after = await api<W>('/api/wallet')
      const added = (after.balances?.trusted_sat ?? 0) - before
      toast(added > 0 ? `${added.toLocaleString('fr-FR')} sats ajoutés à votre portefeuille` : 'Achat enregistré : disponible sous peu')
      reload()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Erreur', 'error')
    } finally {
      setBusy(null)
    }
  }

  if (!w) return null

  if (!w.exists) {
    return (
      <>
        <PageHeader title="Portefeuille Bitcoin" text="Votre portefeuille de test : aucune valeur réelle." />
        <div className="card mx-auto flex max-w-2xl flex-col items-center gap-6 p-10 text-center">
          <motion.span initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="grid h-20 w-20 place-items-center rounded-3xl bg-btc-soft text-btc-ink">
            <WalletIcon className="h-9 w-9" />
          </motion.span>
          <div className="flex flex-col gap-2">
            <h2 className="text-2xl font-bold">Créez votre portefeuille</h2>
            <p className="text-muted">Il vous servira à recevoir, envoyer et acheter des bitcoins de test.</p>
          </div>
          <Button size="lg" loading={busy === 'create'} onClick={() => run('create', () => api('/api/wallet/create', { method: 'POST' }), () => 'Portefeuille créé')}>
            <WalletIcon className="h-4 w-4" /> Créer mon portefeuille
          </Button>
        </div>
      </>
    )
  }

  const bal = w.balances!
  const address = w.addresses?.[0] ?? null
  const txs = w.transactions ?? []
  const pendingTotal = bal.untrusted_pending_sat + bal.immature_sat

  return (
    <>
      <PageHeader title="Portefeuille Bitcoin" text="Votre portefeuille de test : aucune valeur réelle." />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="card relative overflow-hidden p-6">
          <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-btc/15 blur-3xl" aria-hidden />
          <p className="text-sm font-medium text-muted">Solde disponible</p>
          <BtcAmount value={bal.trusted_sat} big className="mt-2" />
        </div>
        <div className="card p-6">
          <p className="text-sm font-medium text-muted">En cours de confirmation</p>
          <BtcAmount value={pendingTotal} big className="mt-2" />
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <SectionCard title="Acheter des bitcoins" icon={<CreditCard />}>
          <p className="text-sm leading-relaxed text-muted">Créditez votre portefeuille en un clic pour tester l’application.</p>
          <Button size="lg" loading={busy === 'buy'} onClick={buy}>
            <CreditCard className="h-4 w-4" /> Acheter des bitcoins
          </Button>
        </SectionCard>

        <SectionCard title="Recevoir" icon={<ArrowDownLeft />}>
          {address ? (
            <>
              <div className="mx-auto rounded-2xl border border-line bg-white p-3">
                <QRCodeSVG value={`bitcoin:${address}`} size={156} />
              </div>
              <div className="flex flex-col gap-1.5 rounded-xl bg-subtle p-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted">Votre adresse</span>
                <Mono value={address} short={false} label="l’adresse" />
              </div>
            </>
          ) : null}
          <Button variant="secondary" loading={busy === 'addr'} onClick={() => run('addr', () => api('/api/wallet/address', { method: 'POST' }), () => 'Nouvelle adresse générée')}>
            <RefreshCw className="h-4 w-4" /> Nouvelle adresse
          </Button>
        </SectionCard>

        <SendCard onSent={reload} />
      </div>

      <SectionCard title="Transactions" icon={<Coins />} className="mt-6">
        {txs.length === 0 ? (
          <EmptyState icon={<Coins />} title="Aucune transaction" text="Achetez des bitcoins de test ou recevez-en pour voir votre historique." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-muted">
                  <th className="pb-3 font-semibold">Type</th>
                  <th className="pb-3 font-semibold">Montant</th>
                  <th className="pb-3 font-semibold">Confirmations</th>
                  <th className="pb-3 font-semibold">Transaction</th>
                  <th className="pb-3 font-semibold">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {(allTx ? txs : txs.slice(0, 8)).map((t, i) => (
                  <TxRow key={`${t.txid}-${i}`} t={t} />
                ))}
              </tbody>
            </table>
            {txs.length > 8 && (
              <Button variant="ghost" size="sm" className="mt-3" onClick={() => setAllTx((x) => !x)}>
                {allTx ? 'Afficher moins' : `Afficher les ${txs.length} transactions`}
              </Button>
            )}
          </div>
        )}
      </SectionCard>
    </>
  )
}

const TX_STYLE: Record<string, { label: string; cls: string; icon: JSX.Element }> = {
  receive: { label: 'Reçu', cls: 'bg-brand-soft text-brand', icon: <ArrowDownLeft className="h-3.5 w-3.5" /> },
  send: { label: 'Envoyé', cls: 'bg-danger-soft text-danger', icon: <ArrowUpRight className="h-3.5 w-3.5" /> },
  generate: { label: 'Achat', cls: 'bg-btc-soft text-btc-ink', icon: <CreditCard className="h-3.5 w-3.5" /> },
  immature: { label: 'Achat (en confirmation)', cls: 'bg-subtle text-muted', icon: <CreditCard className="h-3.5 w-3.5" /> },
}

function TxRow({ t }: { t: WalletTx }) {
  const s = TX_STYLE[t.category] ?? TX_STYLE.receive!
  return (
    <tr>
      <td className="py-3.5 pr-4">
        <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold', s.cls)}>
          {s.icon} {s.label}
        </span>
      </td>
      <td className={cx('py-3.5 pr-4 font-semibold tabular', t.amount_sat < 0 ? 'text-danger' : 'text-fg')}>
        {t.amount_sat > 0 ? '+' : ''}
        {t.amount_sat.toLocaleString('fr-FR')} sats
        <span className="block text-xs font-normal text-muted">{btc(Math.abs(t.amount_sat))} BTC</span>
        {t.fee_sat ? <span className="block text-xs font-normal text-muted">frais {Math.abs(t.fee_sat).toLocaleString('fr-FR')}</span> : null}
      </td>
      <td className="py-3.5 pr-4">
        {t.confirmations === 0 ? <span className="rounded-full bg-warn-soft px-2.5 py-1 text-xs font-semibold text-warn">En attente</span> : <span className="tabular">{t.confirmations}</span>}
      </td>
      <td className="py-3.5 pr-4">
        <Mono value={t.txid} label="la transaction" />
      </td>
      <td className="py-3.5 text-muted">{t.time ? dateTime(t.time) : '—'}</td>
    </tr>
  )
}

function SendCard({ onSent }: { onSent: () => void }) {
  const toast = useToast()
  const [address, setAddress] = useState('')
  const [amount, setAmount] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [txid, setTxid] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErrors({})
    try {
      const r = await api<{ txid: string }>('/api/wallet/send', { body: { address, amount_sat: Number(amount) } })
      setTxid(r.txid)
      setAmount('')
      toast('Transaction envoyée')
      onSent()
    } catch (err) {
      if (err instanceof ApiError && err.field) setErrors({ [err.field]: err.message })
      else toast(err instanceof Error ? err.message : 'Erreur', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit}>
      <SectionCard title="Envoyer" icon={<Send />} className="h-full">
        <Field label="Adresse du destinataire" value={address} onChange={(e) => setAddress(e.target.value.trim())} placeholder="bcrt1q…" error={errors.address} className="[&_input]:font-mono [&_input]:text-sm" spellCheck={false} />
        <Field
          label="Montant"
          inputMode="numeric"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))}
          placeholder="50000"
          error={errors.amount}
          trailing={<span className="text-sm font-semibold text-btc-ink">sats</span>}
          hint={amount ? `${btc(Number(amount))} BTC` : undefined}
        />
        <Button type="submit" loading={busy} disabled={!address || !amount}>
          <Send className="h-4 w-4" /> Envoyer
        </Button>
        {txid && (
          <div className="rounded-xl bg-brand-soft p-3 text-sm">
            <p className="font-semibold text-brand">Transaction envoyée</p>
            <Mono value={txid} label="la transaction" />
          </div>
        )}
      </SectionCard>
    </form>
  )
}
