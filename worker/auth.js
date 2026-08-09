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

export function readCookie(request, name) {
  const header = request.headers.get('Cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=') || null
  }
  return null
}
