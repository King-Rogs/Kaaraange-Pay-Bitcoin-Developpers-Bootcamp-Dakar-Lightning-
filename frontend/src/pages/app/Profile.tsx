import { Camera, Lock, Mail, Phone, Star, Store, Trash2, Upload, User as UserIcon } from 'lucide-react'
import { useRef, useState, type FormEvent } from 'react'
import { Avatar, Button, cx, Field } from '../../components/ui'
import { SectionCard } from '../../components/Tech'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { api, ApiError, type Review, type User } from '../../lib/api'
import { dateTime } from '../../lib/format'
import { usePoll } from '../../lib/usePoll'
import { StrengthMeter } from '../Auth'
import { PageHeader } from './AppLayout'

export default function Profile() {
  return (
    <>
      <PageHeader title="Mon profil" text="Gérez votre photo, vos informations, votre mot de passe et vos notes." />
      <div className="grid gap-6 xl:grid-cols-[340px_1fr]">
        <AvatarCard />
        <div className="flex flex-col gap-6">
          <InfoCard />
          <PasswordCard />
          <ReviewsCard />
        </div>
      </div>
    </>
  )
}

function AvatarCard() {
  const { user, setUser } = useAuth()
  const toast = useToast()
  const input = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [drag, setDrag] = useState(false)

  async function upload(file: File) {
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) return toast('Choisissez une image PNG, JPG ou WebP', 'error')
    if (file.size > 2 * 1024 * 1024) return toast('Image trop lourde (2 Mo maximum)', 'error')
    setPreview(URL.createObjectURL(file))
    setBusy(true)
    const form = new FormData()
    form.append('avatar', file)
    try {
      const d = await api<{ user: User }>('/api/me/avatar', { form })
      setUser(d.user)
      toast('Photo de profil mise à jour')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Erreur', 'error')
    } finally {
      setBusy(false)
      setPreview(null)
    }
  }

  async function remove() {
    try {
      const d = await api<{ user: User }>('/api/me/avatar', { method: 'DELETE' })
      setUser(d.user)
      toast('Photo supprimée')
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Erreur', 'error')
    }
  }

  const u = user!
  const since = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' }).format(u.created_at * 1000)

  return (
    <div className="card flex h-fit flex-col items-center gap-5 p-6 text-center">
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDrag(true)
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDrag(false)
          const f = e.dataTransfer.files[0]
          if (f) upload(f)
        }}
        className={cx('relative rounded-full p-1.5 transition', drag ? 'bg-brand/30' : 'bg-transparent')}
      >
        {preview ? <img src={preview} alt="" className="h-32 w-32 rounded-full object-cover opacity-60" /> : <Avatar name={u.name} url={u.avatar_url} size={128} />}
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="absolute bottom-1.5 right-1.5 grid h-11 w-11 place-items-center rounded-full border-4 border-surface bg-brand text-brand-fg transition hover:bg-brand-strong"
          aria-label="Changer la photo de profil"
        >
          <Camera className="h-4 w-4" />
        </button>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) upload(f)
          e.target.value = ''
        }}
      />
      <div>
        <p className="text-xl font-bold">{u.name}</p>
        {u.shop_name && <p className="text-sm font-medium text-brand">{u.shop_name}</p>}
        <p className="mt-1 text-sm text-muted">Membre depuis {since}</p>
      </div>
      <div className="flex w-full flex-col gap-2">
        <Button variant="secondary" onClick={() => input.current?.click()} loading={busy}>
          <Upload className="h-4 w-4" /> Importer une photo
        </Button>
        {u.avatar_url && (
          <Button variant="ghost" onClick={remove} className="text-danger hover:bg-danger-soft">
            <Trash2 className="h-4 w-4" /> Supprimer la photo
          </Button>
        )}
      </div>
      <p className="text-xs text-muted">PNG, JPG ou WebP · 2 Mo maximum · glissez-déposez sur la photo</p>
    </div>
  )
}

