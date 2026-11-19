import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, Globe, Mail, Menu, MessageCircle, Send, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useMarket } from '../lib/market'
import { Logo, BitcoinLogo } from './Logo'
import { ChangePill, LivePrice } from './Market'
import { ThemeToggle } from './ThemeToggle'
import { Avatar, btnClass, cx, LinkButton } from './ui'

const LINKS = [
  { href: '/#fonctionnement', label: 'Fonctionnement' },
  { href: '/#marche', label: 'Marché' },
  { href: '/#securite', label: 'Sécurité' },
  { href: '/#faq', label: 'FAQ' },
]

export function Navbar() {
  const { user } = useAuth()
  const { ticker } = useMarket()
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8)
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])

  return (
    <header
      className={cx(
        'sticky top-0 z-50 transition-all duration-300',
        scrolled ? 'border-b border-line bg-bg/80 backdrop-blur-xl' : 'border-b border-transparent',
      )}
    >
      <div className="container-x flex h-[72px] items-center gap-6">
        <Logo />
        <nav className="ml-6 hidden items-center gap-1 lg:flex" aria-label="Navigation principale">
          {LINKS.map((l) => (
            <Link key={l.href} to={l.href} className="rounded-lg px-3 py-2 text-sm font-medium text-muted transition hover:text-fg">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2.5">
          <Link to="/#marche" className="hidden items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm md:flex" aria-label="Cours du Bitcoin">
            <BitcoinLogo size={18} />
            <LivePrice className="font-semibold" />
            <ChangePill value={ticker?.changePct} className="hidden xl:inline-flex" />
          </Link>
          <ThemeToggle />
          {user ? (
            <Link to="/app" className={btnClass('primary', 'md', 'hidden sm:inline-flex')}>
              <Avatar name={user.name} url={user.avatar_url} size={24} className="-ml-1.5 ring-2 ring-brand-fg/30" />
              Mon espace
            </Link>
          ) : (
            <>
              <LinkButton to="/connexion" variant="ghost" className="hidden sm:inline-flex">
                Se connecter
              </LinkButton>
              <LinkButton to="/inscription" className="hidden sm:inline-flex">
                Créer un compte
              </LinkButton>
            </>
          )}
          <button
            className="grid h-10 w-10 place-items-center rounded-xl border border-line bg-surface lg:hidden"
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? 'Fermer le menu' : 'Ouvrir le menu'}
            aria-expanded={open}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-line bg-bg lg:hidden"
          >
            <div className="container-x flex flex-col gap-1 py-4">
              {LINKS.map((l) => (
                <Link key={l.href} to={l.href} onClick={() => setOpen(false)} className="rounded-lg px-3 py-3 font-medium hover:bg-subtle">
                  {l.label}
                </Link>
              ))}
              <div className="mt-3 grid grid-cols-2 gap-2">
                {user ? (
                  <LinkButton to="/app" className="col-span-2">Mon espace</LinkButton>
                ) : (
                  <>
                    <LinkButton to="/connexion" variant="secondary">Se connecter</LinkButton>
                    <LinkButton to="/inscription">Créer un compte</LinkButton>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  )
}

const FOOTER = [
  { title: 'Produit', links: [['Fonctionnement', '/#fonctionnement'], ['Cours du Bitcoin', '/#marche'], ['Sécurité', '/#securite'], ['Créer un compte', '/inscription']] },
  { title: 'Ressources', links: [['Questions fréquentes', '/#faq'], ['Lightning Network', 'https://lightning.network'], ['Bitcoin.org', 'https://bitcoin.org/fr/'], ['Code source', '#']] },
  { title: 'Légal', links: [['Conditions d’utilisation', '#'], ['Confidentialité', '#'], ['Mentions légales', '#']] },
]

export function Footer() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  return (
    <footer className="border-t border-line bg-surface">
      <div className="container-x grid gap-12 py-16 lg:grid-cols-[1.3fr_2fr]">
        <div className="flex max-w-sm flex-col gap-5">
          <Logo />
          <p className="text-sm leading-relaxed text-muted">
            Le paiement sécurisé pour le commerce sur les réseaux sociaux au Sénégal. L’argent reste bloqué sur Bitcoin Lightning jusqu’à la livraison.
          </p>
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              if (email.includes('@')) setSent(true)
            }}
          >
            <label htmlFor="newsletter" className="text-sm font-semibold">
              Suivre le lancement
            </label>
            {sent ? (
              <p className="text-sm text-brand">Merci ! Nous vous écrirons au lancement.</p>
            ) : (
              <div className="flex gap-2">
                <input
                  id="newsletter"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="vous@exemple.sn"
                  className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-bg px-3.5 text-sm outline-none focus:border-brand"
                />
                <button className={btnClass('dark', 'md', 'px-4')} aria-label="S’inscrire">
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            )}
          </form>
        </div>
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
          {FOOTER.map((col) => (
            <div key={col.title} className="flex flex-col gap-3">
              <p className="text-sm font-semibold">{col.title}</p>
              {col.links.map(([label, href]) => (
                <a key={label} href={href} className="text-sm text-muted transition hover:text-fg" {...(href!.startsWith('http') ? { target: '_blank', rel: 'noreferrer' } : {})}>
                  {label}
                </a>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="border-t border-line">
        <div className="container-x flex flex-col items-center justify-between gap-4 py-6 text-sm text-muted sm:flex-row">
          <p>© {new Date().getFullYear()} Kaaraange Pay · Fait à Dakar · Hackathon Bitcoin Bootcamp</p>
          <div className="flex items-center gap-2">
            {[
              { icon: <MessageCircle className="h-4 w-4" />, label: 'WhatsApp' },
              { icon: <Send className="h-4 w-4" />, label: 'Telegram' },
              { icon: <Mail className="h-4 w-4" />, label: 'E-mail' },
              { icon: <Globe className="h-4 w-4" />, label: 'Site web' },
            ].map((s) => (
              <a key={s.label} href="#" aria-label={s.label} className="grid h-9 w-9 place-items-center rounded-lg border border-line transition hover:bg-subtle hover:text-fg">
                {s.icon}
              </a>
            ))}
          </div>
        </div>
      </div>
    </footer>
  )
}
