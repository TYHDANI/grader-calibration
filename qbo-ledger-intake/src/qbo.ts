import { readFileSync, writeFileSync, existsSync } from 'node:fs'

export type QboEnv = 'sandbox' | 'production'

export type QboConfig = {
  clientId: string
  clientSecret: string
  env: QboEnv
  tokenFile: string
  minorVersion: number
  depositAccountId?: string
}

export type Tokens = {
  realmId: string
  access_token: string
  refresh_token: string
  /** epoch ms */
  access_expires_at: number
  /** epoch ms */
  refresh_expires_at: number
}

export const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'
export const AUTHORIZE_URL = 'https://appcenter.intuit.com/connect/oauth2'
export const SCOPE = 'com.intuit.quickbooks.accounting'

const need = (k: string) => {
  const v = process.env[k]
  if (!v) throw new Error(`Missing environment variable ${k} (see .env.example)`)
  return v
}

export function configFromEnv(): QboConfig {
  const env = (process.env.QBO_ENV ?? 'sandbox') as QboEnv
  if (env !== 'sandbox' && env !== 'production') throw new Error(`QBO_ENV must be sandbox or production, got ${env}`)
  return {
    clientId: need('QBO_CLIENT_ID'),
    clientSecret: need('QBO_CLIENT_SECRET'),
    env,
    tokenFile: process.env.QBO_TOKEN_FILE ?? '.qbo-tokens.json',
    minorVersion: 75,
    depositAccountId: process.env.QBO_DEPOSIT_ACCOUNT_ID || undefined,
  }
}

export type Customer = { Id: string; DisplayName: string; GivenName?: string; FamilyName?: string; Balance?: number; Active?: boolean }
export type PaymentMethod = { Id: string; Name: string; Type?: string; Active?: boolean }
export type Invoice = {
  Id: string; DocNumber?: string; TxnDate: string; TotalAmt: number; Balance: number
  CustomerMemo?: { value: string }; PrivateNote?: string
  Line?: { Description?: string; Amount?: number; DetailType?: string }[]
}
export type Payment = {
  Id: string; TxnDate: string; TotalAmt: number; PaymentRefNum?: string; PrivateNote?: string
  PaymentMethodRef?: { value: string; name?: string }; CustomerRef: { value: string; name?: string }
}

/** Body for POST /v3/company/{realm}/payment. Omit Line to leave the payment unapplied (customer credit). */
export type PaymentCreate = {
  CustomerRef: { value: string }
  TotalAmt: number
  TxnDate?: string
  PaymentMethodRef?: { value: string }
  PaymentRefNum?: string
  PrivateNote?: string
  DepositToAccountRef?: { value: string }
  Line?: { Amount: number; LinkedTxn: { TxnId: string; TxnType: 'Invoice' }[] }[]
}

export class QboError extends Error {
  status: number
  body: unknown
  constructor(status: number, body: unknown, msg: string) {
    super(msg)
    this.status = status
    this.body = body
  }
}

/** Escape a value for use inside single quotes in a QBO query. */
export const q = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")

export class QboClient {
  cfg: QboConfig
  tokens: Tokens | null

  constructor(cfg: QboConfig) {
    this.cfg = cfg
    this.tokens = existsSync(cfg.tokenFile) ? (JSON.parse(readFileSync(cfg.tokenFile, 'utf8')) as Tokens) : null
  }

  get apiBase() {
    return this.cfg.env === 'sandbox' ? 'https://sandbox-quickbooks.api.intuit.com' : 'https://quickbooks.api.intuit.com'
  }

  get realmId() {
    if (!this.tokens) throw new Error(`Not connected to QuickBooks. Run: npm run auth`)
    return this.tokens.realmId
  }

  saveTokens(t: Tokens) {
    this.tokens = t
    writeFileSync(this.cfg.tokenFile, JSON.stringify(t, null, 2) + '\n', { mode: 0o600 })
  }

