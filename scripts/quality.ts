import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { projectFiles, projectRoot } from './project-files.ts'

const files = projectFiles()
const command = process.argv[2]
const extraArgs = process.argv.slice(3)

function run(packageName: string, args: string[]): number {
  const directory = join(projectRoot, 'node_modules', packageName)
  const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as {
    bin: string | Record<string, string>
  }
  const bin = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin[packageName]
  if (!bin) throw new Error(`No executable found for ${packageName}`)
  const result = spawnSync(process.execPath, [join(directory, bin), ...args], {
    cwd: projectRoot,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  return result.status ?? 1
}

let status: number
switch (command) {
  case 'typecheck': {
    const directory = mkdtempSync(join(projectRoot, 'node_modules', '.typecheck-'))
    const config = join(directory, 'tsconfig.json')
    try {
      writeFileSync(
        config,
        JSON.stringify({
          extends: join(projectRoot, 'tsconfig.json'),
          include: [],
          files: files
            .filter((file) => /\.(?:ts|vue)$/.test(file))
            .map((file) => resolve(projectRoot, file)),
        }),
      )
      status = run('vue-tsc', ['--noEmit', '--project', config, ...extraArgs])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
    break
  }
  case 'lint':
    status = run('eslint', [
      ...files.filter((file) => /\.(?:js|mjs|cjs|ts|vue)$/.test(file)),
      '--max-warnings',
      '0',
      ...extraArgs,
    ])
    break
  case 'styles':
    status = run('stylelint', [
      ...files.filter((file) => /^src\/.*\.(?:css|vue)$/.test(file)),
      '--allow-empty-input',
      ...extraArgs,
    ])
    break
  case 'format':
  case 'format:check':
    status = run('prettier', [
      command === 'format' ? '--write' : '--check',
      '--ignore-unknown',
      ...files,
      ...extraArgs,
    ])
    break
  default:
    throw new Error('Unknown quality command')
}
process.exitCode = status
