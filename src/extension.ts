import * as vscode from 'vscode'
import * as path from 'path'
import { RepositoryRegistry } from './repositories'
import { IgnoreDecorationProvider } from './decorations'
import { CommandHandler, createCommands } from './commands'
import { describeError, ScanLog } from './log'
import { CONFIGURATION_SECTION } from './constants'
import { useGitExecutable } from './git'

export function activate(context: vscode.ExtensionContext): void {
  const followGitPath = () => useGitExecutable(vscode.workspace.getConfiguration('git').get<string | string[]>('path'))
  followGitPath()

  const log = new ScanLog()
  const repositories = new RepositoryRegistry((activity, error) => log.recordFailure(activity, error))
  let firstResolutionLogged = false
  const decorations = new IgnoreDecorationProvider(async () => {
    const startedAt = Date.now()
    const known = await repositories.getAll()
    if (!firstResolutionLogged) {
      firstResolutionLogged = true
      log.recordRepositories(known.length, Date.now() - startedAt)
    }
    return known
  }, log)

  context.subscriptions.push(
    repositories,
    log,
    decorations,
    vscode.window.registerFileDecorationProvider(decorations)
  )

  // Owns the failure of a task nobody awaits.
  const inBackground = (activity: string, task: () => Promise<void>) => {
    task().catch((error: unknown) => log.recordFailure(activity, error))
  }

  const refreshDecorations = () => decorations.invalidate()

  // The Git extension does not watch `.git/info/exclude`, and its stale
  // decoration wins until it refreshes.
  const refreshAfterExcludesChange = (repositoryRoot: string) => {
    refreshDecorations()
    void vscode.commands
      .executeCommand('git.refresh', vscode.Uri.file(repositoryRoot))
      .then(undefined, () => undefined)
  }

  // The explorer fires no event before opening its context menu, so a per-file
  // context key would be stale.
  const updateRepositoryContext = async () => {
    const known = await repositories.getAll()
    await vscode.commands.executeCommand('setContext', 'gie.inRepository', known.length > 0)
  }

  const watchers: vscode.FileSystemWatcher[] = []
  const watch = (pattern: vscode.RelativePattern, onChange: () => void) => {
    const watcher = vscode.workspace.createFileSystemWatcher(pattern)
    watcher.onDidChange(onChange)
    watcher.onDidCreate(onChange)
    watcher.onDidDelete(onChange)
    watchers.push(watcher)
    context.subscriptions.push(watcher)
  }
  const watchFile = (filePath: string, onChange: () => void) =>
    watch(new vscode.RelativePattern(path.dirname(filePath), path.basename(filePath)), onChange)

  // Only the latest arming survives, so two workspace changes in quick
  // succession do not leave duplicate watchers behind.
  let armingGeneration = 0
  const armWatchers = async () => {
    const generation = ++armingGeneration
    const known = await repositories.getAll()
    if (generation !== armingGeneration) {
      return
    }
    for (const watcher of watchers.splice(0)) {
      watcher.dispose()
    }
    for (const repository of known) {
      watch(new vscode.RelativePattern(repository.root, '**/.gitignore'), refreshDecorations)
      watchFile(repository.localExcludesFile, () => refreshAfterExcludesChange(repository.root))
      watchFile(repository.globalExcludesFile, refreshDecorations)
      // Tracking a file is what stops git ignoring it.
      watchFile(repository.indexFile, refreshDecorations)
    }
  }

  const followWorkspace = () => {
    inBackground('Updating the repository context', updateRepositoryContext)
    inBackground('Watching the ignore files', armWatchers)
  }
  followWorkspace()

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('git.path')) {
        followGitPath()
        repositories.invalidate()
        followWorkspace()
        refreshDecorations()
      }
      if (
        event.affectsConfiguration(CONFIGURATION_SECTION) ||
        event.affectsConfiguration('workbench.colorCustomizations')
      ) {
        decorations.repaint()
      }
    }),
    vscode.window.onDidChangeActiveColorTheme(() => decorations.repaint()),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      repositories.invalidate()
      followWorkspace()
      refreshDecorations()
    })
  )

  // Owns a command's failure: the user asked for it, so they hear about it.
  const registerCommand = (id: string, handler: CommandHandler) =>
    vscode.commands.registerCommand(id, async (clicked?: vscode.Uri, selection?: vscode.Uri[]) => {
      try {
        await handler(clicked, selection)
      } catch (error) {
        log.recordFailure(`Command ${id}`, error)
        void vscode.window.showErrorMessage(describeError(error))
      }
    })
  const commands = createCommands({ repositories, log, excludesChanged: refreshAfterExcludesChange })
  context.subscriptions.push(...Object.entries(commands).map(([id, handler]) => registerCommand(id, handler)))
}

export function deactivate(): void { }
