import { describe, expect, it } from 'vitest'
import { deploymentKind, previewCookieDomain } from '../worker/deployment.js'

describe('deploymentKind', () => {
  it('classifies local hostnames', () => {
    expect(deploymentKind('localhost')).toBe('local')
    expect(deploymentKind('127.0.0.1')).toBe('local')
    expect(deploymentKind('[::1]')).toBe('local')
  })

  it('classifies preview hostnames', () => {
    expect(deploymentKind('pr-22-cafecito-preview.connickshields.workers.dev')).toBe('preview')
    expect(deploymentKind('cafecito-preview.connickshields.workers.dev')).toBe('preview')
  })

  it('classifies the production hostname', () => {
    expect(deploymentKind('cafecito.connick.me')).toBe('production')
  })

  it('treats an unrecognised hostname as production', () => {
    expect(deploymentKind('example.com')).toBe('production')
    expect(deploymentKind('')).toBe('production')
  })

  it('does not mistake a domain that merely contains workers.dev', () => {
    // These are attacker-registrable domains. The check must be endsWith on
    // '.workers.dev', never includes, or an attacker picks their own branch.
    expect(deploymentKind('workers.dev.evil.com')).toBe('production')
    expect(deploymentKind('notworkers.dev')).toBe('production')
    expect(deploymentKind('workers.dev')).toBe('production')
    // The discriminating case: `.workers.dev` appears as a substring but not
    // as the suffix. `includes` would hand this attacker-registrable domain
    // the preview branch; `endsWith` correctly refuses it.
    expect(deploymentKind('x.workers.dev.evil.com')).toBe('production')
  })
})

describe('previewCookieDomain', () => {
  it('returns one registrable domain shared by every PR alias', () => {
    // The point of the shared scope: one key paste covers all previews.
    expect(previewCookieDomain('pr-22-cafecito-preview.connickshields.workers.dev')).toBe(
      'connickshields.workers.dev'
    )
    expect(previewCookieDomain('pr-9-cafecito-preview.connickshields.workers.dev')).toBe(
      'connickshields.workers.dev'
    )
  })

  it('returns null for anything that is not a preview host', () => {
    expect(previewCookieDomain('cafecito.connick.me')).toBeNull()
    expect(previewCookieDomain('localhost')).toBeNull()
    expect(previewCookieDomain('workers.dev.evil.com')).toBeNull()
    expect(previewCookieDomain('x.workers.dev.evil.com')).toBeNull()
  })
})
