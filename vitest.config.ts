import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'
import { projectFiles } from './scripts/project-files.ts'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'node',
      include: projectFiles().filter((file) => /^(?:src|tests)\/.*\.test\.ts$/.test(file)),
      exclude: ['node_modules', 'dist', 'tests/e2e/**'],
      clearMocks: true,
      restoreMocks: true,
    },
  }),
)
