import * as vscode from 'vscode'

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function counted(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

/**
 * Output channel with scan timings, so a slow explorer can be blamed on git,
 * the extension, or neither.
 */
export class ScanLog implements vscode.Disposable {
  private readonly channel: vscode.LogOutputChannel

  private batchCount = 0
  private pathCount = 0
  private totalMilliseconds = 0
  private slowestMilliseconds = 0

  constructor() {
    this.channel = vscode.window.createOutputChannel('Git Ignores & Excludes', { log: true })
  }

  dispose(): void {
    this.channel.dispose()
  }

  show(): void {
    this.channel.show()
  }

  recordBatch(repositoryName: string, pathCount: number, matchCount: number, milliseconds: number): void {
    this.batchCount++
    this.pathCount += pathCount
    this.totalMilliseconds += milliseconds
    this.slowestMilliseconds = Math.max(this.slowestMilliseconds, milliseconds)

    this.channel.debug(
      `Scanned ${counted(pathCount, 'path')} in ${repositoryName}: ${matchCount} ignored or excluded, ${formatDuration(milliseconds)}`
    )
  }

  recordRepositories(count: number, milliseconds: number): void {
    this.channel.info(
      `Resolved ${counted(count, 'repository', 'repositories')} in ${formatDuration(milliseconds)}`
    )
  }

  recordFailure(activity: string, error: unknown): void {
    this.channel.error(`${activity} failed: ${describeError(error)}`)
  }

  summarize(): void {
    if (this.batchCount === 0) {
      this.channel.info('No scans yet in this session.')
      return
    }
    const average = this.totalMilliseconds / this.batchCount
    this.channel.info(
      `Session total: ${counted(this.pathCount, 'path')} across ${counted(this.batchCount, 'batch', 'batches')}, ` +
      `${formatDuration(this.totalMilliseconds)} overall, ` +
      `${formatDuration(average)} average, ` +
      `${formatDuration(this.slowestMilliseconds)} slowest`
    )
  }
}

export function formatDuration(milliseconds: number): string {
  if (milliseconds < 1) {
    return 'under 1 ms'
  }
  if (milliseconds < 1000) {
    return `${Math.round(milliseconds)} ms`
  }
  const seconds = milliseconds / 1000
  return seconds < 10 ? `${seconds.toFixed(1)} s` : `${Math.round(seconds)} s`
}
