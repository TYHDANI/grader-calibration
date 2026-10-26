import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { AUTHORIZE_URL, SCOPE, QboClient } from './qbo.ts'

/**
 * One-time connect flow. Register http://localhost:8765/callback as a Redirect URI
 * on the Intuit app first (Keys & credentials page), for both sandbox and production keys.
 */
export async function connect(qbo: QboClient, port = 8765): Promise<void> {
  const redirectUri = `http://localhost:${port}/callback`
  const state = randomBytes(12).toString('hex')
  const url = new URL(AUTHORIZE_URL)
  url.searchParams.set('client_id', qbo.cfg.clientId)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', SCOPE)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('state', state)

  console.log(`\nOpen this URL in a browser signed in to the QuickBooks company you want to connect (${qbo.cfg.env}):\n\n${url}\n`)

  await new Promise<void>((resolve, reject) => {
    const server = createServer(async (req, res) => {
      try {
        const u = new URL(req.url ?? '/', redirectUri)
        if (u.pathname !== '/callback') { res.writeHead(404).end(); return }
        const code = u.searchParams.get('code'), realmId = u.searchParams.get('realmId')
        if (u.searchParams.get('state') !== state) throw new Error('state mismatch; start over')
        if (!code || !realmId) throw new Error(`missing code/realmId: ${u.search}`)
        await qbo.exchangeCode(code, redirectUri, realmId)
        res.writeHead(200, { 'Content-Type': 'text/plain' }).end('Connected. You can close this tab.')
        server.close()
        resolve()
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'text/plain' }).end(String(e))
        server.close()
        reject(e)
      }
    })
    server.listen(port)
  })
  const info = await qbo.companyInfo()
  console.log(`Connected to "${info.CompanyInfo.CompanyName}" (realm ${qbo.realmId}). Tokens saved to ${qbo.cfg.tokenFile}.`)
}
