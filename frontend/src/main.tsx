import '@fontsource-variable/inter'
import '@fontsource/space-grotesk/500.css'
import '@fontsource/space-grotesk/600.css'
import '@fontsource/space-grotesk/700.css'
import 'leaflet/dist/leaflet.css'
import './index.css'

import { StrictMode, useEffect, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import { ToastProvider } from './context/ToastContext'
import { LinkButton, Spinner } from './components/ui'
import { Logo } from './components/Logo'
import Landing from './pages/Landing'
import { Forgot, Login, Register, Reset } from './pages/Auth'
import AppLayout from './pages/app/AppLayout'
import Overview from './pages/app/Overview'
import Shop from './pages/app/Shop'
import Buy from './pages/app/Buy'
import Purchases from './pages/app/Purchases'
import Courier from './pages/app/Courier'
import Profile from './pages/app/Profile'
import WalletPage from './pages/app/Wallet'
import { AdminArticles, AdminAudit, AdminDispatch, AdminGuard, AdminOrders, AdminOverview, AdminSystem, AdminUsers } from './pages/app/Admin'

/** La landing page est réservée aux visiteurs : un compte connecté est renvoyé vers son espace. */
function GuestOnly({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="grid min-h-screen place-items-center"><Spinner className="h-7 w-7" /></div>
  if (user) return <Navigate to="/app" replace />
  return <>{children}</>
}

function ScrollTop() {
  const { pathname, hash } = useLocation()
  useEffect(() => {
    if (hash) window.setTimeout(() => document.querySelector(hash)?.scrollIntoView(), 50)
    else window.scrollTo(0, 0)
  }, [pathname, hash])
  return null
}

function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 px-6 text-center">
      <Logo />
      <p className="font-display text-8xl font-bold text-brand">404</p>
      <div>
        <h1 className="text-2xl font-bold">Page introuvable</h1>
        <p className="mt-2 text-muted">Cette page n’existe pas ou a été déplacée.</p>
      </div>
      <LinkButton to="/">Retour à l’accueil</LinkButton>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter>
            <ScrollTop />
            <Routes>
              <Route path="/" element={<GuestOnly><Landing /></GuestOnly>} />
              <Route path="/connexion" element={<Login />} />
              <Route path="/inscription" element={<Register />} />
              <Route path="/mot-de-passe-oublie" element={<Forgot />} />
              <Route path="/reinitialiser" element={<Reset />} />
              <Route path="/app" element={<AppLayout />}>
                <Route index element={<Overview />} />
                <Route path="boutique" element={<Shop />} />
                <Route path="marche" element={<Buy />} />
                <Route path="achats" element={<Purchases />} />
                <Route path="livreur" element={<Courier />} />
                <Route path="profil" element={<Profile />} />
                <Route path="portefeuille" element={<WalletPage />} />
                <Route path="admin" element={<AdminGuard><AdminOverview /></AdminGuard>} />
                <Route path="admin/utilisateurs" element={<AdminGuard><AdminUsers /></AdminGuard>} />
                <Route path="admin/commandes" element={<AdminGuard><AdminOrders /></AdminGuard>} />
                <Route path="admin/dispatch" element={<AdminGuard><AdminDispatch /></AdminGuard>} />
                <Route path="admin/articles" element={<AdminGuard><AdminArticles /></AdminGuard>} />
                <Route path="admin/systeme" element={<AdminGuard><AdminSystem /></AdminGuard>} />
                <Route path="admin/journal" element={<AdminGuard><AdminAudit /></AdminGuard>} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  </StrictMode>,
)
