import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { faults, findBrowser } from '../../skills/visuals/picture.mjs'
import { tmp } from './helpers.mjs'

const roomy = { left: 40, right: 40 }
const inBox = (box, edge = roomy) => ({ texts: [{ text: 'written by the hooks,', box, edge }], overlaps: [] })

test('a text that crosses its box is a fault, and so is one that keeps too little room; one with room is not', () => {
  assert.match(faults(inBox({ left: 16, right: -11.4, small: false }))[0], /runs 11\.4 px past the right of its box/)
  assert.match(faults(inBox({ left: 16, right: 3.7, small: false }))[0], /3\.7 px from the right of its box, and needs 8/)
  assert.deepEqual(faults(inBox({ left: 16, right: 8, small: false })), [])
})

test('a pill made to hug its text needs less room than a card', () => {
  assert.deepEqual(faults(inBox({ left: 6, right: 6, small: true })), [])
  assert.equal(faults(inBox({ left: 6, right: 6, small: false })).length, 1)
})

test('with wider letters a text may come close to its box and must not cross it', () => {
  assert.deepEqual(faults(inBox({ left: 16, right: 1, small: false }), { wider: true }), [])
  assert.equal(faults(inBox({ left: 16, right: -2, small: false }), { wider: true }).length, 1)
})

test('a text at the picture\'s edge is a fault, in a box or not', () => {
  assert.match(faults(inBox(null, { left: 40, right: 2 }))[0], /2 px from the picture's edge/)
  assert.deepEqual(faults(inBox(null)), [])
})

test('two texts drawn over each other are a fault as drawn, and are not counted twice with wider letters', () => {
  const measured = { texts: [], overlaps: [['their text,', 'the saved frame']] }
  assert.deepEqual(faults(measured), ['"their text," and "the saved frame" are drawn over each other'])
  assert.deepEqual(faults(measured, { wider: true }), [])
})

test('the browser is the one LCW_BROWSER names, else the first known one on the PATH, else none', () => {
  const bin = tmp('bin'), empty = tmp('empty')
  const own = path.join(bin, 'my-browser'), chromium = path.join(bin, 'chromium')
  fs.writeFileSync(own, '')
  fs.writeFileSync(chromium, '')
  assert.equal(findBrowser({ LCW_BROWSER: own, PATH: bin }, ['chromium']), own)
  assert.equal(findBrowser({ LCW_BROWSER: path.join(bin, 'gone'), PATH: bin }, ['chromium']), chromium)
  assert.equal(findBrowser({ PATH: bin }, ['edge', 'chromium']), chromium)
  assert.equal(findBrowser({ PATH: empty }, ['chromium']), null)
})
