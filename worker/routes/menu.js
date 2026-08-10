import { getMenu } from '../db.js'

export async function handleMenu(request, env) {
  return getMenu(env.DB)
}
