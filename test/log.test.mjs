import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { load } from './load.mjs'

const { counted, formatDuration } = load('log')

describe('counted', () => {
  it('picks the singular for one and the plural otherwise', () => {
    assert.equal(counted(1, 'path'), '1 path')
    assert.equal(counted(0, 'path'), '0 paths')
    assert.equal(counted(2, 'repository', 'repositories'), '2 repositories')
  })
})

describe('formatDuration', () => {
  it('rounds to the unit a person reads', () => {
    assert.equal(formatDuration(0.4), 'under 1 ms')
    assert.equal(formatDuration(23.6), '24 ms')
    assert.equal(formatDuration(1500), '1.5 s')
    assert.equal(formatDuration(12345), '12 s')
  })
})
