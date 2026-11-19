export class ApiError extends Error {
  status: number
  field?: string
  constructor(message: string, status: number, field?: string) {
    super(message)
    this.status = status
    this.field = field
  }
}

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const init: RequestInit = { method: opts.method ?? (opts.body || opts.form ? 'POST' : 'GET'), credentials: 'same-origin' }
  if (opts.form) init.body = opts.form
  else if (opts.body !== undefined) {
    init.body = JSON.stringify(opts.body)
    init.headers = { 'Content-Type': 'application/json' }
  }
  let res: Response
  try {
    res = await fetch(path, init)
  } catch {
    throw new ApiError('Serveur injoignable. Vérifiez que le backend tourne.', 0)
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(data.error || `Erreur ${res.status}`, res.status, data.field)
  return data as T
}

// ---------------------------------------------------------------- comptes

export type Rating = { avg: number | null; count: number }
export type PublicUser = {
  id: number
  name: string
  shop_name: string
  avatar_url: string | null
  is_bot: boolean
  is_demo: boolean
  phone?: string
  rating?: Rating
}

export type Shop = { lat: number; lng: number; address: string }

export type User = {
  id: number
  name: string
  email: string
  phone: string
  shop_name: string
  shop: Shop | null
  avatar_url: string | null
  is_admin: boolean
  is_bot: boolean
  is_demo: boolean
  created_at: number
  ratings: { vendeur: Rating; livreur: Rating; client: Rating }
}

// ---------------------------------------------------------------- articles & devis

export type Article = {
  id: number
  title: string
  description: string
  price_sat: number
  is_active: boolean
  removed_reason: string | null
  created_at: number
  is_mine: boolean
  seller: PublicUser & { shop: Shop | null }
}

export type Quote = {
  distance_km: number
  fee_xof: number
  fee_sat: number
  item_sat: number
  total_sat: number
  btc_xof: number
  price_source: string
  shop: Shop
}

// ---------------------------------------------------------------- commandes

export type OrderStatus =
  | 'awaiting_payment'
  | 'searching_courier'
  | 'assigned'
  | 'picked_up'
  | 'delivered'
  | 'returning'
  | 'returned'
  | 'canceled'

export type InvoiceState = 'OPEN' | 'ACCEPTED' | 'SETTLED' | 'CANCELED'
export type Invoice = { label: string; node: string; hash: string; request: string; state: InvoiceState; sats: number }

export type CourierPosition = { lat: number; lng: number; mode: 'gps' | 'sim'; at: number | null }

export type Order = {
  id: number
  article_id: number
  title: string
  status: OrderStatus
  role: 'buyer' | 'seller' | 'courier' | 'admin'
  item_sat: number
  fee_sat: number
  total_sat: number
  fee_xof: number
  distance_km: number
  btc_xof: number
  shop: Shop & { name: string }
  delivery: { lat: number; lng: number; address: string }
  buyer: PublicUser | null
  seller: PublicUser | null
  courier: (PublicUser & { rating: Rating; position: CourierPosition | null }) | null
  invoices: { item: Invoice; fee: Invoice }
  pay_error: string | null
  return_cause: 'refus' | 'absent' | null
  refuse_reason: string | null
  refuse_reason_label: string | null
  refuse_comment: string | null
  cancel_reason: string | null
  fee_refunded_at: number | null
  invoice_expires_at: number
  deadline_at: number | null
  created_at: number
  paid_at: number | null
  assigned_at: number | null
  picked_up_at: number | null
  delivered_at: number | null
  returning_at: number | null
  returned_at: number | null
  canceled_at: number | null
  my_reviews: { vendeur: number | null; livreur: number | null; client: number | null }
  can_review: { vendeur: boolean; livreur: boolean; client: boolean }
}

export type MoneyStats = { count: number; sats: number }
export type Stats = {
  locked_sat: number
  incoming_seller_sat: number
  earned_seller_sat: number
  courier_earned_sat: number
  spent_sat: number
  refunded_sat: number
  counts: { purchases: number; sales: number; deliveries: number; articles: number }
}

export type Review = {
  id: number
  order_id: number
  role: 'vendeur' | 'livreur' | 'client'
  rating: number
  comment: string
  created_at: number
  author: { id: number; name: string; avatar_url: string | null }
}

export const REFUSE_REASONS: Record<string, string> = {
  non_conforme: 'Produit non conforme',
  endommage: 'Colis endommagé',
  change_avis: "Changement d'avis",
  autre: 'Autre motif',
}

// ---------------------------------------------------------------- livreurs

export type CourierStatus = 'offline' | 'available' | 'busy'
export type Courier = {
  status: CourierStatus
  mode: 'gps' | 'sim'
  position: { lat: number; lng: number; at: number | null } | null
  current_order_id: number | null
  offers_received: number
  offers_accepted: number
  acceptance_rate: number
  rating: Rating
}

export type Offer = {
  id: number
  order_id: number
  status: 'pending' | 'accepted' | 'declined' | 'expired' | 'canceled'
  round: number
  cost: number
  distance_to_shop_km: number
  created_at: number
  expires_at: number
  seconds_left: number
  order: { title: string; fee_sat: number; fee_xof: number; distance_km: number; shop: Shop; delivery: { lat: number; lng: number; address: string } } | null
}

