import * as vscode from 'vscode'
import * as path from 'path'
import * as fs from 'fs'
import {
  findRepositoryRoot,
  findLocalExcludesFile,
  findGlobalExcludesFile,
  findGitlinkPaths,
  findIndexFile,
  resolveSymlinks
} from './git'

export interface Repository {
  root: string
  localExcludesFile: string
  globalExcludesFile: string
  // Where git records what is tracked, and so what it no longer ignores.
  indexFile: string
}

function isInsideRoot(absolutePath: string, root: string): boolean {
  return absolutePath === root || absolutePath.startsWith(root + path.sep)
}

/** The deepest root, so a submodule wins over its parent. */
export function deepestContaining(repositories: Repository[], resolvedPath: string): Repository | undefined {
  let deepest: Repository | undefined
  for (const repository of repositories) {
    if (isInsideRoot(resolvedPath, repository.root) && repository.root.length > (deepest?.root.length ?? -1)) {
      deepest = repository
    }
  }
  return deepest
}

export class RepositoryRegistry implements vscode.Disposable {
  private cached: Promise<Repository[]> | undefined
  // Repositories outside the workspace folders, found through a file inside them.
  private readonly discovered = new Map<string, Repository>()

  constructor(private readonly reportFailure: (activity: string, error: unknown) => void = () => undefined) { }

  dispose(): void {
    this.invalidate()
  }

  invalidate(): void {
    this.cached = undefined
    this.discovered.clear()
  }

  getAll(): Promise<Repository[]> {
    if (!this.cached) {
      const resolution = this.resolveWorkspaceRepositories()
      // A failure is not kept, so the next request asks git again.
      void resolution.catch(() => {
        if (this.cached === resolution) {
          this.cached = undefined
        }
      })
      this.cached = resolution
    }
    return this.cached
  }

  async findContaining(candidatePath: string): Promise<Repository | undefined> {
    const resolvedPath = resolveSymlinks(candidatePath)
    const known = deepestContaining(await this.getAll(), resolvedPath)
    if (known) {
      return known
    }

    const discovered = [...this.discovered.values()].find((repository) => isInsideRoot(resolvedPath, repository.root))
    if (discovered) {
      return discovered
    }
    const root = await findRepositoryRoot(path.dirname(resolvedPath))
    if (root === undefined) {
      return undefined
    }
    const repository = this.discovered.get(root) ?? await this.describe(root)
    this.discovered.set(root, repository)
    return repository
  }

  private async describe(root: string): Promise<Repository> {
    const [localExcludesFile, globalExcludesFile, indexFile] = await Promise.all([
      findLocalExcludesFile(root),
      findGlobalExcludesFile(root),
      findIndexFile(root)
    ])
    return { root, localExcludesFile, globalExcludesFile, indexFile }
  }

  // A folder that no longer exists on disk is logged and skipped. Spawning git
  // there fails the same way as git being missing, which must still reject.
  private async resolveWorkspaceRepositories(): Promise<Repository[]> {
    const folders = (vscode.workspace.workspaceFolders ?? [])
      .filter((folder) => folder.uri.scheme === 'file')
      .filter((folder) => {
        if (fs.existsSync(folder.uri.fsPath)) {
          return true
        }
        this.reportFailure(`Resolving the workspace folder ${folder.uri.fsPath}`, new Error('The folder does not exist.'))
        return false
      })
    const roots = (await Promise.all(folders.map((folder) => findRepositoryRoot(folder.uri.fsPath))))
      .filter((root) => root !== undefined)
    const nestedRoots = (await Promise.all(roots.map((root) => nestedRootsOf(root)))).flat()
    const uniqueRoots = new Set([...roots, ...nestedRoots])
    return Promise.all([...uniqueRoots].map((root) => this.describe(root)))
  }
}

/**
 * A gitlink with a checkout is a repository of its own. One without, such as
 * a submodule never initialised, has no files to decorate and is skipped.
 */
async function nestedRootsOf(root: string): Promise<string[]> {
  const gitlinkPaths = await findGitlinkPaths(root)
  return gitlinkPaths
    .filter((gitlinkPath) => fs.existsSync(path.join(gitlinkPath, '.git')))
    .map(resolveSymlinks)
}
