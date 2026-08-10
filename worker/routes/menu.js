import { getMenu } from '../db.js'

// include_unavailable is honoured only for baristas; a customer must never be
// able to widen their own view by tweaking a query string.
export async function handleMenu(request, env, { includeUnavailable = false } = {}) {
  return getMenu(env.DB, includeUnavailable)
}
