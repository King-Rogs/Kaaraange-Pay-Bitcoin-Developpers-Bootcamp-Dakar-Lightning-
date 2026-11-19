import { motion } from 'framer-motion'
import { ArrowLeft, Check, CircleCheck, Lock, Mail, User as UserIcon } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Logo, BitcoinLogo } from '../components/Logo'
import { ChangePill, LiveDot, LivePrice, PriceChart } from '../components/Market'
import { ThemeToggle } from '../components/ThemeToggle'
import { Button, cx, Field } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { api, ApiError } from '../lib/api'
import { useMarket } from '../lib/market'

function AuthLayout({ title, subtitle, children }: { title: string; subtitle: ReactNode; children: ReactNode }) {
  const { ticker } = useMarket()
  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_1.05fr]">
      <div className="flex flex-col px-6 py-6 sm:px-12">
        <div className="flex items-center justify-between">
          <Logo />
          <ThemeToggle />
        </div>
        <div className="mx-auto flex w-full max-w-[420px] flex-1 flex-col justify-center py-12">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="flex flex-col gap-8">
            <div className="flex flex-col gap-2">
              <h1 className="text-3xl font-bold sm:text-4xl">{title}</h1>
              <p className="text-muted">{subtitle}</p>
            </div>
            {children}
          </motion.div>
        </div>
        <p className="text-center text-xs text-muted">© {new Date().getFullYear()} Kaaraange Pay · Paiements sécurisés par Bitcoin Lightning</p>
      </div>

      <aside className="relative hidden overflow-hidden bg-[#0B110E] p-12 text-white lg:flex lg:flex-col">
        <div className="pointer-events-none absolute -right-24 -top-24 h-[420px] w-[420px] rounded-full bg-[#0A7A42]/40 blur-[120px]" aria-hidden />
        <div className="relative flex flex-1 flex-col justify-between gap-10">
          <div className="flex flex-col gap-6">
            <h2 className="max-w-md text-4xl font-bold leading-tight">
              L’argent ne bouge que quand <span className="text-[#F5C518]">le colis arrive</span>.
            </h2>
            <ul className="flex flex-col gap-3 text-white/75">
              {['Fonds bloqués sur Lightning jusqu’à la livraison', 'Code secret généré sur votre téléphone', 'Remboursement automatique si non livré'].map((t) => (
                <li key={t} className="flex items-center gap-3">
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-[#0A7A42]">
                    <Check className="h-3 w-3" strokeWidth={3} />
                  </span>
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="dark rounded-2xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <BitcoinLogo size={36} />
                <div className="flex flex-col">
                  <span className="text-sm font-semibold">Bitcoin</span>
                  <span className="text-xs text-white/50">BTC / USD</span>
                </div>
              </div>
              <LiveDot />
            </div>
            <div className="mt-4 flex items-baseline gap-3">
              <LivePrice className="font-display text-3xl font-bold" />
              <ChangePill value={ticker?.changePct} />
            </div>
            <PriceChart range="24H" height={150} axes={false} />
          </div>
        </div>
      </aside>
    </div>
  )
}

function FormError({ msg }: { msg: string | null }) {
  if (!msg) return null
  return (
    <div role="alert" className="rounded-xl border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
      {msg}
    </div>
  )
}

function useRedirectIfAuthed() {
  const { user, loading } = useAuth()
  return !loading && user
}

/* ------------------------------------------------------------------ connexion */
export function Login() {
  const { login } = useAuth()
  const nav = useNavigate()
  const loc = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (useRedirectIfAuthed()) return <Navigate to="/app" replace />

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(email, password, remember)
      nav((loc.state as { from?: string })?.from ?? '/app', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur inattendue')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout title="Bon retour parmi nous" subtitle={<>Pas encore de compte ? <Link to="/inscription" className="font-semibold text-brand hover:underline">Créer un compte</Link></>}>
      <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
        <FormError msg={error} />
        <Field label="Adresse e-mail" type="email" autoComplete="email" icon={<Mail />} value={email} onChange={(e) => { setEmail(e.target.value); setError(null) }} placeholder="vous@exemple.sn" required />
        <Field label="Mot de passe" type="password" autoComplete="current-password" icon={<Lock />} value={password} onChange={(e) => { setPassword(e.target.value); setError(null) }} placeholder="Votre mot de passe" required />
        <div className="flex items-center justify-between text-sm">
          <label className="flex cursor-pointer items-center gap-2.5">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4 rounded accent-[rgb(var(--brand))]" />
            Rester connecté
          </label>
          <Link to="/mot-de-passe-oublie" className="font-semibold text-brand hover:underline">
            Mot de passe oublié ?
          </Link>
        </div>
        <Button type="submit" size="lg" loading={busy}>
          Se connecter
        </Button>
      </form>
    </AuthLayout>
  )
}

/* ------------------------------------------------------------------ inscription */
export function strength(pw: string) {
  let s = 0
  if (pw.length >= 8) s++
  if (pw.length >= 12) s++
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) s++
  if (/\d/.test(pw)) s++
  if (/[^A-Za-z0-9]/.test(pw)) s++
  return Math.min(4, s)
}

export function StrengthMeter({ pw }: { pw: string }) {
  const s = strength(pw)
  const labels = ['Trop faible', 'Faible', 'Moyen', 'Bon', 'Excellent']
  const colors = ['bg-danger', 'bg-danger', 'bg-warn', 'bg-brand', 'bg-brand']
  if (!pw) return null
  return (
    <div className="flex items-center gap-3">
      <div className="grid flex-1 grid-cols-4 gap-1.5">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={cx('h-1.5 rounded-full transition', i < s ? colors[s] : 'bg-line')} />
        ))}
      </div>
      <span className="w-20 text-right text-xs font-medium text-muted">{labels[s]}</span>
    </div>
  )
}

