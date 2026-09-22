import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { symlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { load } from './load.mjs'
import { createRepository, git, remove, temporaryDirectory, withoutGit, write } from './fixtures.mjs'

const {
  findRepositoryRoot,
  findLocalExcludesFile,
  findGlobalExcludesFile,
  findIgnoreMatches,
  findGitlinkPaths,
  findIndexFile,
  resolveSymlinks
} = load('git')

const created = []
const repository = () => {
  const root = createRepository()
  created.push(root)
  return root
}
after(() => created.forEach(remove))

describe('resolveSymlinks', () => {
  it('follows a symlink and passes a missing path through', () => {
    const root = temporaryDirectory()
    created.push(root)
    const target = write(root, 'real/file')
    symlinkSync(path.join(root, 'real'), path.join(root, 'link'))
    assert.equal(resolveSymlinks(path.join(root, 'link', 'file')), target)
    assert.equal(resolveSymlinks(path.join(root, 'missing')), path.join(root, 'missing'))
  })
})

describe('findRepositoryRoot', () => {
  it('answers with the root from a subdirectory', async () => {
    const root = repository()
    write(root, 'src/a.ts')
    assert.equal(await findRepositoryRoot(path.join(root, 'src')), root)
  })

  it('answers the same root through a symlink as through the real path', async () => {
    const root = repository()
    const link = path.join(temporaryDirectory(), 'link')
    created.push(path.dirname(link))
    symlinkSync(root, link)
    assert.equal(await findRepositoryRoot(link), root)
  })

  it('answers undefined outside a repository', async () => {
    const directory = temporaryDirectory()
    created.push(directory)
    assert.equal(await findRepositoryRoot(directory), undefined)
  })

  it('throws when git cannot run', async () => {
    const root = repository()
    await withoutGit(() => assert.rejects(findRepositoryRoot(root), /Could not run git/))
  })
})

describe('findLocalExcludesFile', () => {
  it('is .git/info/exclude', async () => {
    const root = repository()
    assert.equal(await findLocalExcludesFile(root), path.join(root, '.git', 'info', 'exclude'))
  })

  it('is the main repository file for a linked worktree', async () => {
    const root = repository()
    git(root, 'commit', '-q', '--allow-empty', '-m', 'init')
    const worktree = path.join(temporaryDirectory(), 'worktree')
    created.push(path.dirname(worktree))
    git(root, 'worktree', 'add', '-q', worktree)
    assert.equal(await findLocalExcludesFile(worktree), path.join(root, '.git', 'info', 'exclude'))
  })
})

describe('findIndexFile', () => {
  it('is .git/index', async () => {
    const root = repository()
    assert.equal(await findIndexFile(root), path.join(root, '.git', 'index'))
  })

  it('is the worktree-specific index for a linked worktree', async () => {
    const root = repository()
    git(root, 'commit', '-q', '--allow-empty', '-m', 'init')
    const worktree = path.join(temporaryDirectory(), 'worktree')
    created.push(path.dirname(worktree))
    git(root, 'worktree', 'add', '-q', worktree)
    assert.equal(await findIndexFile(worktree), path.join(root, '.git', 'worktrees', 'worktree', 'index'))
  })
})

describe('findGlobalExcludesFile', () => {
  it('expands a tilde in core.excludesFile', async () => {
    const root = repository()
    git(root, 'config', 'core.excludesFile', '~/my-ignores')
    assert.equal(await findGlobalExcludesFile(root), path.join(homedir(), 'my-ignores'))
  })

  it('falls back to the XDG location when nothing is configured', async () => {
    const root = repository()
    const saved = process.env.XDG_CONFIG_HOME
    try {
      process.env.XDG_CONFIG_HOME = path.resolve('/xdg')
      assert.equal(await findGlobalExcludesFile(root), path.resolve('/xdg', 'git', 'ignore'))
      delete process.env.XDG_CONFIG_HOME
      assert.equal(await findGlobalExcludesFile(root), path.join(homedir(), '.config', 'git', 'ignore'))
    } finally {
      if (saved !== undefined) {
        process.env.XDG_CONFIG_HOME = saved
      }
    }
  })
})

describe('findIgnoreMatches', () => {
  const root = repository()
  const globalExcludes = write(temporaryDirectory(), 'ignore', '*.tmp\n')
  created.push(path.dirname(globalExcludes))
  git(root, 'config', 'core.excludesFile', globalExcludes)
  const localExcludes = write(root, '.git/info/exclude', '# comment\n/notes.md\n')
  write(root, '.gitignore', '*.log\n!rescued.log\n')
  write(root, 'src/.gitignore', 'generated/\n')
  const files = {
    log: write(root, 'a.log'),
    notes: write(root, 'notes.md'),
    temporary: write(root, 'b.tmp'),
    generated: write(root, 'src/generated/x.js'),
    kept: write(root, 'kept.ts'),
    oddName: write(root, 'odd\nname.log'),
    rescued: write(root, 'rescued.log'),
    tracked: write(root, 'tracked.log')
  }
  git(root, 'add', '-f', 'tracked.log')
  git(root, 'commit', '-q', '-m', 'track a file matching a pattern')
  const ask = (paths) => findIgnoreMatches(root, paths, localExcludes, globalExcludes)

  it('classifies each file by the source git blames', async () => {
    const matches = await ask(Object.values(files))
    assert.deepEqual(matches.get(files.log), { source: 'repositoryIgnores', sourceFile: '.gitignore', lineNumber: 1, pattern: '*.log' })
    assert.deepEqual(matches.get(files.notes), { source: 'localExcludes', sourceFile: '.git/info/exclude', lineNumber: 2, pattern: '/notes.md' })
    assert.deepEqual(matches.get(files.temporary), { source: 'globalExcludes', sourceFile: globalExcludes, lineNumber: 1, pattern: '*.tmp' })
    assert.deepEqual(matches.get(files.generated), { source: 'repositoryIgnores', sourceFile: 'src/.gitignore', lineNumber: 1, pattern: 'generated/' })
    assert.equal(matches.get(files.kept), undefined)
  })

  it('does not report a path rescued by a negated pattern', async () => {
    const matches = await ask([files.rescued, files.log])
    assert.equal(matches.get(files.rescued), undefined)
    assert.equal(matches.get(files.log)?.pattern, '*.log')
  })

  it('does not report a tracked file matching a pattern', async () => {
    const matches = await ask([files.tracked, files.log])
    assert.equal(matches.get(files.tracked), undefined)
    assert.equal(matches.get(files.log)?.pattern, '*.log')
  })

  it('rejects cleanly when git quits before reading a large batch', async () => {
    // More than a pipe buffer, so the write is still pending when git exits.
    const outside = temporaryDirectory()
    created.push(outside)
    const paths = Array.from({ length: 5000 }, (_, index) => path.join(outside, `${'x'.repeat(80)}-${index}.log`))
    await assert.rejects(ask(paths), /outside repository/)
  })

  it('survives a line break in a file name', async () => {
    const matches = await ask([files.oddName, files.kept])
    assert.equal(matches.get(files.oddName)?.pattern, '*.log')
    assert.equal(matches.size, 1)
  })

  it('answers an empty batch without running git', async () => {
    await withoutGit(async () => assert.deepEqual(await ask([]), new Map()))
  })
})

describe('findGitlinkPaths', () => {
  it('lists nested repositories in the index, declared as submodules or not', async () => {
    const root = repository()
    write(root, 'tracked.txt')
    const nested = createRepository(path.join(root, 'libs', 'nested'))
    write(nested, 'f')
    git(nested, 'add', 'f')
    git(nested, 'commit', '-q', '-m', 'n')
    git(root, 'add', 'tracked.txt', 'libs/nested')
    assert.deepEqual(await findGitlinkPaths(root), [nested])
  })

  it('is empty without gitlinks', async () => {
    const root = repository()
    write(root, 'tracked.txt')
    git(root, 'add', 'tracked.txt')
    assert.deepEqual(await findGitlinkPaths(root), [])
  })
})
