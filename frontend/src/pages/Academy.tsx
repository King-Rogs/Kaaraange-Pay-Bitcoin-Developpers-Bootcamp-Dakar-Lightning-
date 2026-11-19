import { ArrowRight, Blocks, Cpu, FileText, Fingerprint, GitBranch, KeyRound, Lock, Network, RefreshCw, Server, Terminal } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { BitcoinLogo } from '../components/Logo'
import { Reveal } from '../components/Reveal'
import { Cli, sha256Hex } from '../components/Tech'
import { Button, cx } from '../components/ui'

type Module = {
  id: string
  icon: ReactNode
  part: 'Bitcoin' | 'Lightning'
  title: string
  intro: string
  points: string[]
  cmds: string[]
  app: { to: string; label: string }
}

const MODULES: Module[] = [
  {
    id: 'regtest', icon: <Cpu />, part: 'Bitcoin', title: 'Bitcoin Core et le mode regtest',
    intro: 'Bitcoin Core est l’implémentation de référence du protocole. Compilé depuis les sources avec CMake, il fournit bitcoind (le nœud) et bitcoin-cli (la ligne de commande).',
    points: ['regtest crée une blockchain locale et privée que vous contrôlez entièrement', 'On mine des blocs instantanément, sans vrais bitcoins', 'Configuration dans bitcoin.conf : regtest=1, server=1, rpcuser, rpcpassword, rpcport=18443, fallbackfee'],
    cmds: ['cmake -B build && cmake --build build -j $(nproc)', 'bitcoind -regtest -daemon', 'bitcoin-cli -regtest getblockchaininfo'],
    app: { to: '/app/explorateur', label: 'Explorateur de blocs' },
  },
  {
    id: 'wallet', icon: <KeyRound />, part: 'Bitcoin', title: 'Portefeuilles, clés et adresses',
    intro: 'Un portefeuille garde des clés privées. Chaque clé publique dérivée donne une adresse ; seuls les détenteurs de la clé privée peuvent dépenser ce qui y est envoyé.',
    points: ['createwallet crée un portefeuille à descripteurs dans Bitcoin Core', 'getnewaddress génère une adresse bech32 (SegWit) : bcrt1… en regtest, bc1… sur le vrai réseau', 'Une nouvelle adresse par réception protège la vie privée'],
    cmds: ['bitcoin-cli -regtest createwallet "bootcamp_wallet"', 'bitcoin-cli -regtest getnewaddress "" bech32', 'bitcoin-cli -regtest getbalance'],
    app: { to: '/app/portefeuille', label: 'Mon portefeuille' },
  },
  {
    id: 'mining', icon: <Blocks />, part: 'Bitcoin', title: 'Blocs, minage et coinbase',
    intro: 'Un bloc regroupe des transactions et pointe vers le bloc précédent par son hash. Le mineur ajoute en tête une transaction coinbase qui crée de nouveaux bitcoins.',
    points: ['Récompense initiale de 50 BTC ; en regtest elle est divisée par deux tous les 150 blocs', 'Une coinbase n’est dépensable qu’après 100 blocs : d’où les 101 blocs à miner au départ', 'Le hash du bloc précédent rend l’historique infalsifiable'],
    cmds: ['bitcoin-cli -regtest generatetoaddress 101 $(bitcoin-cli -regtest getnewaddress)', 'bitcoin-cli -regtest getblock $(bitcoin-cli -regtest getbestblockhash)'],
    app: { to: '/app/portefeuille', label: 'Miner des blocs' },
  },
  {
    id: 'tx', icon: <GitBranch />, part: 'Bitcoin', title: 'Transactions, UTXO et frais',
    intro: 'Bitcoin fonctionne avec des sorties non dépensées (UTXO). Une transaction consomme des UTXO en entrée et en crée de nouvelles en sortie, dont la monnaie rendue.',
    points: ['La différence entre entrées et sorties constitue les frais, payés au mineur', 'Une transaction diffusée attend dans la mempool, puis est confirmée dans un bloc', 'Chaque nouveau bloc ajoute une confirmation'],
    cmds: ['bitcoin-cli -regtest sendtoaddress <adresse> 1.5', 'bitcoin-cli -regtest listunspent', 'bitcoin-cli -regtest getmempoolinfo'],
    app: { to: '/app/portefeuille', label: 'Envoyer et voir mes UTXO' },
  },
  {
    id: 'rpc', icon: <Terminal />, part: 'Bitcoin', title: 'Piloter un nœud avec Python (RPC et REST)',
    intro: 'bitcoin-cli n’est qu’un client JSON-RPC. Avec Python (python-bitcoinlib, requests), on envoie les mêmes appels depuis une application.',
    points: ['JSON-RPC sur le port 18443 avec rpcuser / rpcpassword', 'Kaaraange Pay appelle createwallet, getnewaddress, sendtoaddress… depuis son backend Flask', 'Les nœuds Lightning s’interrogent en REST avec requests'],
    cmds: ['pip install python-bitcoinlib requests', 'curl --user bootcamp:bootcamp123 --data-binary \'{"method":"getblockcount"}\' http://127.0.0.1:18443'],
    app: { to: '/app/portefeuille', label: 'Voir les commandes dans l’app' },
  },
  {
    id: 'channels', icon: <Network />, part: 'Lightning', title: 'Canaux de paiement et liquidité',
    intro: 'Lightning est une couche au-dessus de Bitcoin. Deux nœuds verrouillent des fonds dans une transaction 2-sur-2 (le canal), puis s’échangent des paiements instantanés hors chaîne.',
    points: ['Ouvrir ou fermer un canal = une transaction on-chain', 'Solde local = ce que vous pouvez envoyer ; solde distant = ce que vous pouvez recevoir', 'Les paiements traversent plusieurs canaux grâce au routage'],
    cmds: ['lncli --network=regtest openchannel --node_key <pubkey> --local_amt 500000', 'lncli --network=regtest listchannels', 'lncli --network=regtest channelbalance'],
    app: { to: '/app/lightning', label: 'Console Lightning' },
  },
  {
    id: 'invoices', icon: <FileText />, part: 'Lightning', title: 'Factures BOLT11 et paiements',
    intro: 'Pour être payé, un nœud crée une facture BOLT11 : une chaîne lnbcrt… qui encode le montant, la description, le destinataire et le payment_hash.',
    points: ['payment_hash = SHA-256(preimage) ; la preimage est le secret du destinataire', 'decodepayreq révèle le contenu d’une facture avant de payer', 'Une fois payé, le payeur reçoit la preimage : c’est sa preuve de paiement'],
    cmds: ['lncli --network=regtest addinvoice --amt 1000 --memo "café"', 'lncli --network=regtest decodepayreq <facture>', 'lncli --network=regtest payinvoice <facture>'],
    app: { to: '/app/lightning', label: 'Créer et payer une facture' },
  },
  {
    id: 'htlc', icon: <Lock />, part: 'Lightning', title: 'HTLC et hold invoices : notre séquestre',
    intro: 'Un paiement Lightning voyage sous forme de HTLC (Hash Time-Locked Contract) : il n’est débloqué que contre la preimage, avant une hauteur de bloc limite (CLTV).',
    points: ['Avec une hold invoice, c’est l’acheteur qui crée la preimage : le vendeur n’a que le hash', 'Payée, la facture passe en ACCEPTED : les fonds sont engagés mais bloqués', 'settle(preimage) paie le vendeur ; cancel(hash) rembourse l’acheteur'],
    cmds: ['POST /v2/invoices/hodl   {hash, value}', 'POST /v2/invoices/settle {preimage}', 'POST /v2/invoices/cancel {payment_hash}'],
    app: { to: '/app/achats', label: 'Mes achats protégés' },
  },
  {
    id: 'polar', icon: <Server />, part: 'Lightning', title: 'Polar, LND, macaroons et TLS',
    intro: 'Polar lance en un clic un réseau Lightning local dans Docker : un bitcoind regtest et des nœuds LND (alice, bob…) avec une interface visuelle.',
    points: ['Chaque nœud expose une API REST (alice : 8081, bob : 8082) et gRPC', 'Le macaroon admin autorise les appels ; le certificat TLS chiffre la connexion', 'Le bouton « + » de Polar mine des blocs ; glisser un lien entre deux nœuds ouvre un canal'],
    cmds: ['curl --cacert tls.cert -H "Grpc-Metadata-macaroon: $(xxd -ps -u -c 1000 admin.macaroon)" https://127.0.0.1:8081/v1/getinfo'],
    app: { to: '/app/lightning', label: 'Voir les nœuds alice et bob' },
  },
]

