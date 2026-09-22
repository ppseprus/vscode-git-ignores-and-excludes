import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * Git answers with symlinks resolved, and the macOS temp directory is one.
 * */
export const temporaryDirectory = (prefix = 'gie-') => realpathSync(mkdtempSync(path.join(tmpdir(), prefix)))

// Keeps the user's own git configuration out of the tests.
process.env.GIT_CONFIG_GLOBAL = path.join(temporaryDirectory(), 'gitconfig')
process.env.GIT_CONFIG_NOSYSTEM = '1'

export const git = (cwd, ...args) =>
  execFileSync(
    'git',
    ['-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'advice.addEmbeddedRepo=false', ...args],
    { cwd, encoding: 'utf8' }
  )

export function createRepository(root = temporaryDirectory()) {
  mkdirSync(root, { recursive: true })
  git(root, 'init', '-q')
  return root
}

export function write(root, relativePath, content = '') {
  const filePath = path.join(root, relativePath)
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, content)
  return filePath
}

export const remove = (directory) => rmSync(directory, { recursive: true, force: true })

export async function withoutGit(action) {
  const savedPath = process.env.PATH
  process.env.PATH = ''
  try {
    return await action()
  } finally {
    process.env.PATH = savedPath
  }
}
