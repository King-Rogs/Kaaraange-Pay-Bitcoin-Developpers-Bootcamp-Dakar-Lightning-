import { motion } from 'framer-motion'
import { Check, Lock, ShieldCheck, Zap } from 'lucide-react'
import { MiniTicker } from './Market'

/** Illustration du hero : un téléphone avec l'app, et des cartes flottantes. */
export function HeroVisual() {
  return (
    <div className="relative mx-auto h-[600px] w-full max-w-[520px]" aria-hidden>
      {/* halo */}
      <div className="absolute left-1/2 top-1/2 h-[420px] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand/20 blur-[100px]" />

      {/* téléphone */}
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        className="absolute left-1/2 top-4 w-[280px] -translate-x-1/2 rounded-[44px] border border-line bg-[#0B110E] p-2.5 dark:bg-[#2A3530] shadow-float"
      >
        <div className="relative overflow-hidden rounded-[36px] bg-bg">
          <div className="absolute left-1/2 top-2.5 z-10 h-6 w-24 -translate-x-1/2 rounded-full bg-[#0B110E]" />
          <div className="flex flex-col gap-3 px-4 pb-5 pt-12">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-bold">Ma commande</span>
              <span className="rounded-full bg-warn-soft px-2 py-0.5 text-[10px] font-bold text-warn">Fonds bloqués</span>
            </div>
            <div className="flex flex-col gap-2 rounded-2xl bg-[#0E1A14] p-4 text-white">
              <div className="flex items-center gap-2.5">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#3A2F0B]">
                  <Lock className="h-4 w-4 text-[#F5C518]" />
                </span>
                <div className="flex flex-col">
                  <span className="font-display text-lg font-bold">25 000 sats</span>
                  <span className="text-[10px] text-white/60">en sécurité sur Lightning</span>
                </div>
              </div>
              <span className="text-[11px] leading-snug text-white/75">Le vendeur ne peut pas encaisser sans votre code.</span>
            </div>
            <div className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-3">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted">Code de livraison</span>
              <div className="grid grid-cols-4 gap-1">
                {['7f3a91c2', 'e84b0d56', '2a9fc731', 'b6e04d8a'].map((g) => (
                  <span key={g} className="rounded-md bg-subtle py-1 text-center font-mono text-[9px] font-semibold">
                    {g}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-2.5 rounded-2xl border border-line bg-surface p-3">
              {[
                ['Commande payée', true],
                ['Fonds bloqués', true],
                ['Colis remis', false],
                ['Vendeur payé', false],
              ].map(([l, done], i) => (
                <div key={String(l)} className="flex items-center gap-2.5">
                  <span className={`grid h-4 w-4 place-items-center rounded-full ${done ? 'bg-brand' : 'border-2 border-line'}`}>
                    {done && <Check className="h-2.5 w-2.5 text-brand-fg" strokeWidth={3} />}
                  </span>
                  <span className={`text-[11px] ${done ? 'font-semibold' : 'text-muted'}`}>{l}</span>
                  {i === 1 && <span className="ml-auto h-1.5 w-1.5 animate-pulseDot rounded-full bg-warn" />}
                </div>
              ))}
            </div>
            <div className="mt-1 flex h-10 items-center justify-center gap-1.5 rounded-xl bg-brand text-[12px] font-semibold text-brand-fg">
              <Zap className="h-3.5 w-3.5" /> Afficher en QR code
            </div>
          </div>
        </div>
      </motion.div>

      {/* carte BTC en direct */}
      <motion.div
        initial={{ opacity: 0, x: 30 }}
        animate={{ opacity: 1, x: 0, y: [0, -8, 0] }}
        transition={{ opacity: { delay: 0.4 }, x: { delay: 0.4 }, y: { duration: 6, repeat: Infinity, ease: 'easeInOut' } }}
        className="absolute -right-2 top-24 w-[250px] sm:-right-14"
      >
        <MiniTicker className="shadow-float" />
      </motion.div>

      {/* notification vendeur payé */}
      <motion.div
        initial={{ opacity: 0, x: -30 }}
        animate={{ opacity: 1, x: 0, y: [0, 8, 0] }}
        transition={{ opacity: { delay: 0.6 }, x: { delay: 0.6 }, y: { duration: 7, repeat: Infinity, ease: 'easeInOut' } }}
        className="card absolute -left-2 bottom-24 flex w-[250px] items-center gap-3 p-3.5 shadow-float sm:-left-10"
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand text-brand-fg">
          <Check className="h-5 w-5" strokeWidth={3} />
        </span>
        <div className="flex flex-col">
          <span className="text-sm font-semibold">Livraison confirmée</span>
          <span className="text-xs text-muted">Awa Couture · +25 000 sats</span>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.8 }}
        className="card absolute bottom-6 right-4 flex items-center gap-2 px-3 py-2 text-xs font-semibold shadow-card"
      >
        <ShieldCheck className="h-4 w-4 text-brand" /> Remboursement auto si non livré
      </motion.div>
    </div>
  )
}