export function Register() {
  const { register } = useAuth()
  const nav = useNavigate()
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [accept, setAccept] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  if (useRedirectIfAuthed()) return <Navigate to="/app" replace />

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!accept) {
      setError('Acceptez les conditions d’utilisation pour continuer.')
      return
    }
    setBusy(true)
    setError(null)
    setErrors({})
    try {
      await register(form.name, form.email, form.password)
      nav('/app', { replace: true })
    } catch (err) {
      if (err instanceof ApiError && err.field) setErrors({ [err.field]: err.message })
      else setError(err instanceof Error ? err.message : 'Erreur inattendue')
    } finally {
      setBusy(false)
    }
  }

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [k]: e.target.value })
    setErrors((prev) => (prev[k] ? { ...prev, [k]: '' } : prev))
    setError(null)
  }

  return (
    <AuthLayout title="Créez votre compte" subtitle={<>Déjà inscrit ? <Link to="/connexion" className="font-semibold text-brand hover:underline">Se connecter</Link></>}>
      <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
        <FormError msg={error} />
        <Field label="Nom complet" autoComplete="name" icon={<UserIcon />} value={form.name} onChange={set('name')} placeholder="Awa Diop" error={errors.name} />
        <Field label="Adresse e-mail" type="email" autoComplete="email" icon={<Mail />} value={form.email} onChange={set('email')} placeholder="vous@exemple.sn" error={errors.email} />
        <div className="flex flex-col gap-2.5">
          <Field
            label="Mot de passe"
            type="password"
            autoComplete="new-password"
            icon={<Lock />}
            value={form.password}
            onChange={set('password')}
            placeholder="8 caractères minimum"
            error={errors.password}
            hint="Au moins 8 caractères, avec des lettres et des chiffres."
          />
          <StrengthMeter pw={form.password} />
        </div>
        <label className="flex cursor-pointer items-start gap-2.5 text-sm text-muted">
          <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[rgb(var(--brand))]" />
          <span>
            J’accepte les <a href="#" className="font-semibold text-fg underline">conditions d’utilisation</a> et la <a href="#" className="font-semibold text-fg underline">politique de confidentialité</a>.
          </span>
        </label>
        <Button type="submit" size="lg" loading={busy}>
          Créer mon compte
        </Button>
      </form>
    </AuthLayout>
  )
}

