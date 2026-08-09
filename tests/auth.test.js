import { describe, expect, it } from 'vitest'
import {
  CUSTOMER_COOKIE,
  customerCookieHeader,
  readCookie,
  signCustomerId,
  verifyAccessJwt,
  verifyCustomerCookie,
} from '../worker/auth.js'

const SECRET = 'test-secret'

describe('customer cookie', () => {
  it('round-trips a signed customer id', async () => {
    const signed = await signCustomerId('abc-123', SECRET)
    expect(await verifyCustomerCookie(signed, SECRET)).toBe('abc-123')
  })

  it('rejects a tampered id', async () => {
    const signed = await signCustomerId('abc-123', SECRET)
    const tampered = signed.replace('abc-123', 'abc-124')
    expect(await verifyCustomerCookie(tampered, SECRET)).toBeNull()
  })

  it('rejects a tampered signature', async () => {
    const signed = await signCustomerId('abc-123', SECRET)
    expect(await verifyCustomerCookie(`${signed}x`, SECRET)).toBeNull()
  })

  it('rejects a signature made with a different secret', async () => {
    const signed = await signCustomerId('abc-123', 'other-secret')
    expect(await verifyCustomerCookie(signed, SECRET)).toBeNull()
  })

  it('rejects null, empty, and unsigned values', async () => {
    expect(await verifyCustomerCookie(null, SECRET)).toBeNull()
    expect(await verifyCustomerCookie('', SECRET)).toBeNull()
    expect(await verifyCustomerCookie('abc-123', SECRET)).toBeNull()
  })

  it('emits a hardened Set-Cookie header', async () => {
    const header = customerCookieHeader(await signCustomerId('abc-123', SECRET))
    expect(header).toContain(`${CUSTOMER_COOKIE}=`)
    expect(header).toContain('HttpOnly')
    expect(header).toContain('Secure')
    expect(header).toContain('SameSite=Lax')
    expect(header).toContain('Path=/')
  })
})

describe('readCookie', () => {
  it('extracts one cookie from a multi-cookie header', () => {
    const request = new Request('https://example.com', {
      headers: { Cookie: 'other=1; cafecito_cid=xyz; third=3' },
    })
    expect(readCookie(request, CUSTOMER_COOKIE)).toBe('xyz')
  })

  it('returns null when the cookie is absent', () => {
    const request = new Request('https://example.com', { headers: { Cookie: 'other=1' } })
    expect(readCookie(request, CUSTOMER_COOKIE)).toBeNull()
  })

  it('returns null when there is no Cookie header at all', () => {
    expect(readCookie(new Request('https://example.com'), CUSTOMER_COOKIE)).toBeNull()
  })
})

const AUD = 'test-aud-tag'

// Builds a real RS256 JWT plus the JWKS that validates it.
async function makeAccessToken(overrides = {}) {
  const { publicKey, privateKey } = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify']
  )
  const jwk = await crypto.subtle.exportKey('jwk', publicKey)
  const kid = 'test-kid'

  const header = { alg: 'RS256', kid, typ: 'JWT' }
  const payload = {
    aud: [AUD],
    email: 'barista@example.com',
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  }

  const enc = (obj) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const signingInput = `${enc(header)}.${enc(payload)}`
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    privateKey,
    new TextEncoder().encode(signingInput)
  )
  let binary = ''
  for (const b of new Uint8Array(sig)) binary += String.fromCharCode(b)
  const encodedSig = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

  return {
    token: `${signingInput}.${encodedSig}`,
    jwks: { keys: [{ ...jwk, kid, alg: 'RS256', use: 'sig' }] },
  }
}

describe('verifyAccessJwt', () => {
  it('accepts a correctly signed, unexpired token for the right audience', async () => {
    const { token, jwks } = await makeAccessToken()
    const payload = await verifyAccessJwt(token, jwks, AUD)
    expect(payload.email).toBe('barista@example.com')
  })

  it('rejects a token for a different audience', async () => {
    const { token, jwks } = await makeAccessToken({ aud: ['someone-elses-app'] })
    expect(await verifyAccessJwt(token, jwks, AUD)).toBeNull()
  })

  it('rejects an expired token', async () => {
    const { token, jwks } = await makeAccessToken({ exp: Math.floor(Date.now() / 1000) - 10 })
    expect(await verifyAccessJwt(token, jwks, AUD)).toBeNull()
  })

  it('rejects a token whose signature does not match the JWKS', async () => {
    const { token } = await makeAccessToken()
    const { jwks: otherJwks } = await makeAccessToken()
    expect(await verifyAccessJwt(token, otherJwks, AUD)).toBeNull()
  })

  it('rejects a token whose kid is not in the JWKS', async () => {
    const { token, jwks } = await makeAccessToken()
    const wrongKid = { keys: [{ ...jwks.keys[0], kid: 'different-kid' }] }
    expect(await verifyAccessJwt(token, wrongKid, AUD)).toBeNull()
  })

  it('rejects null, garbage, and alg-none tokens', async () => {
    const { jwks } = await makeAccessToken()
    expect(await verifyAccessJwt(null, jwks, AUD)).toBeNull()
    expect(await verifyAccessJwt('not.a.jwt', jwks, AUD)).toBeNull()

    const noneHeader = btoa(JSON.stringify({ alg: 'none', kid: 'test-kid' }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    const body = btoa(JSON.stringify({ aud: [AUD], exp: Math.floor(Date.now() / 1000) + 60 }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    expect(await verifyAccessJwt(`${noneHeader}.${body}.`, jwks, AUD)).toBeNull()
  })
})