  private async tokenRequest(params: Record<string, string>, realmId: string): Promise<Tokens> {
    const basic = Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString('base64')
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
    })
    const body = await res.json().catch(() => ({})) as Record<string, unknown>
    if (!res.ok) throw new QboError(res.status, body, `OAuth token request failed (${res.status}): ${JSON.stringify(body)}`)
    const now = Date.now()
    return {
      realmId,
      access_token: String(body.access_token),
      refresh_token: String(body.refresh_token),
      access_expires_at: now + Number(body.expires_in ?? 3600) * 1000,
      refresh_expires_at: now + Number(body.x_refresh_token_expires_in ?? 100 * 86400) * 1000,
    }
  }

  async exchangeCode(code: string, redirectUri: string, realmId: string) {
    this.saveTokens(await this.tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }, realmId))
  }

  async refresh() {
    if (!this.tokens) throw new Error('Not connected to QuickBooks. Run: npm run auth')
    if (Date.now() > this.tokens.refresh_expires_at) throw new Error('QuickBooks refresh token expired (100 days unused). Run: npm run auth')
    this.saveTokens(await this.tokenRequest({ grant_type: 'refresh_token', refresh_token: this.tokens.refresh_token }, this.tokens.realmId))
  }

  async accessToken() {
    if (!this.tokens) throw new Error('Not connected to QuickBooks. Run: npm run auth')
    if (Date.now() > this.tokens.access_expires_at - 60_000) await this.refresh()
    return this.tokens.access_token
  }

  async request<T>(method: 'GET' | 'POST', path: string, body?: unknown, retry = true): Promise<T> {
    const url = new URL(`${this.apiBase}/v3/company/${this.realmId}${path}`)
    url.searchParams.set('minorversion', String(this.cfg.minorVersion))
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${await this.accessToken()}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (res.status === 401 && retry) {
      await this.refresh()
      return this.request<T>(method, path, body, false)
    }
    const text = await res.text()
    const json = text ? (JSON.parse(text) as unknown) : null
    if (!res.ok) throw new QboError(res.status, json, `QuickBooks ${method} ${path} failed (${res.status}): ${text.slice(0, 500)}`)
    return json as T
  }

  /** Run a query, following startposition paging. `entity` is the name after "from". */
  async query<T>(entity: string, where = '', orderBy = ''): Promise<T[]> {
    const out: T[] = []
    const pageSize = 1000
    for (let start = 1; ; start += pageSize) {
      const sql = `select * from ${entity}${where ? ` where ${where}` : ''}${orderBy ? ` orderby ${orderBy}` : ''} startposition ${start} maxresults ${pageSize}`
      const res = await this.request<{ QueryResponse: Record<string, unknown> }>('GET', `/query?query=${encodeURIComponent(sql)}`)
      const rows = (res.QueryResponse[entity] as T[] | undefined) ?? []
      out.push(...rows)
      if (rows.length < pageSize) return out
    }
  }

  listCustomers() { return this.query<Customer>('Customer', 'Active = true') }
  listPaymentMethods() { return this.query<PaymentMethod>('PaymentMethod', 'Active = true') }
  openInvoices(customerId: string) {
    return this.query<Invoice>('Invoice', `CustomerRef = '${q(customerId)}' and Balance > '0'`, 'TxnDate')
  }
  paymentsBetween(customerId: string, fromIso: string, toIso: string) {
    return this.query<Payment>('Payment', `CustomerRef = '${q(customerId)}' and TxnDate >= '${fromIso}' and TxnDate <= '${toIso}'`)
  }
  async createPayment(body: PaymentCreate): Promise<Payment> {
    const res = await this.request<{ Payment: Payment }>('POST', '/payment', body)
    return res.Payment
  }
  companyInfo() {
    return this.request<{ CompanyInfo: { CompanyName: string } }>('GET', `/companyinfo/${this.realmId}`)
  }
}
