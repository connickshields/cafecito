import { describe, expect, it } from 'vitest'
import { SELF, env } from 'cloudflare:test'
import { requireBarista } from '../../worker/routes/barista.js'
import { signPreviewGrant } from '../../worker/auth.js'
import { handlePreviewKeyExchange } from '../../worker/index.js'

const PREVIEW = 'https://pr-1-cafecito-preview.connickshields.workers.dev'
const PRODUCTION = 'https://cafecito.connick.me'
const LOCAL = 'http://localhost:8787'

const KEY = 'test-preview-key'
const previewEnv = { PREVIEW_BARISTA_KEY: KEY }

function request(origin, cookie) {
  return new Request(`${origin}/api/barista/orders`, {
    headers: cookie ? { Cookie: cookie } : {},
  })
}

const grantCookie = async (secret) => `cafecito_preview=${await signPreviewGrant(secret)}`

describe('requireBarista on local and preview deployments', () => {
  it('allows localhost with no credential at all', async () => {
    expect(await requireBarista(request(LOCAL, null), {})).toBe(true)
    expect(await requireBarista(request('http://127.0.0.1:8787', null), {})).toBe(true)
  })

  it('allows a preview host carrying a valid grant', async () => {
    expect(await requireBarista(request(PREVIEW, await grantCookie(KEY)), previewEnv)).toBe(true)
  })

  it('refuses a preview host with no cookie', async () => {
    expect(await requireBarista(request(PREVIEW, null), previewEnv)).toBe(false)
  })

  it('refuses a preview host with a grant signed by the wrong key', async () => {
    const forged = await grantCookie('not-the-key')
    expect(await requireBarista(request(PREVIEW, forged), previewEnv)).toBe(false)
  })

  it('refuses a preview host when the Worker has no key configured', async () => {
    expect(await requireBarista(request(PREVIEW, await grantCookie(KEY)), {})).toBe(false)
  })
})

// The cases that actually protect production. Each asserts that a credential
// which genuinely works on preview is worthless anywhere else.
describe('a preview grant is refused off preview', () => {
  it('refuses a VALID preview grant on the production hostname', async () => {
    expect(await requireBarista(request(PRODUCTION, await grantCookie(KEY)), previewEnv)).toBe(false)
  })

  it('refuses a valid preview grant on a domain that merely contains workers.dev', async () => {
    const cookie = await grantCookie(KEY)
    expect(await requireBarista(request('https://workers.dev.evil.com', cookie), previewEnv)).toBe(
      false
    )
  })

  it('still refuses production requests that carry no Access token', async () => {
    expect(await requireBarista(request(PRODUCTION, null), previewEnv)).toBe(false)
  })
})

describe('the preview key exchange', () => {
  const url = (origin, query) => `${origin}/barista${query}`

  it('exchanges a correct key for a cookie and strips the key from the URL', async () => {
    const response = await SELF.fetch(url(PREVIEW, `?preview_key=${encodeURIComponent(KEY)}`), {
      redirect: 'manual',
    })

    expect(response.status).toBe(302)
    // The key must not survive into the address bar, history, or a pasted link.
    expect(response.headers.get('Location')).toBe('/barista')

    const setCookie = response.headers.get('Set-Cookie')
    expect(setCookie).toContain('cafecito_preview=')
    expect(setCookie).toContain('Domain=connickshields.workers.dev')
    expect(setCookie).toContain('HttpOnly')
  })

  it('keeps other query parameters when stripping the key', async () => {
    const response = await SELF.fetch(
      url(PREVIEW, `?a=1&preview_key=${encodeURIComponent(KEY)}&b=2`),
      { redirect: 'manual' }
    )
    expect(response.headers.get('Location')).toBe('/barista?a=1&b=2')
  })

  it('mints a cookie that requireBarista then accepts', async () => {
    const response = await SELF.fetch(url(PREVIEW, `?preview_key=${encodeURIComponent(KEY)}`), {
      redirect: 'manual',
    })
    const cookie = response.headers.get('Set-Cookie').split(';')[0]

    expect(await requireBarista(request(PREVIEW, cookie), env)).toBe(true)
  })

  it('refuses a wrong key without minting a cookie', async () => {
    const response = await SELF.fetch(url(PREVIEW, '?preview_key=wrong'), { redirect: 'manual' })
    expect(response.status).toBe(403)
    expect(response.headers.get('Set-Cookie')).toBeNull()
  })

  it('ignores preview_key entirely on the production hostname', async () => {
    const response = await SELF.fetch(
      url(PRODUCTION, `?preview_key=${encodeURIComponent(KEY)}`),
      { redirect: 'manual' }
    )
    expect(response.status).not.toBe(302)
    expect(response.headers.get('Set-Cookie') ?? '').not.toContain('cafecito_preview')
  })

  it('fails loudly when the Worker has no key configured', async () => {
    const target = new URL(url(PREVIEW, `?preview_key=${encodeURIComponent(KEY)}`))
    const response = await handlePreviewKeyExchange(new Request(target), {}, target)

    expect(response.status).toBe(500)
    expect((await response.json()).error).toContain('PREVIEW_BARISTA_KEY')
    expect(response.headers.get('Set-Cookie')).toBeNull()
  })
})
