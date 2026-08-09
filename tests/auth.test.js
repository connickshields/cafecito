import { describe, expect, it } from 'vitest'
import {
  CUSTOMER_COOKIE,
  customerCookieHeader,
  readCookie,
  signCustomerId,
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
