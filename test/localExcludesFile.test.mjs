import { after, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { load } from './load.mjs'
import { remove, temporaryDirectory } from './fixtures.mjs'

const { toPattern, addPatterns, removePatterns } = load('localExcludesFile')
const read = (filePath) => readFileSync(filePath, 'utf8')

describe('toPattern', () => {
  const root = path.resolve('/repo')
  const inRoot = (...segments) => path.join(root, ...segments)

  it('anchors the pattern at the root', () => {
    assert.equal(toPattern(root, inRoot('build'), false), '/build')
    assert.equal(toPattern(root, inRoot('src', 'x.ts'), false), '/src/x.ts')
  })

  it('marks a directory with a trailing slash', () => {
    assert.equal(toPattern(root, inRoot('build'), true), '/build/')
  })

  it('escapes glob metacharacters', () => {
    assert.equal(toPattern(root, inRoot('notes [draft]*?.md'), false), '/notes \\[draft\\]\\*\\?.md')
  })

  it('escapes trailing spaces', () => {
    assert.equal(toPattern(root, inRoot('name  '), false), '/name\\ \\ ')
  })

  it('rejects the root and anything outside it', () => {
    assert.throws(() => toPattern(root, root, true), /outside the repository/)
    assert.throws(() => toPattern(root, path.resolve('/elsewhere', 'x'), false), /outside the repository/)
    assert.throws(() => toPattern(root, path.resolve(root, '..'), true), /outside the repository/)
  })

  it('accepts a name starting with two dots', () => {
    assert.equal(toPattern(root, inRoot('..notes'), false), '/..notes')
  })

  it('rejects control characters', () => {
    assert.throws(() => toPattern(root, inRoot('a\nb'), false), /control character/)
  })
})

describe('addPatterns', () => {
  const directory = temporaryDirectory()
  after(() => remove(directory))
  let counter = 0
  const newFile = (content) => {
    const filePath = path.join(directory, `exclude-${counter++}`)
    if (content !== undefined) {
      writeFileSync(filePath, content)
    }
    return filePath
  }

  it('creates the file and its directory', async () => {
    const filePath = path.join(directory, 'nested', 'exclude')
    assert.deepEqual(await addPatterns(filePath, ['/a']), ['/a'])
    assert.equal(read(filePath), '/a\n')
  })

  it('appends after a file without a final line break', async () => {
    const filePath = newFile('/a')
    await addPatterns(filePath, ['/b'])
    assert.equal(read(filePath), '/a\n/b\n')
  })

  it('keeps CRLF line endings', async () => {
    const filePath = newFile('/a\r\n/b\r\n')
    await addPatterns(filePath, ['/c'])
    assert.equal(read(filePath), '/a\r\n/b\r\n/c\r\n')
  })

  it('skips patterns already present, ignoring surrounding whitespace', async () => {
    const filePath = newFile('  /a  \n')
    assert.deepEqual(await addPatterns(filePath, ['/a', '/b']), ['/b'])
    assert.equal(read(filePath), '  /a  \n/b\n')
  })

  it('leaves the file alone when nothing is new', async () => {
    const filePath = newFile('/a\n')
    assert.deepEqual(await addPatterns(filePath, ['/a']), [])
    assert.equal(read(filePath), '/a\n')
  })
})

describe('removePatterns', () => {
  const directory = temporaryDirectory()
  after(() => remove(directory))
  let counter = 0
  const newFile = (content) => {
    const filePath = path.join(directory, `exclude-${counter++}`)
    writeFileSync(filePath, content)
    return filePath
  }

  it('removes an exact line and keeps every other byte', async () => {
    const filePath = newFile('# keep\r\n/a\n/b\r\n')
    assert.deepEqual(await removePatterns(filePath, ['/a']), { removed: ['/a'], unmatched: [] })
    assert.equal(read(filePath), '# keep\r\n/b\r\n')
  })

  it('removes a final line without a line break', async () => {
    const filePath = newFile('/a\n/b')
    await removePatterns(filePath, ['/b'])
    assert.equal(read(filePath), '/a')
  })

  it('removes the only line', async () => {
    const filePath = newFile('/a')
    await removePatterns(filePath, ['/a'])
    assert.equal(read(filePath), '')
  })

  it('matches ignoring surrounding whitespace', async () => {
    const filePath = newFile('  /a  \n/b\n')
    assert.deepEqual((await removePatterns(filePath, ['/a'])).removed, ['/a'])
    assert.equal(read(filePath), '/b\n')
  })

  it('leaves a broader pattern alone and reports the file as unmatched', async () => {
    const filePath = newFile('notes/\n')
    const result = await removePatterns(filePath, ['/notes/todo.md'])
    assert.deepEqual(result, { removed: [], unmatched: ['/notes/todo.md'] })
    assert.equal(read(filePath), 'notes/\n')
  })

  it('treats a missing file as empty and does not create it', async () => {
    const filePath = path.join(directory, 'missing')
    assert.deepEqual(await removePatterns(filePath, ['/a']), { removed: [], unmatched: ['/a'] })
    assert.equal(existsSync(filePath), false)
  })
})
