import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { load, vscode } from './load.mjs'
import { createRepository, git, remove, temporaryDirectory, withoutGit, write } from './fixtures.mjs'

const { deepestContaining, RepositoryRegistry } = load('repositories')

const created = []
const directory = () => {
  const root = temporaryDirectory()
  created.push(root)
  return root
}
after(() => created.forEach(remove))

const folder = (root) => ({ uri: { scheme: 'file', fsPath: root } })
const describeRepository = (root) => ({ root, localExcludesFile: '', globalExcludesFile: '', indexFile: '' })

describe('deepestContaining', () => {
  const parent = describeRepository(path.resolve('/w', 'parent'))
  const child = describeRepository(path.resolve('/w', 'parent', 'child'))

  it('prefers the submodule over its parent, whatever the order', () => {
    const file = path.resolve('/w', 'parent', 'child', 'file')
    assert.equal(deepestContaining([parent, child], file), child)
    assert.equal(deepestContaining([child, parent], file), child)
  })

  it('does not match a sibling sharing a prefix', () => {
    assert.equal(deepestContaining([parent], path.resolve('/w', 'parent-2', 'file')), undefined)
  })
})

describe('RepositoryRegistry', () => {
  it('finds the workspace repository for a file inside it', async () => {
    const root = createRepository(directory())
    vscode.workspace.workspaceFolders = [folder(root)]
    const registry = new RepositoryRegistry()
    const repository = await registry.findContaining(path.join(root, 'src', 'a.ts'))
    assert.equal(repository.root, root)
    assert.equal(repository.localExcludesFile, path.join(root, '.git', 'info', 'exclude'))
    assert.equal(repository.indexFile, path.join(root, '.git', 'index'))
  })

  it('discovers a repository outside the workspace folders once', async () => {
    vscode.workspace.workspaceFolders = undefined
    const other = createRepository(directory())
    const file = write(other, 'a.ts')
    const registry = new RepositoryRegistry()
    const first = await registry.findContaining(file)
    assert.equal(first.root, other)
    assert.equal(await registry.findContaining(file), first)
  })

  it('answers undefined outside any repository', async () => {
    vscode.workspace.workspaceFolders = undefined
    const registry = new RepositoryRegistry()
    assert.equal(await registry.findContaining(path.join(directory(), 'a.ts')), undefined)
  })

  it('retries after a failed resolution instead of caching it', async () => {
    vscode.workspace.workspaceFolders = [folder(createRepository(directory()))]
    const registry = new RepositoryRegistry()
    await withoutGit(() => assert.rejects(registry.getAll(), /Could not run git/))
    assert.equal((await registry.getAll()).length, 1)
  })

  it('keeps the other repositories when a workspace folder no longer exists', async () => {
    const root = createRepository(directory())
    const gone = path.join(directory(), 'gone')
    vscode.workspace.workspaceFolders = [folder(gone), folder(root)]
    const failures = []
    const registry = new RepositoryRegistry((activity) => failures.push(activity))
    assert.deepEqual((await registry.getAll()).map((repository) => repository.root), [root])
    assert.deepEqual(failures, [`Resolving the workspace folder ${gone}`])
  })

  const commitNested = (parent, relativePath) => {
    const nested = createRepository(path.join(parent, relativePath))
    write(nested, 'f')
    git(nested, 'add', 'f')
    git(nested, 'commit', '-q', '-m', 'nested')
    git(parent, 'add', relativePath)
    git(parent, 'commit', '-q', '-m', 'parent')
    return nested
  }

  it('includes a nested repository the index knows about, without .gitmodules', async () => {
    const parent = createRepository(directory())
    const inner = commitNested(parent, path.join('libs', 'inner'))
    vscode.workspace.workspaceFolders = [folder(parent)]
    const roots = (await new RepositoryRegistry().getAll()).map((repository) => repository.root).sort()
    assert.deepEqual(roots, [inner, parent].sort())
  })

  it('skips a gitlink without a checkout, such as an uninitialised submodule', async () => {
    const parent = createRepository(directory())
    commitNested(parent, path.join('libs', 'inner'))
    const clone = path.join(directory(), 'clone')
    git(parent, 'clone', '-q', parent, clone)
    vscode.workspace.workspaceFolders = [folder(clone)]
    const failures = []
    const registry = new RepositoryRegistry((activity) => failures.push(activity))
    assert.deepEqual((await registry.getAll()).map((repository) => repository.root), [clone])
    assert.deepEqual(failures, [])
  })

  it('ignores .gitmodules on its own', async () => {
    const parent = createRepository(directory())
    write(parent, '.gitmodules', '[submodule "broken"\npath = x\n')
    vscode.workspace.workspaceFolders = [folder(parent)]
    assert.deepEqual((await new RepositoryRegistry().getAll()).map((repository) => repository.root), [parent])
  })
})
