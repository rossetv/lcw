// node generate.mjs <plugin folder>: writes the expected bytes from that folder's status line.
import fs from 'node:fs'
import path from 'node:path'
import { fixtures, drawFixture, expectedFile, EXPECTED } from './fixtures.mjs'

const root = path.resolve(process.argv[2] ?? '')
if (!fs.existsSync(root + '/scripts/statusline.mjs')) { console.error('usage: node generate.mjs <plugin folder>'); process.exit(1) }
fs.mkdirSync(EXPECTED, { recursive: true })
// one at a time: each draw takes over the process's environment
for (const f of fixtures.filter((x) => !x.sameAs)) fs.writeFileSync(expectedFile(f), JSON.stringify(await drawFixture(root, f), null, 1) + '\n')
