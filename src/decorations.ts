import * as vscode from 'vscode'
import * as path from 'path'
import { setTimeout as delay } from 'timers/promises'
import { findIgnoreMatches, IgnoreMatch, IgnoreSource, resolveSymlinks } from './git'
import { Repository, deepestContaining } from './repositories'
import {
  CONFIGURATION_SECTION,
  DECORATION_BATCH_COOLDOWN_MS,
  DECORATION_BATCH_WINDOW_MS,
  MAX_BADGE_LENGTH,
  TOOLTIP_ROW_BREAK
} from './constants'
import { ScanLog } from './log'

/** Null means git was asked and nothing matched. */
type Matches = Map<string, IgnoreMatch | null>

const BADGE_SETTING: Record<IgnoreSource, string> = {
  localExcludes: 'badges.localExcludes',
  globalExcludes: 'badges.globalExcludes',
  repositoryIgnores: 'badges.repositoryIgnores'
}

/**
 * Only local excludes are badged by default: a committed rule is expected, a
 * global one is the user's own standing choice.
 */
const DEFAULT_BADGE: Record<IgnoreSource, string> = {
  // Reference mark (U+203B), the Japanese note marker. See the README for why.
  localExcludes: '※',
  globalExcludes: '',
  repositoryIgnores: ''
}

const THEME_COLOR: Record<IgnoreSource, string> = {
  localExcludes: 'gitIgnoresAndExcludes.localExcludesForeground',
  globalExcludes: 'gitIgnoresAndExcludes.globalExcludesForeground',
  repositoryIgnores: 'gitIgnoresAndExcludes.repositoryIgnoresForeground'
}

/** Git's own vocabulary: `.gitignore` ignores, the exclude files exclude. */
const SOURCE_VERB: Record<IgnoreSource, string> = {
  localExcludes: 'Excluded',
  globalExcludes: 'Excluded',
  repositoryIgnores: 'Ignored'
}

const SOURCE_SCOPE: Record<IgnoreSource, string> = {
  localExcludes: 'Not committed',
  globalExcludes: 'Not committed, applies to all your repositories',
  repositoryIgnores: 'Committed and shared'
}

export class IgnoreDecorationProvider implements vscode.FileDecorationProvider, vscode.Disposable {
  private readonly changeEmitter = new vscode.EventEmitter<vscode.Uri[] | undefined>()
  readonly onDidChangeFileDecorations = this.changeEmitter.event

  private readonly resolved: Matches = new Map()
  private readonly pending = new Set<string>()
  // Every row waiting for the next batch awaits this same promise.
  private nextBatch: Promise<Matches> | undefined
  // The batch whose git call is running. The next one waits for it, then a
  // cooldown.
  private inFlight: Promise<Matches> | undefined
  private disposed = false

  constructor(
    private readonly listRepositories: () => Promise<Repository[]>,
    private readonly log: ScanLog
  ) { }

  dispose(): void {
    this.disposed = true
    this.changeEmitter.dispose()
  }

  /**
   * For when the rules may have changed: forgets what git said and asks again.
   */
  invalidate(): void {
    this.resolved.clear()
    this.changeEmitter.fire(undefined)
  }

  /**
   * For when only the badge or color settings changed: redraws with what git
   * already said.
   */
  repaint(): void {
    this.changeEmitter.fire(undefined)
  }

  async provideFileDecoration(
    uri: vscode.Uri,
    token: vscode.CancellationToken
  ): Promise<vscode.FileDecoration | undefined> {
    if (uri.scheme !== 'file') {
      return undefined
    }
    const absolutePath = path.resolve(uri.fsPath)

    let match = this.resolved.get(absolutePath)
    if (match === undefined) {
      match = await this.enqueue(absolutePath)
    }
    if (token.isCancellationRequested || !match) {
      return undefined
    }

    const configuration = vscode.workspace.getConfiguration(CONFIGURATION_SECTION)
    const badgesEnabled = configuration.get<boolean>('badges.enabled', true)
    const configuredBadge = configuration.get<string>(
      BADGE_SETTING[match.source],
      DEFAULT_BADGE[match.source]
    )
    const badge = (configuredBadge ?? '').slice(0, MAX_BADGE_LENGTH)

    // VS Code prepends `path • ` to the tooltip, so it opens with the verb. The
    // source file and line are the only way to tell nested `.gitignore` files apart.
    const rows = [
      SOURCE_VERB[match.source],
      `${match.sourceFile}:${match.lineNumber}, "${match.pattern}"`,
      SOURCE_SCOPE[match.source]
    ]
    const tooltip = rows.join(TOOLTIP_ROW_BREAK)

    return {
      badge: badgesEnabled && badge.length > 0 ? badge : undefined,
      tooltip,
      color: new vscode.ThemeColor(THEME_COLOR[match.source]),
      propagate: false
    }
  }

  private async enqueue(absolutePath: string): Promise<IgnoreMatch | null> {
    this.pending.add(absolutePath)
    this.nextBatch ??= this.runNextBatch()
    return (await this.nextBatch).get(absolutePath) ?? null
  }

  /**
   * Requests arriving while git runs join the batch after it, so a scrolling
   * tree does not spawn git per handful of rows.
   */
  private async runNextBatch(): Promise<Matches> {
    await (this.inFlight
      ? this.inFlight.then(() => delay(DECORATION_BATCH_COOLDOWN_MS))
      : delay(DECORATION_BATCH_WINDOW_MS))
    this.nextBatch = undefined
    const paths = [...this.pending]
    this.pending.clear()
    if (this.disposed) {
      return new Map()
    }

    const batch = this.resolveBatch(paths)
    this.inFlight = batch
    try {
      return await batch
    } finally {
      if (this.inFlight === batch) {
        this.inFlight = undefined
      }
    }
  }

  /**
   * Owns scan failures: logged, and the paths involved are left out of the
   * cache so they are asked about again.
   */
  private async resolveBatch(paths: string[]): Promise<Matches> {
    const results: Matches = new Map()
    const remember = (absolutePath: string, match: IgnoreMatch | null) => {
      this.resolved.set(absolutePath, match)
      results.set(absolutePath, match)
    }

    let repositories: Repository[]
    try {
      repositories = await this.listRepositories()
    } catch (error) {
      this.log.recordFailure('Resolving the workspace repositories', error)
      return results
    }

    const grouped = new Map<Repository, string[]>()
    for (const absolutePath of paths) {
      const repository = deepestContaining(repositories, resolveSymlinks(absolutePath))
      if (!repository) {
        remember(absolutePath, null)
        continue
      }
      const repositoryPaths = grouped.get(repository) ?? []
      repositoryPaths.push(absolutePath)
      grouped.set(repository, repositoryPaths)
    }

    await Promise.all([...grouped].map(async ([repository, repositoryPaths]) => {
      const name = path.basename(repository.root)
      const startedAt = Date.now()
      try {
        const matches = await findIgnoreMatches(
          repository.root,
          repositoryPaths,
          repository.localExcludesFile,
          repository.globalExcludesFile
        )
        for (const absolutePath of repositoryPaths) {
          remember(absolutePath, matches.get(absolutePath) ?? null)
        }
        this.log.recordBatch(name, repositoryPaths.length, matches.size, Date.now() - startedAt)
      } catch (error) {
        this.log.recordFailure(`Scanning ${name}`, error)
      }
    }))
    return results
  }
}
