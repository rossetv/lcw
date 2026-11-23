import { expect, test } from 'claude-code/testing'

const CORE = { plugin: 'engine', tier: 'core' }

test('the Artifact tool waits behind tool search with its description as it was, and no other tool is moved', async ($, on) => {
  on('tool.describe', (_: any, e: any) => ({ description: e.description }))
  const artifact = await $.tool.describe({ tool: 'Artifact', description: 'renders a page', provider: CORE } as any)
  expect(artifact).toEqual({ description: 'renders a page', isDeferred: true })
  const bash = await $.tool.describe({ tool: 'Bash', description: 'runs a command', provider: CORE } as any)
  expect(bash).toEqual({ description: 'runs a command' })
})
