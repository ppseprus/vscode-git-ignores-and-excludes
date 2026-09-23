import { execFile } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import {
  CHECK_IGNORE_FIELDS_PER_RECORD,
  GIT_EXIT_NO_MATCH,
  GIT_OUTPUT_BUFFER_BYTES
} from './constants'

/**
 * Excludes are never committed, ignores are. Local excludes live in
 * `.git/info/exclude`, global ones wherever `core.excludesFile` points.
 */
export type IgnoreSource = 'localExcludes' | 'globalExcludes' | 'repositoryIgnores'

export interface IgnoreMatch {
  source: IgnoreSource
  // As git reports it: repository-relative for local files, absolute for the
  // global excludes file.
  sourceFile: string
  lineNumber: number
  pattern: string
}

/** The mode `git ls-files --stage` prints for a gitlink. */
const GITLINK_MODE = '160000 '

let gitExecutable = 'git'

/**
 * Follows VS Code's `git.path`: a path or a list of paths, the first that
 * exists wins, and none means git from `PATH`.
 */
export function useGitExecutable(candidates: string | string[] | undefined): void {
  const paths = typeof candidates === 'string' ? [candidates] : (candidates ?? [])
  gitExecutable = paths.find((candidate) => candidate !== '' && fs.existsSync(candidate)) ?? 'git'
}

/**
 * Git ran and refused. Git being missing or its output truncated is a plain
 * Error, so a caller can take "no" for an answer without swallowing the rest.
 */
export class GitExitError extends Error {
  constructor(readonly exitStatus: number, message: string) {
    super(message)
    this.name = 'GitExitError'
  }
}

/**
 * Exit status 1 resolves, since `check-ignore` and `config --get` use it for
 * "nothing found".
 */
function runGit(workingDirectory: string, gitArguments: string[], standardInput?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      gitExecutable,
      gitArguments,
      { cwd: workingDirectory, maxBuffer: GIT_OUTPUT_BUFFER_BYTES, windowsHide: true },
      (error, standardOutput: string, standardError: string) => {
        if (!error || error.code === GIT_EXIT_NO_MATCH) {
          resolve(standardOutput)
        } else if (typeof error.code === 'number') {
          const detail = standardError.trim()
          reject(new GitExitError(error.code, detail === '' ? error.message : detail))
        } else {
          reject(new Error(`Could not run git: ${error.message}`, { cause: error }))
        }
      }
    )
    // Git may exit before reading all of its input, and the write would
    // otherwise raise an unhandled EPIPE. The callback reports the exit.
    child.stdin?.on('error', () => undefined)
    child.stdin?.end(standardInput)
  })
}

/**
 * Git reports roots with symlinks resolved, the editor hands over whatever was
 * opened. A path that does not exist is used as given.
 */
export function resolveSymlinks(candidatePath: string): string {
  try {
    return fs.realpathSync.native(candidatePath)
  } catch {
    return path.resolve(candidatePath)
  }
}

/**
 * The root goes through the same resolution as every file path, so slashes,
 * drive letter case and symlinks compare equal on every platform.
 */
export async function findRepositoryRoot(directory: string): Promise<string | undefined> {
  try {
    const root = (await runGit(directory, ['rev-parse', '--show-toplevel'])).trim()
    return root === '' ? undefined : resolveSymlinks(root)
  } catch (error) {
    if (error instanceof GitExitError) {
      return undefined
    }
    throw error
  }
}

/**
 * `--git-common-dir` because `info/exclude` is shared: a linked worktree reads
 * its main repository's file.
 */
export async function findLocalExcludesFile(repositoryRoot: string): Promise<string> {
  const output = await runGit(repositoryRoot, ['rev-parse', '--git-common-dir'])
  return path.join(path.resolve(repositoryRoot, output.trim()), 'info', 'exclude')
}

/**
 * `--git-dir` rather than the common dir, since a linked worktree has an index
 * of its own.
 */
export async function findIndexFile(repositoryRoot: string): Promise<string> {
  const output = await runGit(repositoryRoot, ['rev-parse', '--git-dir'])
  return path.join(path.resolve(repositoryRoot, output.trim()), 'index')
}

