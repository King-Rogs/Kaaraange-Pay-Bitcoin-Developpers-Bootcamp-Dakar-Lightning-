import { motion } from 'framer-motion'
import { ArrowDownLeft, ArrowUpRight, Coins, Hammer, KeyRound, Pickaxe, RefreshCw, Send, Wallet as WalletIcon } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useState, type FormEvent } from 'react'
import { Btc as BtcAmount } from './walletParts'
import { Cli, Concept, Mono, SectionCard } from '../../components/Tech'
import { Button, cx, EmptyState, Field } from '../../components/ui'
import { useToast } from '../../context/ToastContext'
import { api, ApiError, type Wallet as W, type WalletTx } from '../../lib/api'
import { dateTime } from '../../lib/format'
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

  if (!w) return null

  if (!w.exists) {
    return (
      <>
        <PageHeader title="Portefeuille Bitcoin" text="Votre portefeuille on-chain sur le réseau de test (regtest)." />
        <div className="card mx-auto flex max-w-2xl flex-col items-center gap-6 p-10 text-center">
          <motion.span initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="grid h-20 w-20 place-items-center rounded-3xl bg-btc-soft text-btc-ink">
            <WalletIcon className="h-9 w-9" />
          </motion.span>
          <div className="flex flex-col gap-2">
            <h2 className="text-2xl font-bold">Créez votre portefeuille</h2>
            <p className="text-muted">
              Bitcoin Core va générer vos clés privées et les garder dans un portefeuille à votre nom. Vous pourrez ensuite recevoir, miner et envoyer des bitcoins de test.
            </p>
          </div>
          <Cli cmd={`bitcoin-cli -regtest createwallet "${w.name}"`} className="w-full text-left" />
          <Button size="lg" loading={busy === 'create'} onClick={() => run('create', () => api('/api/wallet/create', { method: 'POST' }), () => 'Portefeuille créé')}>
            <KeyRound className="h-4 w-4" /> Créer mon portefeuille
          </Button>
          <Concept title="Notion : portefeuille et clés" to="/app/academie">
            Un portefeuille ne contient pas de bitcoins : il contient des <b>clés privées</b>. Les bitcoins restent sur la blockchain, verrouillés à des adresses que seules vos clés peuvent dépenser.
          </Concept>
        </div>
      </>
    )
  }

  const bal = w.balances!
  const address = w.addresses?.[0] ?? null
  const txs = w.transactions ?? []
  const utxos = w.utxos ?? []

  return (
    <>
      <PageHeader
        title="Portefeuille Bitcoin"
        text="Recevoir, miner, envoyer : toutes les opérations on-chain vues au bootcamp."
        action={
          <span className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm">
            <span className="text-muted">Portefeuille</span>
            <code className="font-mono text-xs font-semibold">{w.name}</code>
          </span>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <div className="card relative overflow-hidden p-6 md:col-span-1">
          <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-btc/15 blur-3xl" aria-hidden />
          <p className="text-sm font-medium text-muted">Solde disponible</p>
          <BtcAmount value={bal.trusted_sat} big className="mt-2" />
          <p className="mt-3 text-xs text-muted">Confirmé et dépensable (getbalances → trusted)</p>
        </div>
        <div className="card p-6">
          <p className="text-sm font-medium text-muted">En attente (mempool)</p>
          <BtcAmount value={bal.untrusted_pending_sat} big className="mt-2" />
          <p className="mt-3 text-xs text-muted">Transactions reçues, pas encore dans un bloc</p>
        </div>
        <div className="card p-6">
          <p className="text-sm font-medium text-muted">Immature (minage)</p>
          <BtcAmount value={bal.immature_sat} big className="mt-2" />
          <p className="mt-3 text-xs text-muted">Récompenses de bloc : dépensables après 100 blocs</p>
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <SectionCard title="Recevoir" icon={<ArrowDownLeft />}>
          {address ? (
            <>
              <div className="mx-auto rounded-2xl border border-line bg-white p-3">
                <QRCodeSVG value={`bitcoin:${address}`} size={156} />
              </div>
              <div className="flex flex-col gap-1.5 rounded-xl bg-subtle p-3">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted">Adresse bech32 (SegWit)</span>
                <Mono value={address} short={false} label="l’adresse" />
              </div>
            </>
          ) : null}
          <Button variant="secondary" loading={busy === 'addr'} onClick={() => run('addr', () => api('/api/wallet/address', { method: 'POST' }), () => 'Nouvelle adresse générée')}>
            <RefreshCw className="h-4 w-4" /> Nouvelle adresse
          </Button>
          <Cli cmd={`bitcoin-cli -regtest -rpcwallet=${w.name} getnewaddress "" bech32`} />
          <Concept title="Une adresse par paiement" to="/app/academie">
            Les adresses <b>bcrt1…</b> sont propres à regtest (mainnet : bc1…). En générer une nouvelle à chaque réception protège votre vie privée.
          </Concept>
        </SectionCard>

        <SectionCard title="Miner des blocs" icon={<Pickaxe />}>
          <p className="text-sm leading-relaxed text-muted">
            En regtest, vous êtes le seul mineur : chaque bloc vous rapporte la récompense (subvention + frais) sur votre adresse. C’est le « robinet » de bitcoins de test.
          </p>
          <div className="grid grid-cols-3 gap-2">
            {[1, 10, 101].map((n) => (
              <Button
                key={n}
                variant={n === 101 ? 'primary' : 'secondary'}
                loading={busy === `mine${n}`}
                onClick={() => run(`mine${n}`, () => api<{ mined: number }>('/api/wallet/mine', { body: { blocks: n } }), (r) => `${r.mined} bloc${r.mined > 1 ? 's' : ''} miné${r.mined > 1 ? 's' : ''}`)}
              >
                <Hammer className="h-4 w-4" /> {n}
              </Button>
            ))}
          </div>
          <Cli cmd={`bitcoin-cli -regtest generatetoaddress 101 ${address ?? '<adresse>'}`} />
          <Concept title="Pourquoi 101 blocs ?" to="/app/academie">
            Une récompense de minage (transaction <b>coinbase</b>) n’est dépensable qu’après 100 blocs supplémentaires. Avec 101 blocs, la première récompense de 50 BTC devient disponible.
          </Concept>
        </SectionCard>

        <SendCard walletName={w.name} onSent={reload} />
      </div>

      <SectionCard title="Transactions" icon={<Coins />} className="mt-6">
        {txs.length === 0 ? (
          <EmptyState icon={<Coins />} title="Aucune transaction" text="Minez quelques blocs ou recevez des bitcoins pour voir votre historique." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-muted">
                  <th className="pb-3 font-semibold">Type</th>
                  <th className="pb-3 font-semibold">Montant</th>
                  <th className="pb-3 font-semibold">Confirmations</th>
                  <th className="pb-3 font-semibold">Transaction (txid)</th>
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
        <Cli cmd={`bitcoin-cli -regtest -rpcwallet=${w.name} listtransactions`} />
      </SectionCard>

      <SectionCard title="Vos pièces (UTXO)" icon={<Coins />} className="mt-6">
        <Concept title="Notion : le modèle UTXO" to="/app/academie">
          Bitcoin ne gère pas de « comptes » : votre solde est la somme de sorties de transactions non dépensées (<b>UTXO</b>). Envoyer, c’est consommer des UTXO en entrée et en créer de nouveaux en sortie, dont la monnaie qui vous revient.
        </Concept>
        {utxos.length === 0 ? (
          <p className="text-sm text-muted">Aucun UTXO pour l’instant.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {utxos.slice(0, 12).map((u) => (
              <div key={`${u.txid}:${u.vout}`} className="flex items-center justify-between gap-3 rounded-xl border border-line p-3">
                <div className="min-w-0">
                  <Mono value={`${u.txid}:${u.vout}`} label="l’outpoint" />
                  <p className="text-xs text-muted">
                    {u.confirmations} confirmation{u.confirmations > 1 ? 's' : ''} {!u.spendable && '· non dépensable'}
                  </p>
                </div>
                <span className="shrink-0 font-semibold tabular">{(u.amount_sat / 1e8).toLocaleString('fr-FR', { maximumFractionDigits: 8 })} ₿</span>
              </div>
            ))}
          </div>
        )}
        <Cli cmd={`bitcoin-cli -regtest -rpcwallet=${w.name} listunspent`} />
      </SectionCard>
    </>
  )
}

const TX_STYLE: Record<string, { label: string; cls: string; icon: JSX.Element }> = {
  receive: { label: 'Reçu', cls: 'bg-brand-soft text-brand', icon: <ArrowDownLeft className="h-3.5 w-3.5" /> },
  send: { label: 'Envoyé', cls: 'bg-danger-soft text-danger', icon: <ArrowUpRight className="h-3.5 w-3.5" /> },
  generate: { label: 'Minage', cls: 'bg-btc-soft text-btc-ink', icon: <Pickaxe className="h-3.5 w-3.5" /> },
  immature: { label: 'Minage (immature)', cls: 'bg-subtle text-muted', icon: <Pickaxe className="h-3.5 w-3.5" /> },
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
        {t.fee_sat ? <span className="block text-xs font-normal text-muted">frais {Math.abs(t.fee_sat).toLocaleString('fr-FR')}</span> : null}
      </td>
      <td className="py-3.5 pr-4">
        {t.confirmations === 0 ? <span className="rounded-full bg-warn-soft px-2.5 py-1 text-xs font-semibold text-warn">Mempool</span> : <span className="tabular">{t.confirmations}</span>}
      </td>
      <td className="py-3.5 pr-4">
        <Mono value={t.txid} label="le txid" />
      </td>
      <td className="py-3.5 text-muted">{t.time ? dateTime(t.time) : '—'}</td>
    </tr>
  )
}

function SendCard({ walletName, onSent }: { walletName: string; onSent: () => void }) {
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
      toast('Transaction diffusée dans la mempool')
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
        <Field label="Montant" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))} placeholder="50000" error={errors.amount} trailing={<span className="text-sm font-semibold text-btc-ink">sats</span>} />
        <Button type="submit" loading={busy} disabled={!address || !amount}>
          <Send className="h-4 w-4" /> Envoyer
        </Button>
        {txid && (
          <div className="rounded-xl bg-brand-soft p-3 text-sm">
            <p className="font-semibold text-brand">Transaction diffusée</p>
            <Mono value={txid} label="le txid" />
            <p className="mt-1 text-xs text-muted">Elle sera confirmée au prochain bloc miné.</p>
          </div>
        )}
        <Cli cmd={`bitcoin-cli -regtest -rpcwallet=${walletName} sendtoaddress ${address || '<adresse>'} ${amount ? (Number(amount) / 1e8).toFixed(8) : '<montant>'}`} />
      </SectionCard>
    </form>
  )
}
