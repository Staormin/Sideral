import { createFilter, defineConfig, normalizePath } from 'vite'
import vue from '@vitejs/plugin-vue'
import vuetify from 'vite-plugin-vuetify'
import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { localExclusionPatterns, projectRoot } from './scripts/project-files.ts'

export default defineConfig({
  base: './',
  plugins: [
    vue(),
    vuetify({ autoImport: true }),
    {
      name: 'local-file-access',
      configureServer(server) {
        const patterns = localExclusionPatterns()
        if (patterns.length === 0) return
        const isExcluded = createFilter(patterns, undefined, { resolve: false })
        server.middlewares.use((request, response, next) => {
          let pathname: string
          try {
            pathname = decodeURIComponent((request.url ?? '/').split('?')[0] ?? '/')
          } catch {
            response.statusCode = 400
            response.end()
            return
          }
          const file = normalizePath(
            pathname.startsWith('/@fs/')
              ? resolve('/', pathname.slice('/@fs/'.length))
              : resolve(projectRoot, `.${pathname}`),
          )
          let resolved = file
          try {
            resolved = normalizePath(realpathSync(file))
          } catch {
            // Missing files are handled by the regular development middleware.
          }
          if (isExcluded(file) || isExcluded(resolved)) {
            response.statusCode = 403
            response.end()
            return
          }
          next()
        })
      },
    },
  ],
  build: {
    target: 'es2022',
  },
})
