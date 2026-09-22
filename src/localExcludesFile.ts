import * as fs from 'fs/promises'
import * as path from 'path'

const ENCODING = 'utf8'
const GLOB_METACHARACTER = /[\\*?[\]]/g
const TRAILING_SPACES = / +$/
const CRLF = /\r\n/g
const LONE_LF = /(?<!\r)\n/g
const ANY_LINE_BREAK = /\r?\n/
/** The capture group keeps the separators in the split result. */
const ANY_LINE_BREAK_KEPT = /(\r?\n)/
const TRAILING_LINE_BREAK = /\r?\n$/

/**
 * C0 controls and DEL are legal in POSIX filenames but cannot survive as one
 * line of an ignore file.
 */
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const codePoint = value.charCodeAt(index)
    if (codePoint < 0x20 || codePoint === 0x7f) {
      return true
    }
  }
  return false
}

function escapeSegment(segment: string): string {
  return segment.replace(GLOB_METACHARACTER, '\\$&')
}

/**
 * Anchored at the root: `build` matches at any depth, `/build` only the one
 * clicked. A directory gets a trailing slash so a same-named file beside it
 * stays visible.
 */
export function toPattern(repositoryRoot: string, absolutePath: string, isDirectory: boolean): string {
  const relativePath = path.relative(repositoryRoot, absolutePath).split(path.sep).join('/')

  if (relativePath === '' || relativePath === '..' || relativePath.startsWith('../') || path.isAbsolute(relativePath)) {
    throw new Error('A path outside the repository cannot be excluded.')
  }
  if (hasControlCharacter(relativePath)) {
    throw new Error('A file name with a control character cannot be written as a pattern.')
  }

  const segments = relativePath.split('/').filter((segment) => segment.length > 0)
  let pattern = '/' + segments.map(escapeSegment).join('/')
  // Git strips trailing spaces unless each one is escaped.
  pattern = pattern.replace(TRAILING_SPACES, (spaces) => spaces.replaceAll(' ', '\\ '))

  return isDirectory ? pattern + '/' : pattern
}

function detectLineEnding(content: string): string {
  const carriageReturnCount = (content.match(CRLF) ?? []).length
  const lineFeedCount = (content.match(LONE_LF) ?? []).length
  return carriageReturnCount > lineFeedCount ? '\r\n' : '\n'
}

async function readOrEmpty(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, ENCODING)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return ''
    }
    throw error
  }
}

function containsLine(content: string, pattern: string): boolean {
  const target = pattern.trim()
  return content.split(ANY_LINE_BREAK).some((line) => line.trim() === target)
}

/**
 * Lines at even indices, the line breaks between them at odd indices, so a
 * rejoin preserves every other byte.
 */
function splitKeepingLineEndings(content: string): string[] {
  return content.split(ANY_LINE_BREAK_KEPT)
}

export async function addPatterns(filePath: string, patterns: string[]): Promise<string[]> {
  let content = await readOrEmpty(filePath)
  const lineEnding = detectLineEnding(content)
  const added: string[] = []

  for (const pattern of patterns) {
    if (containsLine(content, pattern)) {
      continue
    }
    if (content.length === 0) {
      content = pattern + lineEnding
    } else {
      const separator = TRAILING_LINE_BREAK.test(content) ? '' : lineEnding
      content = content + separator + pattern + lineEnding
    }
    added.push(pattern)
  }

  if (added.length > 0) {
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, content, ENCODING)
  }
  return added
}

/**
 * Removes exact lines only. A broader glob such as `notes/` covering
 * `notes/todo.md` is left alone, since deleting it would reveal unrelated
 * files, and comes back as unmatched.
 */
export async function removePatterns(
  filePath: string,
  patterns: string[]
): Promise<{ removed: string[], unmatched: string[] }> {
  const content = await readOrEmpty(filePath)
  const parts = splitKeepingLineEndings(content)
  const removed: string[] = []

  for (const pattern of patterns) {
    const target = pattern.trim()
    for (let index = 0; index < parts.length; index += 2) {
      if (parts[index]?.trim() !== target) {
        continue
      }
      if (index + 1 < parts.length) {
        // The line and its line break.
        parts.splice(index, 2)
      } else if (index > 0) {
        // A final line without a line break, and the line break before it.
        parts.splice(index - 1, 2)
      } else {
        parts.splice(index, 1)
      }
      removed.push(target)
      break
    }
  }

  if (removed.length > 0) {
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.writeFile(filePath, parts.join(''), ENCODING)
  }
  const unmatched = patterns.filter((pattern) => !removed.includes(pattern.trim()))
  return { removed, unmatched }
}
