import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { withCustomer } from '../../worker/index.js'

// A missing COOKIE_SECRET must fail loud, not silently sign every customer
// cookie with the guessable string "undefined". See worker/index.js.
describe('withCustomer without a configured COOKIE_SECRET', () => {
  it('throws when COOKIE_SECRET is unset', async () => {
    const request = new Request('https://cafecito.test/api/menu')
    await expect(withCustomer(request, { ...env, COOKIE_SECRET: undefined })).rejects.toThrow(
      /COOKIE_SECRET/
    )
  })

  it('throws when COOKIE_SECRET is an empty string', async () => {
    const request = new Request('https://cafecito.test/api/menu')
    await expect(withCustomer(request, { ...env, COOKIE_SECRET: '' })).rejects.toThrow(
      /COOKIE_SECRET/
    )
  })

  it('does not throw once COOKIE_SECRET is configured', async () => {
    const request = new Request('https://cafecito.test/api/menu')
    await expect(withCustomer(request, env)).resolves.toEqual(
      expect.objectContaining({ customerId: expect.any(String) })
    )
  })
})