export type CourierMe = {
  courier: Courier
  offer: Offer | null
  current: Order | null
  history: Order[]
  earnings_sat: number
  radius_km: { pickup: number; absent: number }
}

// ---------------------------------------------------------------- Bitcoin & Lightning

export type WalletTx = { txid: string; category: string; amount_sat: number; fee_sat: number; address: string | null; confirmations: number; time: number }
export type Utxo = { txid: string; vout: number; address: string; amount_sat: number; confirmations: number; coinbase: boolean; spendable: boolean }
export type ChainInfo = { chain: string; blocks: number; bestblockhash: string; difficulty: number; mempool_size: number; mempool_bytes: number; time: number }
export type Wallet = {
  name: string
  exists: boolean
  mode: string
  chain: ChainInfo
  balances?: { trusted_sat: number; untrusted_pending_sat: number; immature_sat: number }
  addresses?: string[]
  transactions?: WalletTx[]
  utxos?: Utxo[]
}

export type BlockSummary = { height: number; hash: string; time: number; n_tx: number; size: number }
export type BlockDetail = BlockSummary & {
  previousblockhash: string | null
  confirmations: number
  difficulty: number
  txs: { txid: string; coinbase: boolean; fee_sat: number; vin: number; vout: { n: number; value_sat: number; address: string | null }[] }[]
}

export type NodeInfo = { alias: string; public_key: string; color: string; block_height: number; active_channels: number; peers: number; synced: boolean; version: string }
export type NodeBalances = { onchain_sat: number; offchain_local_sat: number; offchain_remote_sat: number; pending_out_sat: number }
export type NodeChannel = {
  id: string
  partner_alias: string
  partner_public_key: string
  capacity: number
  local_balance: number
  remote_balance: number
  unsettled_balance: number
  is_active: boolean
  initiator: boolean
}
export type LnNode =
  | { id: string; role: string; mode: string; reachable: true; info: NodeInfo; balances: NodeBalances; channels: NodeChannel[] }
  | { id: string; role: string; mode: string; reachable: false; error: string }
export type Decoded = { id: string; destination: string; destination_alias: string | null; tokens: number; description: string; expires_at: string; created_at: string; cltv_delta: number; network: string }
export type LnHistory = {
  invoices: { id: string; tokens: number; description: string; state: InvoiceState; is_hold: boolean; created_at: string; request: string }[]
  payments: { id: string; tokens: number; fee: number; status: string; route: string[]; description: string; created_at: string; secret: string | null }[]
}
export type PayResult = { node: string; id: string; preimage: string | null; tokens: number; fee: number; route: string[]; hops: { channel: string; alias: string; public_key: string; forward: number; fee: number }[] }

// ---------------------------------------------------------------- administration

export type AdminStats = {
  users: { total: number; active_7d: number; suspended: number; admins: number; bots: number }
  couriers: { online: number; busy: number }
  orders: { total: number; by_status: Partial<Record<OrderStatus, number>> }
  locked_sat: number
  paid_sellers_sat: number
  paid_couriers_sat: number
  returns_in_progress: number
  expiring_soon: { id: number; title: string; status: OrderStatus; deadline_at: number; total_sat: number }[]
  activity_14d: { date: string; orders: number; delivered: number; volume_sat: number }[]
}
export type AdminUser = PublicUser & {
  email: string
  phone: string
  is_admin: boolean
  is_suspended: boolean
  created_at: number
  last_seen_at: number | null
  ratings: { vendeur: Rating; livreur: Rating; client: Rating }
  sales: number
  purchases: number
  refusals: number
  absences: number
  deliveries: number
}
export type AuditEntry = { id: number; at: number; action: string; target: string | null; details: Record<string, unknown> | null; ip: string | null; user: { id: number; name: string; email: string } | null }
export type SystemInfo = {
  modes: Record<string, unknown>
  nodes: { id: string; role: string; mode: string; reachable: boolean; error: string | null; alias?: string; public_key?: string; block_height?: number; synced?: boolean; version?: string; channels: number; local_sat: number | null }[]
  bitcoind: { mode: string; url: string; reachable: boolean; chain?: string; blocks?: number; error?: string }
  price: { btc_xof: number; source: string; updated_at: number }
  settings: Record<string, number>
  server: { node: string; uptime_s: number }
}
export type DispatchCourier = { user: PublicUser; is_suspended: boolean; status: CourierStatus; mode: 'gps' | 'sim'; position: { lat: number; lng: number; at: number | null } | null; current_order_id: number | null; offers_received: number; offers_accepted: number; acceptance_rate: number; rating: Rating }
export type DispatchOrder = { id: number; title: string; status: OrderStatus; courier_id: number | null; dispatch_round: number; shop: { lat: number; lng: number }; delivery: { lat: number; lng: number }; deadline_at: number | null }
export type DispatchOffer = { id: number; order_id: number; title: string; courier_id: number; courier_name: string; round: number; cost: number; distance_km: number; status: string; created_at: number; responded_at: number | null }
export type DispatchSnapshot = { couriers: DispatchCourier[]; orders: DispatchOrder[]; offers: DispatchOffer[] }