/* ------------------------------------------------------------------ mot de passe oublié */
export function Forgot() {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [devLink, setDevLink] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const r = await api<{ dev_reset_url?: string }>('/api/auth/forgot', { body: { email } })
      setSent(true)
      if (r.dev_reset_url) setDevLink(r.dev_reset_url.replace(/^https?:\/\/[^/]+/, ''))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inattendue')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout title="Mot de passe oublié" subtitle="Indiquez votre e-mail : nous vous envoyons un lien pour en choisir un nouveau.">
      {sent ? (
        <div className="flex flex-col gap-5">
          <div className="flex items-start gap-3 rounded-xl bg-brand-soft p-4">
            <CircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
            <p className="text-sm leading-relaxed">
              Si un compte existe pour <b>{email}</b>, un lien de réinitialisation vient d’être envoyé. Il est valable 30 minutes.
            </p>
          </div>
          {devLink && (
            <div className="rounded-xl border border-dashed border-line p-4 text-sm">
              <p className="font-semibold">Mode démo (sans serveur e-mail)</p>
              <p className="mt-1 text-muted">Le lien qui aurait été envoyé :</p>
              <Link to={devLink} className="mt-2 inline-block font-semibold text-brand hover:underline">
                Choisir un nouveau mot de passe →
              </Link>
            </div>
          )}
          <Link to="/connexion" className="inline-flex items-center gap-2 text-sm font-semibold text-muted hover:text-fg">
            <ArrowLeft className="h-4 w-4" /> Retour à la connexion
          </Link>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-5">
          <FormError msg={error} />
          <Field label="Adresse e-mail" type="email" autoComplete="email" icon={<Mail />} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="vous@exemple.sn" required />
          <Button type="submit" size="lg" loading={busy}>
            Envoyer le lien
          </Button>
          <Link to="/connexion" className="inline-flex items-center justify-center gap-2 text-sm font-semibold text-muted hover:text-fg">
            <ArrowLeft className="h-4 w-4" /> Retour à la connexion
          </Link>
        </form>
      )}
    </AuthLayout>
  )
}

/* ------------------------------------------------------------------ réinitialisation */
export function Reset() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const nav = useNavigate()
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (pw !== pw2) {
      setError('Les deux mots de passe ne correspondent pas.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api('/api/auth/reset', { body: { token, password: pw } })
      setDone(true)
      window.setTimeout(() => nav('/connexion'), 2200)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur inattendue')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout title="Nouveau mot de passe" subtitle="Choisissez un mot de passe que vous n’utilisez nulle part ailleurs.">
      {done ? (
        <div className="flex items-start gap-3 rounded-xl bg-brand-soft p-4">
          <CircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand" />
          <p className="text-sm">Mot de passe mis à jour. Redirection vers la connexion…</p>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-5">
          <FormError msg={!token ? 'Lien incomplet : refaites une demande de réinitialisation.' : error} />
          <div className="flex flex-col gap-2.5">
            <Field label="Nouveau mot de passe" type="password" autoComplete="new-password" icon={<Lock />} value={pw} onChange={(e) => { setPw(e.target.value); setError(null) }} />
            <StrengthMeter pw={pw} />
          </div>
          <Field label="Confirmer le mot de passe" type="password" autoComplete="new-password" icon={<Lock />} value={pw2} onChange={(e) => { setPw2(e.target.value); setError(null) }} />
          <Button type="submit" size="lg" loading={busy} disabled={!token}>
            Enregistrer
          </Button>
        </form>
      )}
    </AuthLayout>
  )
}
