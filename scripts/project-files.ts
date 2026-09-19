import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const projectRoot = fileURLToPath(new URL('../', import.meta.url))

export function projectFiles(): string[] {
  const output = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: projectRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
  )
  const deleted = new Set(
    execFileSync('git', ['ls-files', '--deleted', '-z'], {
      cwd: projectRoot,
      encoding: 'utf8',
    }).split('\0'),
  )
  return [...new Set(output.split('\0').filter((file) => file && !deleted.has(file)))].sort()
}

export function localExclusionPatterns(): string[] {
  const excludePath = resolve(
    projectRoot,
    execFileSync('git', ['rev-parse', '--git-path', 'info/exclude'], {
      cwd: projectRoot,
      encoding: 'utf8',
    }).trim(),
  )
  if (!existsSync(excludePath)) return []
  return readFileSync(excludePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !line.startsWith('!'))
    .map((pattern) => {
      const anchored = pattern.startsWith('/') || pattern.slice(0, -1).includes('/')
      const relative = pattern.replace(/^\//, '').replace(/\/$/, '/**')
      return `${projectRoot.replaceAll('\\', '/')}${anchored ? '' : '**/'}${relative}`
    })
}
