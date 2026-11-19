import { Blocks, Gauge, Layers, Pickaxe } from 'lucide-react'
import { useState } from 'react'
import { Cli, Concept, Mono, SectionCard } from '../../components/Tech'
import { Button, Spinner } from '../../components/ui'
import { api } from '../../lib/api'
import type { BlockDetail, BlockSummary, ChainInfo } from '../../lib/api'
import { dateTime, sats } from '../../lib/format'
import { usePoll } from '../../lib/usePoll'
import { PageHeader } from './AppLayout'

export default function Explorer() {
  const { data: chain } = usePoll<ChainInfo>('/api/btc/chain', 3000)
  const { data: blocksData, reload } = usePoll<{ blocks: BlockSummary[] }>('/api/btc/blocks?limit=15', 4000)
  const [open, setOpen] = useState<BlockDetail | null>(null)
  const [loading, setLoading] = useState<number | null>(null)

  async function show(height: number) {
    setLoading(height)
    try {
      const d = await api<{ block: BlockDetail }>(`/api/btc/block/${height}`)
      setOpen(d.block)
    } finally {
      setLoading(null)
    }
  }

  return (
    <>
      <PageHeader title="Explorateur de blocs" text="La chaîne regtest, bloc par bloc, comme un explorateur public." />

      <div className="grid gap-4 sm:grid-cols-4">
        <Kpi icon={<Layers />} label="Hauteur" value={chain?.blocks ?? '…'} />
        <Kpi icon={<Gauge />} label="Mempool" value={chain ? `${chain.mempool_size} tx` : '…'} />
        <Kpi icon={<Pickaxe />} label="Difficulté" value={chain ? chain.difficulty.toExponential(2) : '…'} />
        <Kpi icon={<Blocks />} label="Chaîne" value={chain?.chain ?? '…'} />
      </div>

      <SectionCard title="Derniers blocs" icon={<Blocks />} className="mt-6" action={<Button variant="ghost" size="sm" onClick={() => reload()}>Actualiser</Button>}>
        {!blocksData ? (
          <div className="grid h-32 place-items-center"><Spinner /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-muted">
                  <th className="pb-3 font-semibold">Hauteur</th>
                  <th className="pb-3 font-semibold">Hash</th>
                  <th className="pb-3 font-semibold">Transactions</th>
                  <th className="pb-3 font-semibold">Horodatage</th>
                  <th className="pb-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {blocksData.blocks.map((b) => (
                  <tr key={b.hash}>
                    <td className="py-3 pr-4 font-semibold tabular">{b.height}</td>
                    <td className="py-3 pr-4"><Mono value={b.hash} label="le hash" /></td>
                    <td className="py-3 pr-4 tabular">{b.n_tx}</td>
                    <td className="py-3 pr-4 text-muted">{dateTime(b.time)}</td>
                    <td className="py-3 text-right">
                      <Button size="sm" variant="secondary" loading={loading === b.height} onClick={() => show(b.height)}>Détail</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Cli cmd="bitcoin-cli -regtest getblock $(bitcoin-cli -regtest getblockhash <hauteur>)" />
        <Concept title="Chaîne de blocs" to="/app/academie">
          Chaque bloc pointe vers le hash du précédent : modifier un bloc ancien changerait son hash et casserait la chaîne — c’est ce qui rend l’historique infalsifiable.
        </Concept>
      </SectionCard>

      {open && (
        <SectionCard title={`Bloc ${open.height}`} icon={<Blocks />} className="mt-6" action={<Button variant="ghost" size="sm" onClick={() => setOpen(null)}>Fermer</Button>}>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-xl bg-subtle p-4 text-sm">
            <dt className="text-muted">Hash</dt>
            <dd className="text-right"><Mono value={open.hash} label="le hash" /></dd>
            <dt className="text-muted">Bloc précédent</dt>
            <dd className="text-right">{open.previousblockhash ? <Mono value={open.previousblockhash} label="le bloc précédent" /> : '—'}</dd>
            <dt className="text-muted">Confirmations</dt>
            <dd className="text-right tabular">{open.confirmations}</dd>
          </dl>
          <div className="flex flex-col gap-2">
            {open.txs.map((t) => (
              <div key={t.txid} className="rounded-xl border border-line p-3">
                <div className="flex items-center justify-between gap-3">
                  <Mono value={t.txid} label="le txid" />
                  {t.coinbase && <span className="rounded-full bg-btc-soft px-2 py-0.5 text-xs font-semibold text-btc-ink">Coinbase</span>}
                </div>
                <div className="mt-2 flex flex-col gap-1 text-xs">
                  {t.vout.map((o) => (
                    <div key={o.n} className="flex items-center justify-between text-muted">
                      <span>Sortie #{o.n} {o.address ? <Mono value={o.address} label="l’adresse" /> : ''}</span>
                      <span className="font-semibold tabular text-fg">{sats(o.value_sat)} sats</span>
                    </div>
                  ))}
                  {t.fee_sat > 0 && <div className="flex justify-end text-muted">frais {t.fee_sat} sats</div>}
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      )}
    </>
  )
}

function Kpi({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="card flex items-center gap-3 p-4">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand [&>svg]:h-5 [&>svg]:w-5">{icon}</span>
      <div>
        <p className="text-xs text-muted">{label}</p>
        <p className="font-display text-lg font-bold tabular">{value}</p>
      </div>
    </div>
  )
}
