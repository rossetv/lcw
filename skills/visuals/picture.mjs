#!/usr/bin/env node
// node picture.mjs build <page.html> <file.svg>            run a page that lays a picture out, and save the SVG it leaves in #picture
// node picture.mjs check <file.svg>...                      measure every text against its box, the picture's edge and the other texts
// node picture.mjs render <file.svg> <folder> [seconds...]  draw it light and dark; with seconds, its animation stopped at each
// Needs a Chromium-family browser. LCW_BROWSER names one that is installed somewhere else.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const USAGE = 'usage: picture.mjs build <page.html> <file.svg> | check <file.svg>... | render <file.svg> <folder> [seconds...]'
const BROWSERS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge',
]

export function findBrowser(env = process.env, known = BROWSERS) {
  for (const name of [env.LCW_BROWSER, ...known]) {
    if (!name) continue
    if (name.includes(path.sep)) {
      if (fs.existsSync(name)) return name
      continue
    }
    for (const dir of (env.PATH || '').split(path.delimiter)) {
      if (dir && fs.existsSync(path.join(dir, name))) return path.join(dir, name)
    }
  }
  return null
}

// Room a text must keep to its box's side. A pill or a cell made to hug its text needs less than a card does.
const ROOM = { card: 8, small: 4, pictureEdge: 8 }

/**
 * What is wrong with the measured texts, one line each. `wider` is the pass drawn with wider letters and no fixed
 * lengths, where a text may come close to its box but must not cross it.
 */
export function faults(measured, { wider = false } = {}) {
  const out = []
  for (const t of measured.texts) {
    const said = `"${t.text}"`
    if (t.box) {
      const need = wider ? 0 : t.box.small ? ROOM.small : ROOM.card
      if (t.box.right < need) out.push(t.box.right < 0 ? `${said} runs ${-t.box.right} px past the right of its box` : `${said} is ${t.box.right} px from the right of its box, and needs ${need}`)
      if (t.box.left < (wider ? 0 : ROOM.small)) out.push(`${said} starts ${t.box.left} px from the left of its box`)
    }
    const edge = wider ? 0 : ROOM.pictureEdge
    if (t.edge.right < edge || t.edge.left < edge) out.push(`${said} is ${Math.min(t.edge.right, t.edge.left)} px from the picture's edge, and needs ${edge}`)
  }
  if (!wider) for (const [a, b] of measured.overlaps) out.push(`"${a}" and "${b}" are drawn over each other`)
  return out
}

// Runs in the page: every text that is shown, with the room it has in the smallest box it starts in.
const MEASURE = `
const svg = document.querySelector('svg')
const shown = (el) => { for (let e = el; e && e !== document; e = e.parentNode) { const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return false } return true }
const round = (n) => Math.round(n * 10) / 10
const page = svg.getBoundingClientRect()
const boxes = [...svg.querySelectorAll('rect')].map((r) => r.getBoundingClientRect()).filter((r) => r.width < page.width - 2 || r.height < page.height - 2)
const texts = [...svg.querySelectorAll('text')].filter((t) => t.textContent.trim()).map((t) => ({ t, b: t.getBoundingClientRect(), shown: shown(t) })).filter(({ b }) => b.width > 0)
const out = { texts: [], overlaps: [] }
for (const { t, b } of texts) {
  const x = b.left + Math.min(b.width, 4), y = b.top + b.height / 2
  const box = boxes.filter((r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom && r.height >= b.height - 2).sort((p, q) => p.width * p.height - q.width * q.height)[0]
  out.texts.push({
    text: t.textContent.trim().slice(0, 48),
    box: box ? { left: round(b.left - box.left), right: round(box.right - b.right), small: box.height <= 22 } : null,
    edge: { left: round(b.left - page.left), right: round(page.right - b.right) },
  })
}
for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
  const p = texts[i].b, q = texts[j].b
  if (!texts[i].shown || !texts[j].shown) continue
  if (Math.min(p.right, q.right) - Math.max(p.left, q.left) > 3 && Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top) > 3) out.overlaps.push([texts[i].t.textContent.trim().slice(0, 32), texts[j].t.textContent.trim().slice(0, 32)])
}
const pre = document.createElement('pre'); pre.id = 'measured'; pre.textContent = JSON.stringify(out); document.body.appendChild(pre)
`

const unescape = (s) => s.replace(/&nbsp;/g, '\u00a0').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
// Extra rules go last in the picture's own style block, or in a new one when it has none.
const styled = (svg, css) => (svg.includes('</style>') ? svg.replace('</style>', `${css}</style>`) : svg.replace(/<svg[^>]*>/, (open) => `${open}<style>${css}</style>`))

