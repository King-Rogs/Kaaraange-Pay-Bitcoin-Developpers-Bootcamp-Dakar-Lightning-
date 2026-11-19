import { AnimatePresence, motion } from 'framer-motion'
import {
  ArrowRight, Bike, Check, ChevronDown, Fingerprint, Hash, KeyRound, Lock, PackageCheck,
  ShieldCheck, ShoppingBag, Store, Timer, Undo2, Wallet, X, Zap,
} from 'lucide-react'
import { useState } from 'react'
import { BitcoinLogo } from '../components/Logo'
import { ChangePill, LiveDot, LivePrice, PriceChart, RangeTabs } from '../components/Market'
import { HeroVisual } from '../components/HeroVisual'
import { Reveal } from '../components/Reveal'
import { Footer, Navbar } from '../components/SiteChrome'
import { cx, LinkButton } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { btc, compact, int, usd } from '../lib/format'
import { useConversions, useMarket, type Range } from '../lib/market'

export default function Landing() {
  return (
    <div className="min-h-screen">
      <Navbar />
      <main>
        <Hero />
        <TickerStrip />
        <Problem />
        <HowItWorks />
        <MarketSection />
        <Security />
        <Personas />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </div>
  )
}

/* ------------------------------------------------------------------ hero */
function Hero() {
  const { user } = useAuth()
  return (
    <section className="relative overflow-hidden">
      <div className="grid-bg pointer-events-none absolute inset-0" aria-hidden />
      <div className="container-x relative grid items-center gap-10 pb-16 pt-12 lg:grid-cols-[1.05fr_1fr] lg:pb-24 lg:pt-20">
        <div className="flex flex-col gap-7">
          <motion.a
            href="#securite"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex w-fit items-center gap-2 rounded-full border border-line bg-surface py-1.5 pl-1.5 pr-3.5 text-[13px] font-medium shadow-sm"
          >
            <span className="inline-flex items-center gap-1 rounded-full bg-btc-soft px-2 py-0.5 text-xs font-semibold text-btc-ink">
              <Zap className="h-3.5 w-3.5" /> Lightning
            </span>
            Propulsé par le réseau Bitcoin
            <ArrowRight className="h-3.5 w-3.5 text-muted" />
          </motion.a>
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            className="text-[44px] font-bold leading-[1.02] sm:text-6xl lg:text-[68px]"
          >
            Achetez en ligne.
            <br />
            <span className="text-brand">Sans risque</span> d’arnaque.
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.7 }}
            className="max-w-xl text-lg leading-relaxed text-muted"
          >
            Sur WhatsApp, TikTok ou Instagram, votre argent reste bloqué sur Bitcoin Lightning jusqu’à la livraison. Le vendeur est payé à la seconde où vous recevez votre colis. Sinon, vous êtes remboursé automatiquement.
          </motion.p>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }} className="flex flex-wrap gap-3">
            <LinkButton to={user ? '/app' : '/inscription'} size="lg">
              {user ? 'Ouvrir mon espace' : 'Commencer gratuitement'} <ArrowRight className="h-4 w-4" />
            </LinkButton>
            <a href="#fonctionnement" className="inline-flex h-12 items-center gap-2 rounded-xl border border-line bg-surface px-6 text-[15px] font-semibold transition hover:bg-subtle">
              Voir comment ça marche
            </a>
          </motion.div>
          <motion.ul initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }} className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted">
            {['Paiement instantané', 'Remboursement automatique', 'Personne ne garde vos fonds'].map((t) => (
              <li key={t} className="flex items-center gap-2">
                <Check className="h-4 w-4 text-brand" strokeWidth={3} /> {t}
              </li>
            ))}
          </motion.ul>
        </div>
        <HeroVisual />
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ bandeau marché */
function TickerStrip() {
  const { ticker } = useMarket()
  const { btcXof, xofToSats } = useConversions()
  const ready = ticker != null && btcXof != null

  // Le bandeau défile en boucle (translateX(-50%) sur son propre contenu dupliqué).
  // On n'en monte l'animation qu'une fois toutes les valeurs connues : sinon,
  // la largeur du contenu change pile au moment où le cours arrive (les « — »
  // laissent place à des chiffres), ce qui fait sauter le défilement en cours.
  if (!ready) {
    return (
      <div className="border-y border-line bg-surface py-4" aria-label="Indicateurs du marché Bitcoin">
        <div className="container-x">
          <div className="h-5 w-full max-w-xl animate-pulse rounded bg-subtle" />
        </div>
      </div>
    )
  }

  const items = [
    { k: 'BTC / USD', v: usd(ticker.price) },
    { k: 'Variation 24 h', v: `${ticker.changePct >= 0 ? '+' : ''}${ticker.changePct.toFixed(2)} %`, tone: ticker.changePct >= 0 ? 'text-up' : 'text-down' },
    { k: 'BTC / FCFA', v: `${int(btcXof)} F` },
    { k: '1 000 FCFA', v: `${int(xofToSats(1000)!)} sats` },
    { k: 'Plus haut 24 h', v: usd(ticker.high) },
    { k: 'Plus bas 24 h', v: usd(ticker.low) },
    { k: 'Volume 24 h', v: `${compact(ticker.volumeUsd)} $` },
  ]
  const row = (
    <div className="flex shrink-0 items-center gap-10 pr-10">
      {items.map((i) => (
        <span key={i.k} className="flex items-center gap-2.5 whitespace-nowrap text-sm">
          <span className="text-muted">{i.k}</span>
          <span className={cx('font-semibold tabular', i.tone)}>{i.v}</span>
          <span className="ml-8 h-1 w-1 rounded-full bg-line" aria-hidden />
        </span>
      ))}
    </div>
  )
  return (
    <div className="border-y border-line bg-surface py-4" aria-label="Indicateurs du marché Bitcoin">
      <div className="flex overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_8%,#000_92%,transparent)]">
        <div className="flex animate-marquee hover:[animation-play-state:paused]">
          {row}
          {row}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ problème */
function SectionHead({ eyebrow, title, text, center }: { eyebrow: string; title: React.ReactNode; text?: string; center?: boolean }) {
  return (
    <Reveal className={cx('flex max-w-2xl flex-col gap-4', center && 'mx-auto items-center text-center')}>
      <span className="eyebrow">{eyebrow}</span>
      <h2 className="text-4xl font-bold leading-[1.08] sm:text-5xl">{title}</h2>
      {text && <p className="text-lg leading-relaxed text-muted">{text}</p>}
    </Reveal>
  )
}

function Problem() {
  const cards = [
    {
      title: 'Payer d’avance',
      who: 'Risque pour l’acheteur',
      text: 'Vous envoyez l’argent, puis plus de nouvelles. Le compte disparaît, le colis n’arrive jamais.',
      icon: <X className="h-5 w-5" />,
      tone: 'bg-danger-soft text-danger',
    },
    {
      title: 'Payer à la livraison',
      who: 'Risque pour le vendeur',
      text: 'Le livreur fait le trajet pour rien : client injoignable, commande refusée, frais perdus.',
      icon: <X className="h-5 w-5" />,
      tone: 'bg-danger-soft text-danger',
    },
    {
      title: 'Kaaraange Pay',
      who: 'Personne ne prend de risque',
      text: 'L’argent est versé mais bloqué. Il n’est libéré qu’à la remise du colis, ou rendu à l’acheteur.',
      icon: <Check className="h-5 w-5" strokeWidth={3} />,
      tone: 'bg-brand text-brand-fg',
      highlight: true,
    },
  ]
  return (
    <section className="container-x py-24 lg:py-32">
      <SectionHead
        eyebrow="Le problème"
        title={<>Le commerce en ligne repose sur la confiance. Elle manque.</>}
        text="Au Sénégal, des milliers de ventes se font chaque jour sur les réseaux sociaux. Et à chaque fois, quelqu’un doit faire confiance à un inconnu."
      />
      <div className="mt-14 grid gap-5 md:grid-cols-3">
        {cards.map((c, i) => (
          <Reveal key={c.title} delay={i * 0.08}>
            <div className={cx('flex h-full flex-col gap-5 rounded-2xl border p-7', c.highlight ? 'border-brand/40 bg-brand-soft/60' : 'border-line bg-surface')}>
              <span className={cx('grid h-11 w-11 place-items-center rounded-xl', c.tone)}>{c.icon}</span>
              <div className="flex flex-col gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted">{c.who}</span>
                <h3 className="text-2xl font-bold">{c.title}</h3>
                <p className="leading-relaxed text-muted">{c.text}</p>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ fonctionnement */
function HowItWorks() {
  const steps = [
    { icon: <Fingerprint />, who: 'Acheteur', title: 'Un code secret est créé', text: 'Votre téléphone génère un code de livraison unique. Seule son empreinte quitte l’appareil.' },
    { icon: <Lock />, who: 'Acheteur', title: 'Vous payez, l’argent est bloqué', text: 'Le paiement part sur Lightning mais reste verrouillé. Le vendeur le voit, sans pouvoir y toucher.' },
    { icon: <Bike />, who: 'Livreur', title: 'Le colis est remis', text: 'Vous vérifiez l’article, puis donnez votre code au livreur ou lui faites scanner le QR.' },
    { icon: <Zap />, who: 'Vendeur', title: 'Le vendeur est payé', text: 'Le code débloque le paiement : le vendeur reçoit ses sats instantanément.' },
  ]
  return (
    <section id="fonctionnement" className="scroll-mt-24 border-y border-line bg-surface py-24 lg:py-32">
      <div className="container-x">
        <SectionHead eyebrow="Fonctionnement" title="Quatre étapes. Zéro confiance aveugle." text="Le séquestre n’est pas une promesse : il est programmé dans le protocole Bitcoin Lightning." />
        <div className="relative mt-16 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          <div className="absolute left-0 right-0 top-7 hidden h-px bg-gradient-to-r from-transparent via-line to-transparent lg:block" aria-hidden />
          {steps.map((s, i) => (
            <Reveal key={s.title} delay={i * 0.1} className="relative flex flex-col gap-5">
              <div className="flex items-center gap-3">
                <span className="relative grid h-14 w-14 place-items-center rounded-2xl border border-line bg-bg text-brand shadow-sm [&>svg]:h-6 [&>svg]:w-6">{s.icon}</span>
                <span className="font-display text-sm font-bold text-muted">0{i + 1}</span>
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-xs font-semibold uppercase tracking-wider text-brand">{s.who}</span>
                <h3 className="text-xl font-bold">{s.title}</h3>
                <p className="leading-relaxed text-muted">{s.text}</p>
              </div>
            </Reveal>
          ))}
        </div>
        <Reveal delay={0.2} className="mt-14 grid gap-4 md:grid-cols-2">
          <div className="flex items-start gap-4 rounded-2xl bg-brand-soft p-6">
            <PackageCheck className="mt-0.5 h-6 w-6 shrink-0 text-brand" />
            <div>
              <p className="font-semibold">Colis livré : vendeur payé</p>
              <p className="mt-1 text-sm leading-relaxed text-muted">Le bon code libère les fonds. Un mauvais code est refusé, l’argent reste bloqué.</p>
            </div>
          </div>
          <div className="flex items-start gap-4 rounded-2xl bg-danger-soft p-6">
            <Undo2 className="mt-0.5 h-6 w-6 shrink-0 text-danger" />
            <div>
              <p className="font-semibold">Pas livré à temps : acheteur remboursé</p>
              <p className="mt-1 text-sm leading-relaxed text-muted">À la date limite, le paiement est annulé automatiquement. Aucune démarche à faire.</p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ marché en direct */
function MarketSection() {
  const [range, setRange] = useState<Range>('24H')
  const { ticker } = useMarket()
  return (
    <section id="marche" className="container-x scroll-mt-24 py-24 lg:py-32">
      <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
        <SectionHead eyebrow="Marché en direct" title="Le Bitcoin, seconde par seconde." text="Les prix affichés dans l’application sont convertis en temps réel. Vous savez toujours combien valent vos sats en francs CFA." />
      </div>
      <div className="mt-12 grid gap-5 lg:grid-cols-[1fr_360px]">
        <Reveal className="card flex flex-col gap-6 p-6 sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="flex items-center gap-4">
              <BitcoinLogo size={48} />
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-3">
                  <span className="font-semibold">Bitcoin</span>
                  <span className="text-sm text-muted">BTC</span>
                  <LiveDot />
                </div>
                <div className="flex flex-wrap items-baseline gap-3">
                  <LivePrice className="font-display text-4xl font-bold sm:text-5xl" />
                  <ChangePill value={ticker?.changePct} className="text-sm" />
                </div>
              </div>
            </div>
            <RangeTabs value={range} onChange={setRange} />
          </div>
          <PriceChart range={range} height={340} />
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4">
            {[
              ['Plus haut 24 h', ticker ? usd(ticker.high) : '—'],
              ['Plus bas 24 h', ticker ? usd(ticker.low) : '—'],
              ['Volume 24 h', ticker ? `${compact(ticker.volumeBtc)} BTC` : '—'],
              ['Variation 24 h', ticker ? usd(ticker.changeAbs) : '—'],
            ].map(([k, v]) => (
              <div key={k} className="flex flex-col gap-1 bg-surface p-4">
                <span className="text-xs text-muted">{k}</span>
                <span className="font-semibold tabular">{v}</span>
              </div>
            ))}
          </div>
        </Reveal>
        <Reveal delay={0.1}>
          <Converter />
        </Reveal>
      </div>
      <p className="mt-4 text-xs text-muted">Source : flux public Binance (BTC/USDT), repli CoinGecko. Conversion FCFA via la parité fixe 1 € = 655,957 F. Informations indicatives, sans valeur de conseil financier.</p>
    </section>
  )
}

function Converter() {
  const { xofToSats, satsToXof, btcXof } = useConversions()
  const [xof, setXof] = useState('15000')
  const [satsVal, setSatsVal] = useState<string | null>(null)
  const xofNum = Number(xof.replace(/\s/g, '')) || 0
  const computedSats = xofToSats(xofNum)
  return (
    <div className="card flex h-full flex-col gap-5 p-6 sm:p-8">
      <div className="flex flex-col gap-1">
        <h3 className="text-xl font-bold">Convertisseur</h3>
        <p className="text-sm text-muted">Combien de sats, et de BTC, pour votre prix en FCFA ?</p>
      </div>
      <label className="flex flex-col gap-2">
        <span className="text-sm font-medium">Montant en FCFA</span>
        <div className="flex h-14 items-center gap-2 rounded-xl border border-line bg-bg px-4 focus-within:border-brand">
          <input
            inputMode="numeric"
            value={xof}
            onChange={(e) => {
              setXof(e.target.value.replace(/[^\d]/g, ''))
              setSatsVal(null)
            }}
            className="min-w-0 flex-1 bg-transparent font-display text-2xl font-bold tabular outline-none"
          />
          <span className="text-sm font-semibold text-muted">FCFA</span>
        </div>
      </label>
      <div className="flex justify-center text-muted" aria-hidden>
        <ChevronDown className="h-5 w-5" />
      </div>
      <label className="flex flex-col gap-2">
        <span className="text-sm font-medium">Montant en satoshis</span>
        <div className="flex h-14 items-center gap-2 rounded-xl border border-line bg-bg px-4 focus-within:border-brand">
          <input
            inputMode="numeric"
            value={satsVal ?? (computedSats != null ? String(Math.round(computedSats)) : '')}
            onChange={(e) => {
              const v = e.target.value.replace(/[^\d]/g, '')
              setSatsVal(v)
              const x = satsToXof(Number(v) || 0)
              if (x != null) setXof(String(Math.round(x)))
            }}
            placeholder="…"
            className="min-w-0 flex-1 bg-transparent font-display text-2xl font-bold tabular outline-none"
          />
          <span className="text-sm font-semibold text-btc-ink">sats</span>
        </div>
      </label>
      <div className="flex items-center justify-between rounded-xl bg-btc-soft px-4 py-3">
        <span className="text-sm font-medium text-btc-ink">≈ en BTC</span>
        <span className="font-display text-lg font-bold tabular text-btc-ink">{computedSats != null ? btc(computedSats) : '—'} BTC</span>
      </div>
      <div className="mt-auto rounded-xl bg-subtle p-4 text-sm">
        <div className="flex justify-between">
          <span className="text-muted">1 BTC</span>
          <span className="font-semibold tabular">{btcXof ? `${int(btcXof)} FCFA` : '—'}</span>
        </div>
        <div className="mt-2 flex justify-between">
          <span className="text-muted">1 sat</span>
          <span className="font-semibold tabular">{btcXof ? `${(btcXof / 1e8).toFixed(3).replace('.', ',')} FCFA` : '—'}</span>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ sécurité */
function Security() {
  const points = [
    { icon: <Hash />, title: 'Hold invoices Lightning', text: 'Une facture « en attente » : l’argent est engagé mais ne peut être encaissé qu’avec le secret de l’acheteur.' },
    { icon: <KeyRound />, title: 'Le secret ne quitte pas votre téléphone', text: 'Il est généré localement. Le serveur ne reçoit que son empreinte SHA-256, jusqu’au moment de la livraison.' },
    { icon: <Timer />, title: 'Délai garanti', text: 'Chaque commande a une date limite. Passé ce délai, le paiement est annulé et les fonds reviennent seuls.' },
    { icon: <Wallet />, title: 'Aucun dépôt chez nous', text: 'Kaaraange Pay orchestre, mais ne détient jamais votre argent. Pas de compte à vider, pas de caisse à piller.' },
  ]
  const steps = [
    { done: true, title: 'Vous payez', text: 'Votre paiement part, mais reste verrouillé : personne ne peut encore l’encaisser.' },
    { done: true, title: 'Le colis arrive', text: 'Vous vérifiez l’article, puis donnez votre code au livreur.' },
    { done: false, title: 'Le vendeur est payé', text: 'Le bon code débloque le paiement, instantanément.' },
    { done: false, title: 'Jamais livré ? Remboursé.', text: 'Passé le délai, le paiement annulé revient seul dans votre portefeuille.' },
  ]
  return (
    <section id="securite" className="scroll-mt-24 bg-[#0B110E] py-24 text-white lg:py-32">
      <div className="container-x grid gap-14 lg:grid-cols-2 lg:items-center">
        <div className="flex flex-col gap-10">
          <Reveal className="flex flex-col gap-4">
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[#5BE39A]">Sécurité</span>
            <h2 className="text-4xl font-bold leading-[1.08] sm:text-5xl">
              Personne ne garde l’argent.
              <br />
              <span className="text-[#F5C518]">Pas même nous.</span>
            </h2>
            <p className="text-lg leading-relaxed text-white/65">La garantie vient du protocole Bitcoin, pas d’une entreprise à qui il faudrait faire confiance.</p>
          </Reveal>
          <div className="grid gap-6 sm:grid-cols-2">
            {points.map((p, i) => (
              <Reveal key={p.title} delay={i * 0.06} className="flex flex-col gap-3">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-white/5 text-[#5BE39A] ring-1 ring-white/10 [&>svg]:h-5 [&>svg]:w-5">{p.icon}</span>
                <h3 className="text-lg font-bold">{p.title}</h3>
                <p className="text-sm leading-relaxed text-white/60">{p.text}</p>
              </Reveal>
            ))}
          </div>
        </div>
        <Reveal delay={0.15}>
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#111A15] p-6 shadow-float sm:p-8">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/40">Le parcours de votre paiement</p>
            <div className="relative mt-6 flex flex-col gap-7">
              <div className="absolute bottom-4 left-[15px] top-4 w-px bg-white/10" aria-hidden />
              {steps.map((s) => (
                <div key={s.title} className="relative flex gap-4">
                  <span
                    className={cx(
                      'relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full',
                      s.done ? 'bg-[#5BE39A] text-[#0B110E]' : 'border-2 border-white/20 bg-[#0B110E] text-white/40',
                    )}
                  >
                    {s.done ? <Check className="h-4 w-4" strokeWidth={3} /> : <Lock className="h-3.5 w-3.5" />}
                  </span>
                  <div className="pb-1">
                    <p className="font-semibold">{s.title}</p>
                    <p className="mt-0.5 text-sm leading-relaxed text-white/55">{s.text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ pour qui */
function Personas() {
  const tabs = [
    {
      id: 'vendeurs', label: 'Vendeurs', icon: <Store className="h-4 w-4" />,
      title: 'Vendez à des inconnus, sans peur des faux clients.',
      points: ['L’argent est engagé avant que le livreur ne parte', 'Paiement reçu à la seconde de la livraison', 'Tableau de bord des commandes et des fonds bloqués', 'Aucune commission de mobile money à l’encaissement'],
    },
    {
      id: 'acheteurs', label: 'Acheteurs', icon: <ShoppingBag className="h-4 w-4" />,
      title: 'Payez en ligne comme si vous payiez en main propre.',
      points: ['Votre argent ne part chez le vendeur qu’à la réception', 'Remboursement automatique en cas de non-livraison', 'Un code de livraison que vous seul possédez', 'Suivi de la commande étape par étape'],
    },
    {
      id: 'livreurs', label: 'Livreurs', icon: <Bike className="h-4 w-4" />,
      title: 'Plus de trajets pour rien.',
      points: ['La commande est déjà payée quand vous partez', 'Une saisie ou un scan pour confirmer la remise', 'Pas d’espèces à transporter', 'Historique des livraisons confirmées'],
    },
  ]
  const [active, setActive] = useState(tabs[0]!.id)
  const tab = tabs.find((t) => t.id === active)!
  return (
    <section className="container-x py-24 lg:py-32">
      <SectionHead eyebrow="Pour qui" title="Une seule app, trois rôles." center />
      <div className="mt-10 flex justify-center">
        <div role="tablist" className="inline-flex rounded-2xl border border-line bg-surface p-1.5">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={active === t.id}
              onClick={() => setActive(t.id)}
              className={cx('relative flex h-11 items-center gap-2 rounded-xl px-5 text-sm font-semibold transition', active === t.id ? 'text-brand-fg' : 'text-muted hover:text-fg')}
            >
              {active === t.id && <motion.span layoutId="persona-pill" className="absolute inset-0 rounded-xl bg-brand" transition={{ type: 'spring', duration: 0.4 }} />}
              <span className="relative flex items-center gap-2">
                {t.icon} {t.label}
              </span>
            </button>
          ))}
        </div>
      </div>
      <AnimatePresence mode="wait">
        <motion.div
          key={tab.id}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.25 }}
          className="card mx-auto mt-8 grid max-w-4xl gap-8 p-8 sm:p-10 md:grid-cols-[1fr_1.1fr] md:items-center"
        >
          <h3 className="text-3xl font-bold leading-tight">{tab.title}</h3>
          <ul className="flex flex-col gap-3.5">
            {tab.points.map((p) => (
              <li key={p} className="flex items-start gap-3">
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-soft text-brand">
                  <Check className="h-3 w-3" strokeWidth={3} />
                </span>
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </motion.div>
      </AnimatePresence>
    </section>
  )
}


/* ------------------------------------------------------------------ FAQ */
function Faq() {
  const qa = [
    ['Faut-il comprendre Bitcoin pour utiliser Kaaraange Pay ?', 'Non. Vous voyez les prix en FCFA et suivez votre commande étape par étape. Le réseau Lightning travaille en arrière-plan.'],
    ['Que se passe-t-il si je ne reçois jamais mon colis ?', 'Rien à faire : à la date limite, le paiement bloqué est annulé et les sats reviennent dans votre portefeuille.'],
    ['Le vendeur peut-il encaisser avant la livraison ?', 'Non. Il ne connaît que l’empreinte de votre code, pas le code lui-même. Sans lui, la facture ne peut pas être encaissée.'],
    ['Et si le livreur saisit un mauvais code ?', 'Il est refusé. L’argent reste bloqué jusqu’à ce que le bon code soit fourni, ou jusqu’au remboursement automatique.'],
    ['Combien de temps l’argent peut-il rester bloqué ?', 'Le système est pensé pour la livraison du jour même, quelques heures au plus. C’est une contrainte technique du réseau Lightning.'],
    ['Comment passer du FCFA aux sats ?', 'Via un portefeuille Lightning et un service d’échange. Une intégration avec le mobile money est prévue dans la feuille de route.'],
  ]
  const [open, setOpen] = useState<number | null>(0)
  return (
    <section id="faq" className="scroll-mt-24 border-t border-line py-24 lg:py-32">
      <div className="container-x grid gap-12 lg:grid-cols-[1fr_1.4fr]">
        <SectionHead eyebrow="FAQ" title="Questions fréquentes" text="Vous ne trouvez pas votre réponse ? Écrivez-nous, l’équipe répond vite." />
        <div className="flex flex-col divide-y divide-line border-y border-line">
          {qa.map(([q, a], i) => (
            <div key={q}>
              <button
                className="flex w-full items-center justify-between gap-6 py-5 text-left text-[17px] font-semibold"
                onClick={() => setOpen(open === i ? null : i)}
                aria-expanded={open === i}
              >
                {q}
                <ChevronDown className={cx('h-5 w-5 shrink-0 text-muted transition-transform', open === i && 'rotate-180')} />
              </button>
              <AnimatePresence initial={false}>
                {open === i && (
                  <motion.p
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden pb-5 pr-10 leading-relaxed text-muted"
                  >
                    {a}
                  </motion.p>
                )}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ CTA */
function FinalCta() {
  const { user } = useAuth()
  return (
    <section className="container-x py-24">
      <Reveal className="relative overflow-hidden rounded-3xl bg-brand px-8 py-16 text-center text-white sm:px-16">
        <div className="pointer-events-none absolute -right-16 -top-16 opacity-15" aria-hidden>
          <BitcoinLogo size={280} />
        </div>
        <div className="relative mx-auto flex max-w-2xl flex-col items-center gap-6">
          <ShieldCheck className="h-12 w-12" />
          <h2 className="text-4xl font-bold leading-tight sm:text-5xl">Votre prochaine vente sera protégée.</h2>
          <p className="text-lg text-white/80">Créez votre compte en une minute. Mettez un article en vente, partagez le lien, et laissez Lightning faire le reste.</p>
          <div className="flex flex-wrap justify-center gap-3">
            <LinkButton to={user ? '/app' : '/inscription'} size="lg" variant="invert">
              {user ? 'Ouvrir mon espace' : 'Créer mon compte'} <ArrowRight className="h-4 w-4" />
            </LinkButton>
          </div>
        </div>
      </Reveal>
    </section>
  )
}
