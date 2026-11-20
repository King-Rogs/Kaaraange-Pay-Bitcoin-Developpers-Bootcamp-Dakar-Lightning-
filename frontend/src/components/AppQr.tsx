import { QRCodeSVG } from 'qrcode.react'

/** QR code avec le logo de l'application au centre (le QR est toujours sur fond blanc). */
export function AppQr({ value, size = 160 }: { value: string; size?: number }) {
  const logo = Math.round(size * 0.24)
  return (
    <QRCodeSVG
      value={value}
      size={size}
      level="H"
      imageSettings={{ src: '/brand/icon-light.png', height: logo, width: logo, excavate: true }}
    />
  )
}