function inTemp(name, content, use) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lcw-picture-'))
  try {
    const file = path.join(dir, name)
    fs.writeFileSync(file, content)
    return use(file)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

const dump = (browser, url) => spawnSync(browser, ['--headless=new', '--virtual-time-budget=2000', '--dump-dom', url], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).stdout || ''

/** Why the browser cannot read the file as an SVG, or null when it can. GitHub shows such a file as a broken image. */
function unreadable(browser, file) {
  const error = dump(browser, pathToFileURL(path.resolve(file)).href).match(/<parsererror[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>/)
  return error ? unescape(error[1]).trim() : null
}

function build(browser, page, file) {
  const left = dump(browser, pathToFileURL(path.resolve(page)).href).match(/<(textarea|pre)[^>]*\bid="picture"[^>]*>([\s\S]*?)<\/\1>/)
  if (!left || !left[2].trim()) throw new Error(`${page} left no SVG in an element with the id "picture". Nothing was written.`)
  fs.writeFileSync(file, `${unescape(left[2]).trim()}\n`)
  const why = unreadable(browser, file)
  if (why) throw new Error(`${file} was written, and is not a valid SVG file: ${why}`)
  console.log(file)
}

function measure(browser, svg, wider) {
  // At rest, so that what an animation hides or moves does not change the answer.
  let drawn = styled(svg, '*{animation:none!important}')
  if (wider) drawn = styled(drawn.replace(/ textLength="[^"]*"/g, ''), 'text{font-family:Verdana,"DejaVu Sans",sans-serif!important}')
  const html = `<!doctype html><meta charset="utf-8"><body style="margin:0">${drawn}<script>${MEASURE}</script>`
  const dom = inTemp('measure.html', html, (file) => dump(browser, pathToFileURL(file).href))
  const found = dom.match(/<pre id="measured">([\s\S]*?)<\/pre>/)
  if (!found) throw new Error('the browser did not measure the picture')
  return JSON.parse(unescape(found[1]))
}

function check(browser, files) {
  let bad = 0
  for (const file of files) {
    const why = unreadable(browser, file)
    if (why) {
      console.log(`${path.basename(file)}: not a valid SVG file, so it would show as a broken image. ${why}`)
      bad += 1
      continue
    }
    const svg = fs.readFileSync(file, 'utf8')
    const asDrawn = measure(browser, svg, false)
    const found = [...faults(asDrawn), ...faults(measure(browser, svg, true), { wider: true }).map((line) => `with wider letters, ${line}`)]
    const inBoxes = asDrawn.texts.filter((t) => t.box).length
    console.log(`${path.basename(file)}: ${asDrawn.texts.length} texts measured, ${inBoxes} of them in a box. ${found.length ? `${found.length} to fix:` : 'Nothing to fix.'}`)
    for (const line of found.slice(0, 20)) console.log(`  ${line}`)
    if (found.length > 20) console.log(`  and ${found.length - 20} more`)
    bad += found.length
  }
  return bad
}

function render(browser, file, folder, seconds) {
  const svg = fs.readFileSync(file, 'utf8')
  const size = svg.match(/viewBox="[\d.]+ [\d.]+ ([\d.]+) ([\d.]+)"/)
  if (!size) throw new Error(`${file} has no viewBox to take its size from`)
  const out = path.resolve(folder)
  fs.mkdirSync(out, { recursive: true })
  const name = path.basename(file, path.extname(file))
  for (const at of seconds.length ? seconds : [null]) {
    // One loop length and no delays of its own: only then does a negative delay stop every part at the same moment.
    const still = at === null ? svg : styled(svg, `*{animation-play-state:paused!important;animation-delay:-${at}s!important}`)
    for (const [scheme, flag] of [['light', 1], ['dark', 0]]) {
      const png = path.join(out, `${name}${at === null ? '' : `-${at}s`}-${scheme}.png`)
      inTemp(`${name}.svg`, still, (tmp) => spawnSync(browser, ['--headless=new', '--hide-scrollbars', '--force-device-scale-factor=2', `--window-size=${Math.ceil(size[1])},${Math.ceil(size[2])}`,
        `--blink-settings=preferredColorScheme=${flag}`, `--screenshot=${png}`, pathToFileURL(tmp).href], { encoding: 'utf8' }))
      if (!fs.existsSync(png)) throw new Error(`the browser did not draw ${png}`)
      console.log(png)
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...rest] = process.argv.slice(2)
  const refuse = (msg) => { console.log(msg); process.exit(2) }
  if (!['build', 'check', 'render'].includes(command) || !rest.length || (command !== 'check' && rest.length < 2) || (command === 'build' && rest.length > 2)) refuse(USAGE)
  const browser = findBrowser() || refuse('No Chromium-family browser was found (Chrome, Chromium, Edge). Set LCW_BROWSER to one. Nothing was checked.')
  try {
    if (command === 'check') process.exit(check(browser, rest) ? 1 : 0)
    if (command === 'build') build(browser, rest[0], rest[1])
    else render(browser, rest[0], rest[1], rest.slice(2))
  } catch (err) {
    refuse(err.message)
  }
}