function InfoCard() {
  const { user, setUser } = useAuth()
  const toast = useToast()
  const [form, setForm] = useState({ name: user!.name, shop_name: user!.shop_name ?? '', phone: user!.phone ?? '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  async function save(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErrors({})
    try {
      const d = await api<{ user: User }>('/api/me', { method: 'PATCH', body: form })
      setUser(d.user)
      toast('Informations enregistrées')
    } catch (err) {
      if (err instanceof ApiError && err.field) setErrors({ [err.field]: err.message })
      else toast(err instanceof Error ? err.message : 'Erreur', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save} className="card flex flex-col gap-5 p-6">
      <div>
        <h2 className="text-lg font-bold">Informations personnelles</h2>
        <p className="text-sm text-muted">Le nom de boutique est affiché à vos clients.</p>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Nom complet" icon={<UserIcon />} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={errors.name} autoComplete="name" />
        <Field label="Nom de la boutique" icon={<Store />} value={form.shop_name} onChange={(e) => setForm({ ...form, shop_name: e.target.value })} placeholder="Awa Couture" />
        <Field label="Téléphone" icon={<Phone />} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+221 77 000 00 00" error={errors.phone} autoComplete="tel" />
        <Field label="Adresse e-mail" icon={<Mail />} value={user!.email} disabled hint="L’e-mail sert à vous connecter." />
      </div>
      <div className="flex justify-end">
        <Button type="submit" loading={busy}>
          Enregistrer
        </Button>
      </div>
    </form>
  )
}

function PasswordCard() {
  const toast = useToast()
  const [form, setForm] = useState({ current: '', next: '', confirm: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  async function save(e: FormEvent) {
    e.preventDefault()
    if (form.next !== form.confirm) return setErrors({ confirm: 'Les deux mots de passe ne correspondent pas' })
    setBusy(true)
    setErrors({})
    try {
      await api('/api/me/password', { method: 'PUT', body: { current: form.current, password: form.next } })
      setForm({ current: '', next: '', confirm: '' })
      toast('Mot de passe modifié')
    } catch (err) {
      if (err instanceof ApiError && err.field) setErrors({ [err.field === 'current' ? 'current' : 'next']: err.message })
      else toast(err instanceof Error ? err.message : 'Erreur', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={save} className="card flex flex-col gap-5 p-6">
      <div>
        <h2 className="text-lg font-bold">Mot de passe</h2>
        <p className="text-sm text-muted">Utilisez au moins 8 caractères, avec des lettres et des chiffres.</p>
      </div>
      <Field label="Mot de passe actuel" type="password" icon={<Lock />} value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} error={errors.current} autoComplete="current-password" />
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-2.5">
          <Field label="Nouveau mot de passe" type="password" icon={<Lock />} value={form.next} onChange={(e) => setForm({ ...form, next: e.target.value })} error={errors.next} autoComplete="new-password" />
          <StrengthMeter pw={form.next} />
        </div>
        <Field label="Confirmer" type="password" icon={<Lock />} value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} error={errors.confirm} autoComplete="new-password" />
      </div>
      <div className="flex justify-end">
        <Button type="submit" loading={busy} disabled={!form.current || !form.next}>
          Changer le mot de passe
        </Button>
      </div>
    </form>
  )
}

function ReviewsCard() {
  const { user } = useAuth()
  const { data } = usePoll<{ ratings: User['ratings']; reviews: Review[] }>(`/api/users/${user!.id}/reviews`, 15000)
  const [tab, setTab] = useState<'vendeur' | 'livreur' | 'client'>('vendeur')
  const labels = { vendeur: 'Comme vendeur', livreur: 'Comme livreur', client: 'Comme client' }

  return (
    <SectionCard title="Mes notes" icon={<Star />}>
      <div role="tablist" className="inline-flex rounded-xl border border-line bg-subtle p-1 self-start">
        {(['vendeur', 'livreur', 'client'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cx('h-9 rounded-lg px-3 text-xs font-semibold transition', tab === t ? 'bg-surface shadow-sm' : 'text-muted')}>
            {labels[t]}
          </button>
        ))}
      </div>
      {data?.ratings[tab].count ? (
        <div className="flex items-center gap-2">
          <div className="flex">{[1, 2, 3, 4, 5].map((n) => <Star key={n} className={cx('h-4 w-4', n <= Math.round(data.ratings[tab].avg ?? 0) ? 'fill-warn text-warn' : 'text-line')} />)}</div>
          <span className="font-semibold">{data.ratings[tab].avg}</span>
          <span className="text-sm text-muted">({data.ratings[tab].count} avis)</span>
        </div>
      ) : (
        <p className="text-sm text-muted">Pas encore d’avis dans ce rôle.</p>
      )}
      <div className="flex flex-col divide-y divide-line">
        {data?.reviews.filter((r) => r.role === tab).map((r) => (
          <div key={r.id} className="flex items-start gap-3 py-3">
            <Avatar name={r.author.name} url={r.author.avatar_url} size={32} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">{r.author.name}</span>
                <span className="text-xs text-muted">{dateTime(r.created_at)}</span>
              </div>
              <div className="flex">{[1, 2, 3, 4, 5].map((n) => <Star key={n} className={cx('h-3 w-3', n <= r.rating ? 'fill-warn text-warn' : 'text-line')} />)}</div>
              {r.comment && <p className="mt-1 text-sm text-muted">{r.comment}</p>}
            </div>
          </div>
        ))}
      </div>
    </SectionCard>
  )
}
