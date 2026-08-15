import { describe, expect, it } from 'vitest'
import { requireBarista } from '../../worker/routes/barista.js'
import { signPreviewGrant } from '../../worker/auth.js'

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
