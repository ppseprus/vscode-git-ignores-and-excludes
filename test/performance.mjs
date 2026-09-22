// The cost is spawning git, never git's own work. Every guard asks whether one
// spawn has quietly become many.
import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { load } from './load.mjs'
import { createRepository, remove, write } from './fixtures.mjs'

const { findIgnoreMatches, findLocalExcludesFile, findGlobalExcludesFile, findGitlinkPaths } = load('git')
const { RepositoryRegistry } = load('repositories')

const created = []
function buildRepository(fileCount, nestedIgnoreCount) {
  const root = createRepository()
  created.push(root)
  write(root, '.gitignore', '*.log\nbuild/\n')
  for (let index = 0; index < nestedIgnoreCount; index++) {
    write(root, `module-${index}/.gitignore`, `*.cache\ntemp-${index}/\n`)
  }
  const moduleCount = Math.max(1, nestedIgnoreCount)
  const files = Array.from({ length: fileCount }, (_, index) =>
    write(root, `module-${index % moduleCount}/file-${index}.${index % 3 === 0 ? 'log' : 'ts'}`)
  )
  return { root, files }
}
after(() => created.forEach(remove))

const timed = async (action) => {
  const startedAt = Date.now()
  const result = await action()
  return { result, milliseconds: Math.max(1, Date.now() - startedAt) }
}

describe('performance guards', () => {
  const workspace = buildRepository(1200, 12)
  let localExcludes
  let globalExcludes
  let singleBatchMs

  it('one batch of 1200 paths resolves under 500 ms', async () => {
    localExcludes = await findLocalExcludesFile(workspace.root)
    globalExcludes = await findGlobalExcludesFile(workspace.root)
    const { result, milliseconds } = await timed(() =>
      findIgnoreMatches(workspace.root, workspace.files, localExcludes, globalExcludes)
    )
    singleBatchMs = milliseconds
    assert.ok(milliseconds < 500, `${milliseconds} ms`)
    assert.ok(result.size > 300, `${result.size} matched`)
  })

  it('batching beats per-file resolution by at least 10x', async () => {
    const sample = workspace.files.slice(0, 40)
    const { milliseconds } = await timed(async () => {
      for (const file of sample) {
        await findIgnoreMatches(workspace.root, [file], localExcludes, globalExcludes)
      }
    })
    const projectedMs = (milliseconds / sample.length) * workspace.files.length
    assert.ok(projectedMs > singleBatchMs * 10, `batch ${singleBatchMs} ms vs projected ${Math.round(projectedMs)} ms per file`)
  })

  it('doubling the batch costs less than 4x the time', async () => {
    const half = workspace.files.slice(0, workspace.files.length / 2)
    const { milliseconds } = await timed(() => findIgnoreMatches(workspace.root, half, localExcludes, globalExcludes))
    assert.ok(singleBatchMs / milliseconds < 4, `${milliseconds} ms for half, ${singleBatchMs} ms for all`)
  })

  it('600 paths across 60 nested ignore files stay under 500 ms', async () => {
    const deep = buildRepository(600, 60)
    const { milliseconds } = await timed(async () =>
      findIgnoreMatches(deep.root, deep.files, await findLocalExcludesFile(deep.root), await findGlobalExcludesFile(deep.root))
    )
    assert.ok(milliseconds < 500, `${milliseconds} ms`)
  })

  it('200 repeated repository lookups cost less than three cold lookups', async () => {
    const registry = new RepositoryRegistry()
    const cold = await timed(() => registry.findContaining(workspace.files[0]))
    const repeated = await timed(async () => {
      for (let index = 0; index < 200; index++) {
        await registry.findContaining(workspace.files[index % workspace.files.length])
      }
    })
    assert.ok(repeated.milliseconds < Math.max(cold.milliseconds, 20) * 3, `${cold.milliseconds} ms cold, ${repeated.milliseconds} ms for 200 repeats`)
  })

  it('resolving 6 repositories concurrently beats doing it in sequence', async () => {
    const roots = Array.from({ length: 6 }, () => buildRepository(2, 1).root)
    const serial = await timed(async () => {
      for (const root of roots) {
        await findLocalExcludesFile(root)
        await findGlobalExcludesFile(root)
      }
    })
    const parallel = await timed(() =>
      Promise.all(roots.map((root) => Promise.all([findLocalExcludesFile(root), findGlobalExcludesFile(root)])))
    )
    assert.ok(parallel.milliseconds < serial.milliseconds, `${serial.milliseconds} ms serial vs ${parallel.milliseconds} ms parallel`)
  })

  it('nested repository discovery is a single fast call', async () => {
    const { result, milliseconds } = await timed(() => findGitlinkPaths(workspace.root))
    assert.ok(milliseconds < 200, `${milliseconds} ms`)
    assert.deepEqual(result, [])
  })
})
