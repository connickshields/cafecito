import { describe, expect, it } from 'vitest'
import {
  CUSTOMER_COOKIE,
  PREVIEW_COOKIE,
  customerCookieHeader,
  previewCookieHeader,
  readCookie,
  signCustomerId,
  signPreviewGrant,
  verifyAccessJwt,
  verifyCustomerCookie,
  verifyPreviewGrant,
  verifyPreviewKey,
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

const encodeB64url = (obj) =>
  btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const decodeB64url = (value) => {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

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

  it('rejects a token whose header segment decodes to the JSON literal null (resolves null, does not throw)', async () => {
    const { jwks } = await makeAccessToken()
    const nullHeader = encodeB64url(null)
    const body = encodeB64url({ aud: [AUD], exp: Math.floor(Date.now() / 1000) + 60 })
    const result = await verifyAccessJwt(`${nullHeader}.${body}.sig`, jwks, AUD)
    expect(result).toBeNull()
  })

  it('rejects a token whose payload segment decodes to the JSON literal null (resolves null, does not throw)', async () => {
    const { token, jwks } = await makeAccessToken()
    const [headerSegment, , signatureSegment] = token.split('.')
    const nullPayload = encodeB64url(null)
    const result = await verifyAccessJwt(`${headerSegment}.${nullPayload}.${signatureSegment}`, jwks, AUD)
    expect(result).toBeNull()
  })

  it('rejects a genuine algorithm-confusion attack: a valid HS256 signature keyed with the RSA public key', async () => {
    // Unlike the alg:"none" case above (which is rejected for the coincidental
    // reason that its signature is empty), this token carries a signature that
    // IS cryptographically valid for HS256 using the RSA public key's own
    // modulus bytes as the HMAC secret — the classic algorithm-confusion
    // attack. The only thing that can reject it is the hardcoded RS256 check.
    const { jwks } = await makeAccessToken()
    const publicJwk = jwks.keys[0]

    const header = { alg: 'HS256', kid: publicJwk.kid, typ: 'JWT' }
    const payload = {
      aud: [AUD],
      email: 'attacker@example.com',
      exp: Math.floor(Date.now() / 1000) + 3600,
    }
    const signingInput = `${encodeB64url(header)}.${encodeB64url(payload)}`

    const hmacKey = await crypto.subtle.importKey(
      'raw',
      decodeB64url(publicJwk.n),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    )
    const sig = await crypto.subtle.sign('HMAC', hmacKey, new TextEncoder().encode(signingInput))
    let binary = ''
    for (const b of new Uint8Array(sig)) binary += String.fromCharCode(b)
    const encodedSig = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

    const forgedToken = `${signingInput}.${encodedSig}`
    expect(await verifyAccessJwt(forgedToken, jwks, AUD)).toBeNull()
  })
})

describe('preview grant', () => {
  const SECRET = 'preview-secret-value'

  it('round-trips a grant it signed', async () => {
    const signed = await signPreviewGrant(SECRET)
    expect(await verifyPreviewGrant(signed, SECRET)).toBe(true)
  })

  it('rejects a grant signed with a different key', async () => {
    const signed = await signPreviewGrant('some-other-secret')
    expect(await verifyPreviewGrant(signed, SECRET)).toBe(false)
  })

  it('rejects a tampered, empty, or missing grant', async () => {
    const signed = await signPreviewGrant(SECRET)
    expect(await verifyPreviewGrant(`${signed}x`, SECRET)).toBe(false)
    expect(await verifyPreviewGrant('barista.', SECRET)).toBe(false)
    expect(await verifyPreviewGrant('', SECRET)).toBe(false)
    expect(await verifyPreviewGrant(null, SECRET)).toBe(false)
  })

  it('rejects a grant when the Worker has no key configured', async () => {
    const signed = await signPreviewGrant(SECRET)
    expect(await verifyPreviewGrant(signed, undefined)).toBe(false)
    expect(await verifyPreviewGrant(signed, '')).toBe(false)
  })

  it('refuses a customer cookie presented as a preview grant', async () => {
    // Both are signed by the same HMAC helper with the same secret; only the
    // signed token differs. Without the token check this would pass.
    const customer = await signCustomerId('some-customer-id', SECRET)
    expect(await verifyPreviewGrant(customer, SECRET)).toBe(false)
  })
})

describe('verifyPreviewKey', () => {
  const SECRET = 'preview-secret-value'

  it('accepts the correct key', async () => {
    expect(await verifyPreviewKey(SECRET, SECRET)).toBe(true)
  })

  it('rejects a wrong key', async () => {
    expect(await verifyPreviewKey('wrong', SECRET)).toBe(false)
    expect(await verifyPreviewKey(`${SECRET}x`, SECRET)).toBe(false)
  })

  it('rejects empty or missing input on either side', async () => {
    expect(await verifyPreviewKey('', SECRET)).toBe(false)
    expect(await verifyPreviewKey(null, SECRET)).toBe(false)
    expect(await verifyPreviewKey(SECRET, '')).toBe(false)
    expect(await verifyPreviewKey(SECRET, undefined)).toBe(false)
  })
})

describe('previewCookieHeader', () => {
  it('carries the domain so one cookie spans every PR alias', () => {
    const header = previewCookieHeader('barista.sig', 'connickshields.workers.dev')
    expect(header).toContain('cafecito_preview=barista.sig')
    expect(header).toContain('Domain=connickshields.workers.dev')
    expect(header).toContain('HttpOnly')
    expect(header).toContain('Secure')
    expect(header).toContain('SameSite=Lax')
    expect(header).toContain('Path=/')
  })

  it('omits Domain when there is none to set', () => {
    expect(previewCookieHeader('barista.sig', null)).not.toContain('Domain=')
  })
})
