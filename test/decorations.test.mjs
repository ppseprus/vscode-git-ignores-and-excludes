import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { load } from './load.mjs'
import { createRepository, remove, temporaryDirectory, write } from './fixtures.mjs'

const { IgnoreDecorationProvider } = load('decorations')

const token = { isCancellationRequested: false }
const uri = (fsPath) => ({ scheme: 'file', fsPath })
const fakeLog = () => ({
  batches: [],
  failures: [],
  recordBatch(name, pathCount) {
    this.batches.push(pathCount)
  },
  recordFailure(activity) {
    this.failures.push(activity)
  }
})

const root = createRepository()
after(() => remove(root))
write(root, '.gitignore', '*.log\n')
const repository = {
  root,
  localExcludesFile: write(root, '.git/info/exclude', '/notes.md\n'),
  globalExcludesFile: path.join(root, 'no-global-excludes'),
  indexFile: path.join(root, '.git', 'index')
}
const notes = write(root, 'notes.md')
const files = Array.from({ length: 120 }, (_, index) => write(root, `file-${index}.${index % 2 === 0 ? 'log' : 'ts'}`))
const decorate = (provider, filePath) => provider.provideFileDecoration(uri(filePath), token)

describe('IgnoreDecorationProvider', () => {
  it('answers concurrent requests with one git call per repository', async () => {
    const log = fakeLog()
    const provider = new IgnoreDecorationProvider(() => Promise.resolve([repository]), log)
    const decorations = await Promise.all([notes, ...files].map((file) => decorate(provider, file)))
    assert.deepEqual(log.batches, [files.length + 1])

    const [excluded, ignored, tracked] = decorations
    assert.equal(excluded.badge, '※')
    assert.match(excluded.tooltip, /^Excluded {2}\n\.git\/info\/exclude:1, "\/notes\.md"/)
    assert.equal(excluded.color.id, 'gitIgnoresAndExcludes.localExcludesForeground')
    assert.equal(ignored.badge, undefined)
    assert.match(ignored.tooltip, /^Ignored {2}\n\.gitignore:1, "\*\.log"/)
    assert.equal(tracked, undefined)
    provider.dispose()
  })

  it('answers from the cache until invalidated, and repaint keeps the cache', async () => {
    const log = fakeLog()
    const provider = new IgnoreDecorationProvider(() => Promise.resolve([repository]), log)
    await decorate(provider, notes)
    provider.repaint()
    await decorate(provider, notes)
    assert.deepEqual(log.batches, [1])
    provider.invalidate()
    await decorate(provider, notes)
    assert.deepEqual(log.batches, [1, 1])
    provider.dispose()
  })

  it('leaves files outside every repository undecorated without asking git', async () => {
    const log = fakeLog()
    const provider = new IgnoreDecorationProvider(() => Promise.resolve([]), log)
    assert.equal(await decorate(provider, path.join(temporaryDirectory(), 'x.log')), undefined)
    assert.deepEqual(log.batches, [])
    provider.dispose()
  })

  it('logs a failed repository resolution once per batch and caches nothing', async () => {
    const log = fakeLog()
    let broken = true
    const provider = new IgnoreDecorationProvider(
      () => (broken ? Promise.reject(new Error('boom')) : Promise.resolve([repository])),
      log
    )
    const decorations = await Promise.all(files.slice(0, 10).map((file) => decorate(provider, file)))
    assert.deepEqual(decorations, Array(10).fill(undefined))
    assert.deepEqual(log.failures, ['Resolving the workspace repositories'])

    broken = false
    assert.notEqual(await decorate(provider, files[0]), undefined)
    assert.deepEqual(log.batches, [1])
    provider.dispose()
  })

  it('logs a failed scan and asks again next time', async () => {
    const log = fakeLog()
    const vanished = { ...repository, root: path.join(root, 'vanished') }
    const provider = new IgnoreDecorationProvider(() => Promise.resolve([vanished]), log)
    const file = path.join(vanished.root, 'a.log')
    assert.equal(await decorate(provider, file), undefined)
    assert.equal(await decorate(provider, file), undefined)
    assert.deepEqual(log.failures, ['Scanning vanished', 'Scanning vanished'])
    provider.dispose()
  })
})
