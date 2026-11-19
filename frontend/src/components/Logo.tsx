import { Link } from 'react-router-dom'
import { cx } from './ui'

export function LogoMark({ size = 36, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden>
      <rect width="64" height="64" rx="16" className="fill-brand" />
      <path d="M32 12l16 6v12c0 9-6.8 16.6-16 18-9.2-1.4-16-9-16-18V18l16-6z" fill="none" stroke="white" strokeWidth="4" strokeLinejoin="round" />
      <path d="M34 22l-8 11h6l-2 9 8-11h-6l2-9z" fill="#F7931A" />
    </svg>
  )
}

export function Logo({ to = '/', className }: { to?: string; className?: string }) {
  return (
    <Link to={to} className={cx('flex items-center gap-2.5', className)} aria-label="Kaaraange Pay — accueil">
      <LogoMark />
      <span className="font-display text-[19px] font-bold tracking-tight">
        Kaaraange<span className="text-brand"> Pay</span>
      </span>
    </Link>
  )
}

/** Logo Bitcoin (domaine public). */
export function BitcoinLogo({ size = 40, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} role="img" aria-label="Bitcoin">
      <circle cx="32" cy="32" r="32" fill="#F7931A" />
      <path
        fill="#fff"
        transform="rotate(14 32 32)"
        d="M41.6 28.1c.6-4-2.4-6.1-6.6-7.5l1.4-5.5-3.3-.8-1.3 5.3c-.9-.2-1.8-.4-2.7-.6l1.3-5.4-3.3-.8-1.4 5.5c-.7-.2-1.4-.3-2.1-.5l-4.6-1.1-.9 3.5s2.5.6 2.4.6c1.3.3 1.6 1.2 1.5 1.9l-1.6 6.3c.1 0 .2.1.4.1l-.4-.1-2.2 8.8c-.2.4-.6 1-1.5.8 0 0-2.4-.6-2.4-.6l-1.6 3.8 4.3 1.1c.8.2 1.6.4 2.4.6l-1.4 5.5 3.3.8 1.4-5.5c.9.2 1.8.5 2.7.7l-1.4 5.5 3.3.8 1.4-5.5c5.6 1.1 9.9.6 11.7-4.5 1.4-4.1-.1-6.4-3-7.9 2.2-.5 3.8-1.9 4.2-4.8zm-7.5 10.5c-1 4.1-7.9 1.9-10.1 1.3l1.8-7.3c2.2.6 9.4 1.7 8.3 6zm1-10.6c-.9 3.7-6.6 1.8-8.5 1.4l1.6-6.6c1.9.5 7.9 1.4 6.9 5.2z"
      />
    </svg>
  )
}
