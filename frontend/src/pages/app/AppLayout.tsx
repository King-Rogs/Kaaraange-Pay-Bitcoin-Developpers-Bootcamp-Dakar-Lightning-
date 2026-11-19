import { AnimatePresence, motion } from 'framer-motion'
import { Bike, Blocks, Gauge, GraduationCap, LayoutDashboard, LogOut, Map, Menu, Package, ScrollText, Server, ShieldCheck, ShoppingBag, Store, Tag, UserRound, Users, Wallet, X, Zap } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { BitcoinLogo, Logo } from '../../components/Logo'
import { ChangePill, LivePrice } from '../../components/Market'
import { ThemeToggle } from '../../components/ThemeToggle'
import { Avatar, cx, Spinner } from '../../components/ui'
import { useAuth } from '../../context/AuthContext'
import { useMarket } from '../../lib/market'

type NavItem = { to: string; label: string; icon: typeof Store; end?: boolean }
const NAV: { title: string; items: NavItem[] }[] = [
  {
    title: 'Commerce',
    items: [
      { to: '/app', label: 'Tableau de bord', icon: LayoutDashboard, end: true },
      { to: '/app/boutique', label: 'Ma boutique', icon: Store },
      { to: '/app/marche', label: 'Acheter', icon: ShoppingBag },
      { to: '/app/achats', label: 'Mes achats', icon: Package },
    ],
  },
  {
    title: 'Livraison',
    items: [{ to: '/app/livreur', label: 'Espace livreur', icon: Bike }],
  },
  {
    title: 'Bitcoin & Lightning',
    items: [
      { to: '/app/portefeuille', label: 'Portefeuille', icon: Wallet },
      { to: '/app/lightning', label: 'Console Lightning', icon: Zap },
      { to: '/app/explorateur', label: 'Explorateur', icon: Blocks },
      { to: '/app/academie', label: 'Académie', icon: GraduationCap },
    ],
  },
  { title: 'Compte', items: [{ to: '/app/profil', label: 'Mon profil', icon: UserRound }] },
]

const ADMIN_NAV: { title: string; items: NavItem[] } = {
  title: 'Administration',
  items: [
    { to: '/app/admin', label: 'Vue d’ensemble', icon: Gauge, end: true },
    { to: '/app/admin/utilisateurs', label: 'Utilisateurs', icon: Users },
    { to: '/app/admin/commandes', label: 'Commandes et litiges', icon: Package },
    { to: '/app/admin/dispatch', label: 'Dispatch', icon: Map },
    { to: '/app/admin/articles', label: 'Modération', icon: Tag },
    { to: '/app/admin/systeme', label: 'Santé du système', icon: Server },
    { to: '/app/admin/journal', label: 'Journal d’audit', icon: ScrollText },
  ],
}

function SideNav({ onNavigate }: { onNavigate?: () => void }) {
  const { user } = useAuth()
  const groups = user?.is_admin ? [ADMIN_NAV, ...NAV] : NAV
  return (
    <nav className="flex flex-col gap-5" aria-label="Application">
      {groups.map((group) => (
        <div key={group.title} className="flex flex-col gap-1">
          <p className={cx('flex items-center gap-1.5 px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.12em]', group === ADMIN_NAV ? 'text-btc-ink' : 'text-muted/80')}>
            {group === ADMIN_NAV && <ShieldCheck className="h-3.5 w-3.5" />}
            {group.title}
          </p>
          {group.items.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cx(
              'flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition',
              isActive ? 'bg-brand-soft text-brand' : 'text-muted hover:bg-subtle hover:text-fg',
            )
          }
        >
          <Icon className="h-[18px] w-[18px]" />
          {label}
        </NavLink>
          ))}
        </div>
      ))}
    </nav>
  )
}

