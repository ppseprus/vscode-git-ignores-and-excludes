import Module, { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const originalResolve = Module._resolveFilename

// The compiled modules require `vscode`, which only exists inside the editor.
Module._resolveFilename = function (request, ...rest) {
  return request === 'vscode' ? require.resolve('./vscode-stub.cjs') : originalResolve.call(this, request, ...rest)
}

export const vscode = require('./vscode-stub.cjs')
export const load = (name) => require(`../out/${name}.js`)