const JOURNEY = ['Installation (CMake, WSL, Docker)', 'Bitcoin Core en regtest', 'Portefeuilles et adresses', 'Transactions et UTXO', 'Python et RPC', 'Canaux Lightning', 'Factures et HTLC', 'Hackathon : Kaaraange Pay']

export function AcademyContent({ inApp }: { inApp?: boolean }) {
  useEffect(() => {
    if (window.location.hash) window.setTimeout(() => document.querySelector(window.location.hash)?.scrollIntoView({ behavior: 'smooth' }), 150)
  }, [])
  return (
    <div className="flex flex-col gap-16">
      <div className={cx('flex flex-col gap-6', !inApp && 'items-center text-center')}>
        <span className="eyebrow">Académie Kaaraange</span>
        <h1 className={cx('font-bold leading-[1.05]', inApp ? 'text-3xl' : 'text-4xl sm:text-6xl')}>Tout ce que nous avons appris au Bitcoin Bootcamp, dans une seule application.</h1>
        <p className={cx('text-lg leading-relaxed text-muted', !inApp && 'max-w-2xl')}>
          Chaque notion de la formation est utilisée quelque part dans Kaaraange Pay. Voici le cours, la commande correspondante, et l’écran où la voir en action.
        </p>
      </div>

      <div className="card overflow-x-auto p-6">
        <ol className="flex min-w-[860px] items-start">
          {JOURNEY.map((j, i) => (
            <li key={j} className="relative flex flex-1 flex-col items-center gap-3 text-center">
              {i < JOURNEY.length - 1 && <span className="absolute left-1/2 top-4 h-0.5 w-full bg-line" aria-hidden />}
              <span className={cx('relative grid h-8 w-8 place-items-center rounded-full text-xs font-bold', i === JOURNEY.length - 1 ? 'bg-btc text-white' : 'bg-brand text-brand-fg')}>{i + 1}</span>
              <span className="px-1 text-xs font-medium leading-snug">{j}</span>
            </li>
          ))}
        </ol>
      </div>

      <HashPlayground />

      {(['Bitcoin', 'Lightning'] as const).map((part) => (
        <section key={part} className="flex flex-col gap-6">
          <div className="flex items-center gap-3">
            {part === 'Bitcoin' ? <BitcoinLogo size={36} /> : <span className="grid h-9 w-9 place-items-center rounded-full bg-[#7B2BF9] text-white"><ZapIcon /></span>}
            <h2 className="text-3xl font-bold">{part === 'Bitcoin' ? 'Couche 1 : Bitcoin' : 'Couche 2 : Lightning Network'}</h2>
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            {MODULES.filter((m) => m.part === part).map((m, i) => (
              <Reveal key={m.id} delay={(i % 2) * 0.06}>
                <article id={m.id} className="card flex h-full scroll-mt-28 flex-col gap-5 p-6">
                  <div className="flex items-center gap-3">
                    <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-soft text-brand [&>svg]:h-5 [&>svg]:w-5">{m.icon}</span>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted">Module {MODULES.indexOf(m) + 1}</p>
                      <h3 className="text-xl font-bold">{m.title}</h3>
                    </div>
                  </div>
                  <p className="leading-relaxed text-muted">{m.intro}</p>
                  <ul className="flex flex-col gap-2 text-sm">
                    {m.points.map((p) => (
                      <li key={p} className="flex gap-2.5">
                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
                        {p}
                      </li>
                    ))}
                  </ul>
                  <div className="flex flex-col gap-2">
                    {m.cmds.map((c) => (
                      <Cli key={c} cmd={c} />
                    ))}
                  </div>
                  <Link to={m.app.to} className="group mt-auto inline-flex w-fit items-center gap-2 rounded-xl bg-subtle px-4 py-2.5 text-sm font-semibold transition hover:bg-brand-soft hover:text-brand">
                    Dans Kaaraange Pay : {m.app.label}
                    <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                  </Link>
                </article>
              </Reveal>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

function ZapIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden>
      <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />
    </svg>
  )
}

/** Démonstration interactive : preimage → payment_hash, calculé dans le navigateur. */
function HashPlayground() {
  const random = () => [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('')
  const [pre, setPre] = useState(random)
  const [hash, setHash] = useState('')
  const valid = /^[0-9a-f]{64}$/.test(pre)
  useEffect(() => {
    if (valid) sha256Hex(pre).then(setHash)
    else setHash('')
  }, [pre, valid])

  return (
    <section id="hash" className="scroll-mt-28 overflow-hidden rounded-3xl bg-[#0B110E] text-white">
      <div className="grid gap-8 p-8 lg:grid-cols-[1fr_1.3fr] lg:p-10">
        <div className="flex flex-col gap-4">
          <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#5BE39A]">
            <Fingerprint className="h-4 w-4" /> Atelier interactif
          </span>
          <h2 className="text-3xl font-bold leading-tight">Preimage et payment_hash : le secret qui protège chaque paiement</h2>
          <p className="leading-relaxed text-white/65">
            Changez un seul caractère de la preimage : le hash change complètement. Retrouver la preimage à partir du hash est impossible. C’est pour ça qu’un vendeur qui ne connaît que le hash ne peut pas encaisser.
          </p>
        </div>
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-2">
            <span className="text-sm font-semibold">Preimage (secret de l’acheteur, 32 octets en hexadécimal)</span>
            <textarea
              value={pre}
              onChange={(e) => setPre(e.target.value.trim().toLowerCase())}
              rows={2}
              spellCheck={false}
              className={cx('resize-none rounded-xl border bg-white/5 p-3 font-mono text-sm outline-none', valid ? 'border-white/15 focus:border-[#5BE39A]' : 'border-[#FF8F86]')}
            />
            {!valid && <span className="text-xs text-[#FF8F86]">64 caractères hexadécimaux (0-9, a-f) attendus.</span>}
          </label>
          <div className="flex items-center gap-3 text-sm text-white/60">
            <span className="h-px flex-1 bg-white/15" />
            SHA-256
            <span className="h-px flex-1 bg-white/15" />
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-semibold">payment_hash (ce que reçoit le vendeur)</span>
            <code className="break-all rounded-xl bg-white/5 p-3 font-mono text-sm text-[#F5C518]">{hash || '…'}</code>
          </div>
          <Button variant="secondary" className="w-fit border-white/15 bg-white/5 text-white hover:bg-white/10" onClick={() => setPre(random())}>
            <RefreshCw className="h-4 w-4" /> Nouveau secret aléatoire
          </Button>
        </div>
      </div>
    </section>
  )
}
