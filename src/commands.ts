import * as vscode from 'vscode'
import * as fs from 'fs/promises'
import * as path from 'path'
import { Repository, RepositoryRegistry } from './repositories'
import { addPatterns, removePatterns, toPattern } from './localExcludesFile'
import { findIgnoreMatches, resolveSymlinks } from './git'
import { counted, describeError, ScanLog } from './log'

export type CommandHandler = (clicked?: vscode.Uri, selection?: vscode.Uri[]) => Promise<void> | void

export interface CommandServices {
  repositories: RepositoryRegistry
  log: ScanLog
  excludesChanged: (repositoryRoot: string) => void
}

interface Targets {
  repository: Repository
  patterns: string[]
}

const OPEN_LOCAL_EXCLUDES = 'Open Local Excludes'

async function isDirectory(candidatePath: string): Promise<boolean> {
  try {
    return (await fs.stat(candidatePath)).isDirectory()
  } catch {
    return false
  }
}

/**
 * The explorer passes the clicked resource and the selection, and the selection
 * wins. The palette passes neither, so the open editor is used.
 */
function selectedFiles(clicked: vscode.Uri | undefined, selection: vscode.Uri[] | undefined): vscode.Uri[] {
  const chosen = selection && selection.length > 0 ? selection : clicked ? [clicked] : []
  const fromExplorer = chosen.filter((uri) => uri.scheme === 'file')
  if (fromExplorer.length > 0) {
    return fromExplorer
  }
  const activeDocument = vscode.window.activeTextEditor?.document.uri
  return activeDocument?.scheme === 'file' ? [activeDocument] : []
}

async function openFile(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.appendFile(filePath, '')
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath))
  await vscode.window.showTextDocument(document)
}

async function revealLine(filePath: string, zeroBasedLine: number): Promise<void> {
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(filePath))
  const editor = await vscode.window.showTextDocument(document)
  const position = new vscode.Position(Math.max(0, zeroBasedLine), 0)
  editor.selection = new vscode.Selection(position, position)
  editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter)
}

async function pickRepository(candidates: Repository[]): Promise<Repository | undefined> {
  const choice = await vscode.window.showQuickPick(
    candidates.map((repository) => ({
      label: path.basename(repository.root),
      description: repository.root,
      repository
    })),
    { placeHolder: 'Which repository?' }
  )
  return choice?.repository
}

/**
 * Files from another repository than the first one's are skipped, since their
 * pattern would land in the wrong excludes file.
 */
async function targetsOf(
  repositories: RepositoryRegistry,
  clicked: vscode.Uri | undefined,
  selection: vscode.Uri[] | undefined
): Promise<Targets | undefined> {
  const files = selectedFiles(clicked, selection)
  const [first] = files
  const repository = first && await repositories.findContaining(first.fsPath)
  if (!repository) {
    void vscode.window.showWarningMessage('Not inside a Git repository.')
    return undefined
  }

  const patterns: string[] = []
  for (const uri of files) {
    const absolutePath = resolveSymlinks(uri.fsPath)
    if (!absolutePath.startsWith(repository.root + path.sep)) {
      continue
    }
    try {
      patterns.push(toPattern(repository.root, absolutePath, await isDirectory(absolutePath)))
    } catch (error) {
      void vscode.window.showWarningMessage(describeError(error))
    }
  }
  return patterns.length > 0 ? { repository, patterns } : undefined
}

export function createCommands({ repositories, log, excludesChanged }: CommandServices): Record<string, CommandHandler> {
  return {
    'gie.addToLocalExcludes': async (clicked, selection) => {
      const targets = await targetsOf(repositories, clicked, selection)
      if (!targets) {
        return
      }
      const { repository, patterns } = targets
      const added = await addPatterns(repository.localExcludesFile, patterns)
      excludesChanged(repository.root)

      const message = added.length === 0
        ? 'Already in your local excludes.'
        : added.length === 1
          ? `Excluded ${added[0]} locally.`
          : `Excluded ${added.length} items locally.`
      const choice = await vscode.window.showInformationMessage(message, OPEN_LOCAL_EXCLUDES)
      if (choice !== undefined) {
        await openFile(repository.localExcludesFile)
      }
    },

    'gie.removeFromLocalExcludes': async (clicked, selection) => {
      const targets = await targetsOf(repositories, clicked, selection)
      if (!targets) {
        return
      }
      const { repository, patterns } = targets
      const { removed, unmatched } = await removePatterns(repository.localExcludesFile, patterns)
      excludesChanged(repository.root)

      if (unmatched.length === 0) {
        void vscode.window.showInformationMessage(
          removed.length === 1
            ? `Removed ${removed[0]} from your local excludes.`
            : `Removed ${removed.length} entries from your local excludes.`
        )
        return
      }

      // A file with no entry of its own is covered by a broader pattern, or by
      // none. Either way the user decides.
      const [first, ...rest] = unmatched
      const summary = removed.length > 0
        ? `Removed ${removed.length}. No exact entry for ${counted(unmatched.length, 'other')}, which a broader pattern may cover.`
        : first !== undefined && rest.length === 0
          ? `No exact entry for ${first}. A broader pattern may cover it.`
          : `No exact entry for ${counted(unmatched.length, 'file')}. A broader pattern may cover them.`
      const choice = await vscode.window.showWarningMessage(summary, OPEN_LOCAL_EXCLUDES)
      if (choice !== undefined) {
        await openFile(repository.localExcludesFile)
      }
    },

    'gie.openLocalExcludes': async () => {
      const all = await repositories.getAll()
      if (all.length === 0) {
        void vscode.window.showWarningMessage('No Git repository in this workspace.')
        return
      }
      const repository = all.length === 1 ? all[0] : await pickRepository(all)
      if (repository) {
        await openFile(repository.localExcludesFile)
      }
    },

    'gie.explainIgnore': async (clicked, selection) => {
      const [target] = selectedFiles(clicked, selection)
      if (!target) {
        return
      }
      const repository = await repositories.findContaining(target.fsPath)
      if (!repository) {
        return
      }

      const absolutePath = path.resolve(target.fsPath)
      const matches = await findIgnoreMatches(
        repository.root,
        [absolutePath],
        repository.localExcludesFile,
        repository.globalExcludesFile
      )
      const match = matches.get(absolutePath)
      if (!match) {
        void vscode.window.showInformationMessage('Git is not ignoring or excluding this file.')
        return
      }
      await revealLine(path.resolve(repository.root, match.sourceFile), match.lineNumber - 1)
    },

    'gie.showScanTimings': () => {
      log.summarize()
      log.show()
    }
  }
}
