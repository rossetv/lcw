import test from 'node:test'
import assert from 'node:assert/strict'
import { signInKind, settle } from '../../lib/billing.mjs'

const a = (authMethod) => ({ authMethod, email: 'x@example.test', org: 'Example' })

test('each sign-in method maps to its billing kind', () => {
  assert.equal(signInKind(a('claude.ai'), {}), 'subscription')
  for (const m of ['api_key', 'api_key_helper', 'third_party']) assert.equal(signInKind(a(m), {}), 'payg')
  assert.equal(signInKind(a('none'), {}), 'unclear')
  assert.equal(signInKind({}, {}), 'unclear')
})

test('an unreadable sign-in is unclear', () => {
  assert.equal(signInKind(null, {}), 'unclear')
  assert.equal(signInKind(undefined, {}), 'unclear')
})

test('an oauth token is judged by the credential: auth token payg, subscription token alone subscription, behind a proxy unclear', () => {
  const o = a('oauth_token')
  assert.equal(signInKind(o, { ANTHROPIC_AUTH_TOKEN: 't' }), 'payg')
  assert.equal(signInKind(o, { ANTHROPIC_AUTH_TOKEN: 't', CLAUDE_CODE_OAUTH_TOKEN: 's' }), 'payg')
  assert.equal(signInKind(o, { CLAUDE_CODE_OAUTH_TOKEN: 's' }), 'subscription')
  assert.equal(signInKind(o, { CLAUDE_CODE_OAUTH_TOKEN: 's', ANTHROPIC_BASE_URL: 'https://p.test' }), 'unclear')
  assert.equal(signInKind(o, {}), 'unclear')
})

test('a weekly figure wins over payg and subscription stays subscription', () => {
  assert.equal(settle('payg', { weekly: { percentUsed: 3 } }), 'subscription')
  assert.equal(settle('unclear', { weekly: { percentUsed: 0 }, replied: true }), 'subscription')
  assert.equal(settle('subscription', { replied: true }), 'subscription')
})

test('a weekly figure of 0 still makes a subscription, whatever the kind', () => {
  assert.equal(settle('unclear', { weekly: 0, replied: true }), 'subscription')
  assert.equal(settle('payg', { weekly: 0, replied: true }), 'subscription')
})

test('unclear settles to payg only on a reply without a weekly figure', () => {
  assert.equal(settle('unclear', { replied: true }), 'payg')
  assert.equal(settle('unclear', { replied: false }), 'unclear')
  assert.equal(settle('payg', { replied: true }), 'payg')
})
