/**
 * Cartes OpenStreetMap (Leaflet + react-leaflet, sans clé API).
 * Icônes dessinées en SVG inline pour éviter de dépendre des images par défaut de Leaflet.
 */
import L from 'leaflet'
import { useEffect, useMemo, useRef } from 'react'
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import { cx } from './ui'

export const DAKAR_CENTER: [number, number] = [14.705, -17.465]

function divIcon(html: string, size = 32) {
  return L.divIcon({ html, className: 'kp-marker', iconSize: [size, size], iconAnchor: [size / 2, size / 2] })
}

const pin = (color: string, glyph = '') =>
  divIcon(
    `<svg width="32" height="32" viewBox="0 0 32 32" style="filter:drop-shadow(0 2px 4px rgb(0 0 0 / .35))"><path d="M16 2c-6.6 0-12 5.3-12 11.9C4 22 16 30 16 30s12-8 12-16.1C28 7.3 22.6 2 16 2z" fill="${color}" stroke="white" stroke-width="1.5"/><circle cx="16" cy="13.5" r="5" fill="white"/>${glyph}</svg>`,
  )

export const ICONS = {
  shop: pin('#0A7A42', '<text x="16" y="17" font-size="7" text-anchor="middle" fill="#0A7A42" font-weight="700">B</text>'),
  delivery: pin('#F7931A', '<text x="16" y="17" font-size="7" text-anchor="middle" fill="#F7931A" font-weight="700">L</text>'),
  courierAvailable: divIcon(
    '<svg width="26" height="26" viewBox="0 0 26 26"><circle cx="13" cy="13" r="11" fill="#0A7A42" stroke="white" stroke-width="2.5"/><path d="M8 13.5l3.2 3.2L18 10" stroke="white" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    26,
  ),
  courierBusy: divIcon(
    '<svg width="26" height="26" viewBox="0 0 26 26"><circle cx="13" cy="13" r="11" fill="#F5C518" stroke="white" stroke-width="2.5"/><path d="M13 7v6l4 2.5" stroke="#0E1A14" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    26,
  ),
  courierOffline: divIcon(
    '<svg width="22" height="22" viewBox="0 0 22 22"><circle cx="11" cy="11" r="9" fill="#9CA3AF" stroke="white" stroke-width="2"/></svg>',
    22,
  ),
  me: divIcon(
    '<svg width="22" height="22" viewBox="0 0 22 22"><circle cx="11" cy="11" r="9" fill="#F7931A" stroke="white" stroke-width="2.5"/></svg>',
    22,
  ),
}

/** Force Leaflet à recalculer sa taille quand le conteneur change (onglets, drawers…). */
function InvalidateOnMount() {
  const map = useMap()
  useEffect(() => {
    const id = window.setTimeout(() => map.invalidateSize(), 80)
    return () => window.clearTimeout(id)
  }, [map])
  return null
}

function FlyTo({ center }: { center: [number, number] }) {
  const map = useMap()
  const prev = useRef<string>('')
  useEffect(() => {
    const key = center.join(',')
    if (key !== prev.current) {
      prev.current = key
      map.flyTo(center, map.getZoom(), { duration: 0.6 })
    }
  }, [center, map])
  return null
}

function ClickCatcher({ onClick }: { onClick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onClick(e.latlng.lat, e.latlng.lng) })
  return null
}

const Base = () => <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

/** Carte « cliquez pour placer le point » (boutique ou livraison). */
export function MapPicker({
  value,
  onChange,
  icon = ICONS.shop,
  height = 280,
  className,
}: {
  value: { lat: number; lng: number } | null
  onChange: (lat: number, lng: number) => void
  icon?: L.DivIcon
  height?: number
  className?: string
}) {
  const center = useMemo<[number, number]>(() => (value ? [value.lat, value.lng] : DAKAR_CENTER), [value]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={cx('overflow-hidden rounded-xl border border-line', className)} style={{ height }}>
      <MapContainer center={center} zoom={value ? 14 : 12} scrollWheelZoom className="h-full w-full" style={{ background: 'rgb(var(--subtle))' }}>
        <InvalidateOnMount />
        <Base />
        <ClickCatcher onClick={onChange} />
        {value && <Marker position={[value.lat, value.lng]} icon={icon} />}
      </MapContainer>
    </div>
  )
}

/** Carte de suivi en direct : boutique, point de livraison, position du livreur (+ ligne). */
export function TrackMap({
  shop,
  delivery,
  courier,
  height = 320,
  className,
}: {
  shop: { lat: number; lng: number }
  delivery: { lat: number; lng: number }
  courier?: { lat: number; lng: number } | null
  height?: number
  className?: string
}) {
  const center = useMemo<[number, number]>(() => [courier?.lat ?? (shop.lat + delivery.lat) / 2, courier?.lng ?? (shop.lng + delivery.lng) / 2], [shop, delivery, courier])
  return (
    <div className={cx('overflow-hidden rounded-xl border border-line', className)} style={{ height }}>
      <MapContainer center={center} zoom={13} scrollWheelZoom={false} className="h-full w-full" style={{ background: 'rgb(var(--subtle))' }}>
        <InvalidateOnMount />
        <FlyTo center={center} />
        <Base />
        <Marker position={[shop.lat, shop.lng]} icon={ICONS.shop}>
          <Popup>Boutique</Popup>
        </Marker>
        <Marker position={[delivery.lat, delivery.lng]} icon={ICONS.delivery}>
          <Popup>Point de livraison</Popup>
        </Marker>
        <Polyline positions={[[shop.lat, shop.lng], [delivery.lat, delivery.lng]]} pathOptions={{ color: 'rgb(var(--line))', weight: 2, dashArray: '6 8' }} />
        {courier && (
          <Marker position={[courier.lat, courier.lng]} icon={ICONS.me}>
            <Popup>Livreur</Popup>
          </Marker>
        )}
      </MapContainer>
    </div>
  )
}

export type DispatchPoint = { id: number | string; lat: number; lng: number; status: 'offline' | 'available' | 'busy'; label: string; onClick?: () => void }

/** Carte d'ensemble (admin) : tous les livreurs, couleur selon le statut. */
export function FleetMap({ points, extra, height = 420, className }: { points: DispatchPoint[]; extra?: { lat: number; lng: number; icon: L.DivIcon; label: string }[]; height?: number; className?: string }) {
  const center = useMemo<[number, number]>(() => {
    const live = points.filter((p) => p.status !== 'offline')
    if (!live.length) return DAKAR_CENTER
    return [live.reduce((s, p) => s + p.lat, 0) / live.length, live.reduce((s, p) => s + p.lng, 0) / live.length]
  }, [points])
  return (
    <div className={cx('overflow-hidden rounded-xl border border-line', className)} style={{ height }}>
      <MapContainer center={center} zoom={12} scrollWheelZoom className="h-full w-full" style={{ background: 'rgb(var(--subtle))' }}>
        <InvalidateOnMount />
        <Base />
        {points.map((p) => (
          <Marker key={p.id} position={[p.lat, p.lng]} icon={p.status === 'available' ? ICONS.courierAvailable : p.status === 'busy' ? ICONS.courierBusy : ICONS.courierOffline} eventHandlers={p.onClick ? { click: p.onClick } : undefined}>
            <Popup>{p.label}</Popup>
          </Marker>
        ))}
        {extra?.map((e, i) => (
          <Marker key={i} position={[e.lat, e.lng]} icon={e.icon}>
            <Popup>{e.label}</Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  )
}
