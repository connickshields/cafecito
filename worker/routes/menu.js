import {
  activeMenuIds,
  createMenuEntry,
  getMenu,
  getMenuForManagement,
  MENU_KINDS,
  nameTaken,
  optionIdsExist,
  reorderMenuEntries,
  updateMenuEntry,
} from '../menu-db.js'
import { readJsonBody } from './body.js'

export async function handleMenu(request, env) {
  return getMenu(env.DB)
}

const MAX_NAME = 60
const MAX_DESCRIPTION = 200
const MAX_TYPE = 30
const MAX_SIZE = 64

const LINK_FIELDS = [
  ['milkOptionIds', 'milk'],
  ['customizationOptionIds', 'customizations'],
]

function fail(message) {
  return { status: 400, body: { error: message } }
}

const notFound = { status: 404, body: { error: 'Not found' } }

function readIdList(value) {
  if (!Array.isArray(value)) return null
  if (value.some((id) => !Number.isInteger(id))) return null
  return [...new Set(value)]
}

// `creating` decides which fields are required. On update every field is
// optional and an absent field means "leave it alone", which is why this
// cannot simply validate a fully-populated object.
function readFields(kind, body, { creating }) {
  const columns = {}
  const links = {}

  if (creating || 'name' in body) {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (name.length === 0 || name.length > MAX_NAME) {
      return { error: `name must be 1-${MAX_NAME} characters` }
    }
    columns.name = name
  }

  for (const flag of ['available', 'archived']) {
    if (flag in body) {
      if (typeof body[flag] !== 'boolean') return { error: `${flag} must be a boolean` }
      columns[flag] = body[flag] ? 1 : 0
    }
  }

  if (kind === 'items') {
    if ('description' in body) {
      if (body.description !== null && typeof body.description !== 'string') {
        return { error: 'description must be a string or null' }
      }
      const description = body.description === null ? null : body.description.trim()
      if (description !== null && description.length > MAX_DESCRIPTION) {
        return { error: `description must be at most ${MAX_DESCRIPTION} characters` }
      }
      columns.description = description
    }

    if ('size' in body) {
      const size = body.size
      if (size !== null && (!Number.isInteger(size) || size < 1 || size > MAX_SIZE)) {
        return { error: `size must be null or an integer from 1 to ${MAX_SIZE}` }
      }
      columns.size = size
    }

    for (const [field, linkKind] of LINK_FIELDS) {
      if (field in body) {
        const ids = readIdList(body[field])
        if (ids === null) return { error: `${field} must be an array of integers` }
        links[linkKind] = ids
      }
    }
  }

  if (kind === 'customizations' && (creating || 'type' in body)) {
    const type = typeof body.type === 'string' ? body.type.trim() : ''
    if (type.length === 0 || type.length > MAX_TYPE) {
      return { error: `type must be 1-${MAX_TYPE} characters` }
    }
    columns.type = type
  }

  return { fields: { columns, links } }
}

async function checkLinks(db, links) {
  for (const [field, linkKind] of LINK_FIELDS) {
    const ids = links[linkKind]
    if (ids && !(await optionIdsExist(db, linkKind, ids))) {
      return `${field} references an unknown or archived option`
    }
  }
  return null
}

async function create(env, kind, body) {
  const parsed = readFields(kind, body, { creating: true })
  if (parsed.error) return fail(parsed.error)
  const { fields } = parsed

  if (await nameTaken(env.DB, kind, fields.columns.name)) {
    return { status: 409, body: { error: 'That name is already in use' } }
  }
  const linkError = await checkLinks(env.DB, fields.links)
  if (linkError) return fail(linkError)

  return { status: 201, body: { id: await createMenuEntry(env.DB, kind, fields) } }
}

async function update(env, kind, id, body) {
  const parsed = readFields(kind, body, { creating: false })
  if (parsed.error) return fail(parsed.error)
  const { fields } = parsed

  if (fields.columns.name !== undefined && (await nameTaken(env.DB, kind, fields.columns.name, id))) {
    return { status: 409, body: { error: 'That name is already in use' } }
  }
  const linkError = await checkLinks(env.DB, fields.links)
  if (linkError) return fail(linkError)

  const updated = await updateMenuEntry(env.DB, kind, id, fields)
  return updated ? { status: 200, body: { ok: true } } : notFound
}

async function reorder(env, kind, body) {
  const ids = readIdList(body.ids)
  if (ids === null) return fail('ids must be an array of integers')

  // Set equality, not just length. A stale tab reordering a list someone else
  // has since added to would otherwise leave two rows sharing a position.
  const active = await activeMenuIds(env.DB, kind)
  const matches = ids.length === active.length && active.every((id) => ids.includes(id))
  if (!matches) return fail('ids must be exactly the current unarchived ids for this kind')

  await reorderMenuEntries(env.DB, kind, ids)
  return { status: 200, body: { ok: true } }
}

// `order` can never be mistaken for a row id: ids match \d+ only.
const MENU_PATH = /^\/api\/barista\/menu\/(items|milk|customizations)(?:\/(order|\d+))?$/

export async function handleMenuAdmin(request, env, url) {
  const method = request.method

  if (url.pathname === '/api/barista/menu' && method === 'GET') {
    return { status: 200, body: await getMenuForManagement(env.DB) }
  }

  const match = url.pathname.match(MENU_PATH)
  if (!match) return notFound

  const [, kind, tail] = match
  if (!Object.hasOwn(MENU_KINDS, kind)) return notFound

  if (tail === undefined && method === 'POST') {
    return create(env, kind, await readJsonBody(request))
  }
  if (tail === 'order' && method === 'PATCH') {
    return reorder(env, kind, await readJsonBody(request))
  }
  if (tail !== undefined && tail !== 'order' && method === 'PATCH') {
    return update(env, kind, Number(tail), await readJsonBody(request))
  }

  return notFound
}
