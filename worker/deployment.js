// Which deployment is serving this request, decided from the hostname alone.
//
// Production is the DEFAULT, never a case of its own: an unrecognised hostname
// gets the strictest rule, so a hostname nobody anticipated cannot fall into a
// weaker branch. A deployed production Worker never sees a localhost or
// *.workers.dev hostname -- production sets workers_dev = false and serves
// only its custom domain -- which is what makes the other two branches safe.

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]'])

// endsWith, never includes: `workers.dev.evil.com` is a domain an attacker can
// register, and it must classify as production.
const PREVIEW_SUFFIX = '.workers.dev'

export function deploymentKind(hostname) {
  if (LOCAL_HOSTNAMES.has(hostname)) return 'local'
  if (hostname.endsWith(PREVIEW_SUFFIX)) return 'preview'
  return 'production'
}

// The registrable domain of a preview host, so one cookie covers every per-PR
// alias instead of needing a fresh key paste per pull request. workers.dev is
// on the public suffix list, which makes <account>.workers.dev the registrable
// domain and a legal cookie scope.
export function previewCookieDomain(hostname) {
  if (deploymentKind(hostname) !== 'preview') return null
  const labels = hostname.split('.')
  if (labels.length < 3) return null
  return labels.slice(-3).join('.')
}
