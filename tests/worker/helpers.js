import { SELF } from 'cloudflare:test'

export const ORIGIN = 'https://cafecito.test'

// Threads the Set-Cookie response back into later requests, like a browser.
// Each call returns an independent client with its own cookie jar, so two
// clients behave like two different browsers (never sharing state).
export function makeClient() {
  let cookie = null
  return async (path, init = {}) => {
    const headers = new Headers(init.headers)
    if (cookie) headers.set('Cookie', cookie)
    const response = await SELF.fetch(`${ORIGIN}${path}`, { ...init, headers })
    const setCookie = response.headers.get('Set-Cookie')
    if (setCookie) cookie = setCookie.split(';')[0]
    return response
  }
}
