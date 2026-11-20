#!/usr/bin/env node
// node scripts/cleanup.mjs list [--recorded] | record --title T --bullet T... --item branch:<name>|worktree:<path>... | apply
// The repository is the one cwd is in. Only local branches and worktrees are ever removed.
import { home } from './lib/store.mjs'
import { candidates, recorded, record, apply } from './lib/cleanup.mjs'

const USAGE = 'usage: cleanup.mjs list [--recorded] | record --title T --bullet T... --item branch:<name>|worktree:<path>... | apply'
const [command, ...argv] = process.argv.slice(2)
const cwd = process.cwd()
const refuse = (msg) => { console.log(msg); process.exit(1) }
const json = (value) => console.log(JSON.stringify(value, null, 2))

function recordArgs() {
  const box = { title: null, bullets: [], items: [] }
  for (let i = 0; i < argv.length; i++) {
    const name = { '--title': 'title', '--bullet': 'bullets', '--item': 'items' }[argv[i]]
    if (!name) refuse(`Unknown argument: ${argv[i]}. Nothing was recorded.\n${USAGE}`)
    if (i + 1 >= argv.length) refuse(`${argv[i]} needs a value. Nothing was recorded.`)
    if (name === 'title') box.title = argv[++i]
    else box[name].push(argv[++i])
  }
  return box
}

try {
  if (command === 'list' && !argv.length) json(candidates(cwd, home()))
  else if (command === 'list' && argv.length === 1 && argv[0] === '--recorded') json(recorded(cwd, home()))
  else if (command === 'record') {
    const box = record(cwd, home(), recordArgs())
    console.log(`recorded ${box.items.length} items`)
  } else if (command === 'apply' && !argv.length) {
    const done = apply(cwd, home())
    if (!done) console.log('No cleanup is recorded for this repository. Nothing was removed.')
    else {
      const name = (i) => `${i.type} ${i.type === 'branch' ? i.name : i.path}`
      for (const i of done.removed) console.log(`removed ${name(i)}`)
      for (const s of done.skipped) console.log(`skipped ${name(s.item)}: ${s.reason}`)
      if (!done.removed.length && !done.skipped.length) console.log('Nothing was recorded to remove.')
    }
  } else refuse(USAGE)
} catch (e) {
  refuse(e.message)
}
