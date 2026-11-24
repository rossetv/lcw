// node generate.mjs <plugin folder>: writes the expected bytes from that folder's status line.
import fs from 'node:fs'
import path from 'node:path'
import { fixtures, drawFixture, expectedFile, EXPECTED } from './fixtures.mjs'

const root = path.resolve(process.argv[2] ?? '')
if (!fs.existsSync(root + '/scripts/statusline.mjs')) { console.error('usage: node generate.mjs <plugin folder>'); process.exit(1) }
fs.mkdirSync(EXPECTED, { recursive: true })
await Promise.all(fixtures.filter((f) => !f.sameAs).map(async (f) => fs.writeFileSync(expectedFile(f), JSON.stringify(await drawFixture(root, f), null, 1) + '\n')))
