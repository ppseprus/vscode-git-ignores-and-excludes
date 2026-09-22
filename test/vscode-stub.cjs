class EventEmitter {
  constructor() {
    this.listeners = []
    this.event = (listener) => {
      this.listeners.push(listener)
      return { dispose: () => undefined }
    }
  }

  fire(value) {
    for (const listener of this.listeners) {
      listener(value)
    }
  }

  dispose() {
    this.listeners = []
  }
}

class ThemeColor {
  constructor(id) {
    this.id = id
  }
}

module.exports = {
  workspace: {
    workspaceFolders: undefined,
    getConfiguration: () => ({ get: (key, fallback) => fallback })
  },
  window: { activeTextEditor: undefined },
  Uri: { file: (fsPath) => ({ scheme: 'file', fsPath }) },
  EventEmitter,
  ThemeColor,
  Disposable: class {}
}
