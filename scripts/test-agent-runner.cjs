const path = require('path')
const os = require('os')
const Module = require('module')

const originalLoad = Module._load
Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    return {
      app: {
        getPath: (name) => {
          if (name === 'userData') {
            return path.join(os.tmpdir(), 'pdf-reader-test')
          }
          return os.tmpdir()
        }
      },
      net: {
        fetch: (input, init) => {
          const fetch = require('node-fetch')
          return fetch(input, init)
        }
      }
    }
  }
  return originalLoad.apply(this, arguments)
}

process.on('uncaughtException', (err) => {
  console.error(err)
})

require('tsx/cjs')
require('./test-agent.cjs')
