const encoder = new TextEncoder()

export const CUSTOMER_COOKIE = 'cafecito_cid'
const COOKIE_MAX_AGE = 60 * 60 * 24 * 180 // 180 days

function base64url(bytes) {
  let binary = ''
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64url(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  return Uint8Array.from(binary, (c) => c.charCodeAt(0))
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  )
}

export async function signCustomerId(customerId, secret) {
  const key = await hmacKey(secret)
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(customerId))
  return `${customerId}.${base64url(signature)}`
}

// Returns the customer id, or null for anything we did not sign.
export async function verifyCustomerCookie(value, secret) {
  if (!value) return null
  const separator = value.lastIndexOf('.')
  if (separator <= 0) return null

  const customerId = value.slice(0, separator)
  const signature = value.slice(separator + 1)
  if (!customerId || !signature) return null

  let signatureBytes
  try {
    signatureBytes = fromBase64url(signature)
  } catch {
    return null
  }

  const key = await hmacKey(secret)
  // crypto.subtle.verify is constant-time.
  const valid = await crypto.subtle.verify('HMAC', key, signatureBytes, encoder.encode(customerId))
  return valid ? customerId : null
}

export function customerCookieHeader(signed) {
  return [
    `${CUSTOMER_COOKIE}=${signed}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${COOKIE_MAX_AGE}`,
  ].join('; ')
}

export const PREVIEW_COOKIE = 'cafecito_preview'
const PREVIEW_TOKEN = 'barista'
const PREVIEW_COOKIE_MAX_AGE = 60 * 60 * 24 * 30 // 30 days

export async function signPreviewGrant(secret) {
  return signCustomerId(PREVIEW_TOKEN, secret)
}

// A cookie is a grant only when it carries PREVIEW_TOKEN under this secret --
// a customer cookie is signed by the same helper and would otherwise verify.
export async function verifyPreviewGrant(value, secret) {
  if (!value || !secret) return false
  return (await verifyCustomerCookie(value, secret)) === PREVIEW_TOKEN
}

// Validates a presented key without ever comparing the secret as a string:
// sign a fixed token with the PRESENTED key, then verify that signature with
// the REAL key. The comparison is constant-time (see verifyCustomerCookie)
// and never string-compares the secret — but it is not exact-match: HMAC
// zero-pads keys shorter than its 64-byte block, so inputs differing only by
// trailing NUL padding are treated as equal.
export async function verifyPreviewKey(presented, secret) {
  if (!presented || !secret) return false
  const candidate = await signCustomerId(PREVIEW_TOKEN, presented)
  return (await verifyCustomerCookie(candidate, secret)) === PREVIEW_TOKEN
}

export function previewCookieHeader(signed, domain) {
  const parts = [
    `${PREVIEW_COOKIE}=${signed}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${PREVIEW_COOKIE_MAX_AGE}`,
  ]
  if (domain) parts.push(`Domain=${domain}`)
  return parts.join('; ')
}

export function readCookie(request, name) {
  const header = request.headers.get('Cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=') || null
  }
  return null
}

function decodeSegment(segment) {
  const json = new TextDecoder().decode(fromBase64url(segment))
  return JSON.parse(json)
}

// Verifies a Cf-Access-Jwt-Assertion. Returns the payload or null.
// jwks is injected so this is unit-testable without network access.
export async function verifyAccessJwt(token, jwks, aud, now = Date.now()) {
  if (!token) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null

  let header
  let payload
  try {
    header = decodeSegment(parts[0])
    payload = decodeSegment(parts[1])
  } catch {
    return null
  }

  // JSON.parse succeeds on non-object literals like "null" — guard against
  // that so header.alg / payload.aud below can never throw.
  if (typeof header !== 'object' || header === null) return null
  if (typeof payload !== 'object' || payload === null) return null

  // Only RS256 is ever accepted — never trust the token's own alg claim to
  // select a weaker algorithm, and never accept "none".
  if (header.alg !== 'RS256' || !header.kid) return null

  const jwk = jwks?.keys?.find((k) => k.kid === header.kid)
  if (!jwk) return null

  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
  if (!audiences.includes(aud)) return null
  if (typeof payload.exp !== 'number' || payload.exp * 1000 <= now) return null

  let key
  try {
    key = await crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify']
    )
  } catch {
    return null
  }

  let signature
  try {
    signature = fromBase64url(parts[2])
  } catch {
    return null
  }

  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    signature,
    encoder.encode(`${parts[0]}.${parts[1]}`)
  )
  return valid ? payload : null
}

let jwksCache = { domain: null, keys: null, fetchedAt: 0 }
const JWKS_TTL_MS = 60 * 60 * 1000

export async function fetchAccessJwks(teamDomain) {
  const fresh = jwksCache.domain === teamDomain && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS
  if (fresh) return jwksCache.keys

  const response = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`)
  if (!response.ok) throw new Error(`JWKS fetch failed: ${response.status}`)
  const keys = await response.json()
  jwksCache = { domain: teamDomain, keys, fetchedAt: Date.now() }
  return keys
}