function expandHomeDirectory(candidate: string): string {
  if (candidate === '~') {
    return os.homedir()
  }
  if (candidate.startsWith('~/')) {
    return path.join(os.homedir(), candidate.slice(2))
  }
  return candidate
}

/**
 * Git expands a tilde in `core.excludesFile`, Node does not. An unset key exits
 * with 1, which `runGit` reports as empty.
 */
export async function findGlobalExcludesFile(repositoryRoot: string): Promise<string> {
  const configured = (await runGit(repositoryRoot, ['config', '--get', 'core.excludesFile'])).trim()
  if (configured !== '') {
    return path.resolve(expandHomeDirectory(configured))
  }
  const xdgConfigHome = process.env.XDG_CONFIG_HOME ?? ''
  return xdgConfigHome === ''
    ? path.join(os.homedir(), '.config', 'git', 'ignore')
    : path.join(xdgConfigHome, 'git', 'ignore')
}

function identifySource(
  sourceFile: string,
  repositoryRoot: string,
  localExcludesFile: string,
  globalExcludesFile: string
): IgnoreSource {
  const normalize = (candidate: string) => path.resolve(repositoryRoot, candidate).toLowerCase()
  const normalizedSource = normalize(sourceFile)

  if (normalizedSource === normalize(localExcludesFile)) {
    return 'localExcludes'
  }
  if (normalizedSource === normalize(globalExcludesFile)) {
    return 'globalExcludes'
  }
  return 'repositoryIgnores'
}

/**
 * One git call for the whole batch. Git already implements precedence, negation
 * and nested files, so nothing here parses ignore files.
 */
export async function findIgnoreMatches(
  repositoryRoot: string,
  absolutePaths: string[],
  localExcludesFile: string,
  globalExcludesFile: string
): Promise<Map<string, IgnoreMatch>> {
  const matches = new Map<string, IgnoreMatch>()
  if (absolutePaths.length === 0) {
    return matches
  }

  // NUL framing because a path may contain a newline. The index stays in play so
  // a tracked file matching a pattern is not reported, since git does not ignore it.
  const standardInput = absolutePaths.join('\0') + '\0'
  const output = await runGit(
    repositoryRoot,
    ['check-ignore', '--verbose', '-z', '--stdin'],
    standardInput
  )
  if (output === '') {
    return matches
  }

  const fields = output.split('\0')
  for (let index = 0; index + CHECK_IGNORE_FIELDS_PER_RECORD <= fields.length; index += CHECK_IGNORE_FIELDS_PER_RECORD) {
    const [sourceFile = '', line = '', pattern = '', matchedPath = ''] = fields.slice(index, index + CHECK_IGNORE_FIELDS_PER_RECORD)
    if (sourceFile === '' || matchedPath === '') {
      continue
    }
    // Verbose output also names the negation that rescued a path from an
    // earlier pattern, which means the path is not ignored.
    if (pattern.startsWith('!')) {
      continue
    }
    const lineNumber = Number(line)
    matches.set(path.resolve(repositoryRoot, matchedPath), {
      source: identifySource(sourceFile, repositoryRoot, localExcludesFile, globalExcludesFile),
      sourceFile,
      lineNumber: Number.isFinite(lineNumber) ? lineNumber : 0,
      pattern
    })
  }
  return matches
}

/**
 * Every nested repository the index knows about, declared in `.gitmodules` or
 * not. These are the paths `check-ignore` refuses to look inside, so the
 * index is the authority rather than `.gitmodules`. Each record is
 * `mode SP object SP stage TAB path`.
 */
export async function findGitlinkPaths(repositoryRoot: string): Promise<string[]> {
  const output = await runGit(repositoryRoot, ['ls-files', '-z', '--stage'])
  return output
    .split('\0')
    .filter((record) => record.startsWith(GITLINK_MODE))
    .map((record) => record.slice(record.indexOf('\t') + 1))
    .map((relativePath) => path.join(repositoryRoot, relativePath))
}