function UserMenu() {
  const { user, logout } = useAuth()
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])
  if (!user) return null
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2.5 rounded-xl p-1 pr-2 transition hover:bg-subtle" aria-haspopup="menu" aria-expanded={open}>
        <Avatar name={user.name} url={user.avatar_url} size={36} />
        <span className="hidden max-w-[140px] truncate text-sm font-semibold sm:block">{user.name}</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-12 z-50 w-64 overflow-hidden rounded-2xl border border-line bg-surface p-1.5 shadow-float"
          >
            <div className="flex items-center gap-3 px-3 py-3">
              <Avatar name={user.name} url={user.avatar_url} size={40} />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{user.name}</p>
                <p className="truncate text-xs text-muted">{user.email}</p>
                {user.is_admin && (
                  <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-btc-soft px-2 py-0.5 text-[11px] font-semibold text-btc-ink">
                    <ShieldCheck className="h-3 w-3" /> Administrateur
                  </span>
                )}
              </div>
            </div>
            <div className="my-1 h-px bg-line" />
            <Link role="menuitem" to="/app/profil" onClick={() => setOpen(false)} className="flex h-10 items-center gap-2.5 rounded-lg px-3 text-sm hover:bg-subtle">
              <UserRound className="h-4 w-4" /> Mon profil
            </Link>
            <button
              role="menuitem"
              onClick={async () => {
                await logout()
                nav('/')
              }}
              className="flex h-10 w-full items-center gap-2.5 rounded-lg px-3 text-sm text-danger hover:bg-danger-soft"
            >
              <LogOut className="h-4 w-4" /> Se déconnecter
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default function AppLayout() {
  const { user, loading } = useAuth()
  const { ticker } = useMarket()
  const loc = useLocation()
  const [drawer, setDrawer] = useState(false)

  if (loading)
    return (
      <div className="grid min-h-screen place-items-center">
        <Spinner className="h-7 w-7" />
      </div>
    )
  if (!user) return <Navigate to="/connexion" replace state={{ from: loc.pathname }} />

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="sticky top-0 hidden h-screen flex-col gap-7 overflow-y-auto border-r border-line bg-surface px-4 py-6 lg:flex">
        <Logo to="/" className="px-2" />
        <SideNav />
        <div className="mt-auto shrink-0 rounded-2xl bg-subtle p-4">
          <p className="text-sm font-semibold">Mode démo</p>
          <p className="mt-1 text-xs leading-relaxed text-muted">Les paiements passent par les nœuds Lightning de test (regtest). Aucun vrai bitcoin n’est utilisé.</p>
        </div>
      </aside>

      <AnimatePresence>
        {drawer && (
          <>
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setDrawer(false)} />
            <motion.aside
              initial={{ x: -300 }}
              animate={{ x: 0 }}
              exit={{ x: -300 }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="fixed inset-y-0 left-0 z-50 flex w-[280px] flex-col gap-8 overflow-y-auto bg-surface px-4 py-6 lg:hidden"
            >
              <div className="flex items-center justify-between px-2">
                <Logo to="/" />
                <button onClick={() => setDrawer(false)} className="grid h-10 w-10 place-items-center rounded-xl hover:bg-subtle" aria-label="Fermer le menu">
                  <X className="h-5 w-5" />
                </button>
              </div>
              <SideNav onNavigate={() => setDrawer(false)} />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-[68px] items-center gap-3 border-b border-line bg-bg/80 px-4 backdrop-blur-xl sm:px-8">
          <button onClick={() => setDrawer(true)} className="grid h-10 w-10 place-items-center rounded-xl border border-line bg-surface lg:hidden" aria-label="Ouvrir le menu">
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm">
            <BitcoinLogo size={18} />
            <LivePrice className="font-semibold" />
            <ChangePill value={ticker?.changePct} className="hidden sm:inline-flex" />
          </div>
          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>
        <main className="flex-1 px-4 py-8 sm:px-8 lg:py-10">
          <motion.div key={loc.pathname} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="mx-auto max-w-6xl">
            <Outlet />
          </motion.div>
        </main>
      </div>
    </div>
  )
}

export function PageHeader({ title, text, action }: { title: string; text?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-3xl font-bold">{title}</h1>
        {text && <p className="text-muted">{text}</p>}
      </div>
      {action}
    </div>
  )
}
