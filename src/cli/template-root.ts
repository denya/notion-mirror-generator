import path from 'path'

export function resolveTemplateRoot(appPath: string) {
  const runDir = path.parse(appPath).dir
  const parts = runDir.split(path.sep)
  const last = parts[parts.length - 1]
  const beforeLast = parts[parts.length - 2]

  if (process.env.NOTEHOST_CLI_DEBUG) {
    return path.join(runDir, '..', '..')
  }

  if (last === '.bin' && beforeLast === 'node_modules') {
    return path.join(runDir, '..', 'notehost')
  }

  if (last === 'cli' && beforeLast === 'dist') {
    return path.join(runDir, '..', '..')
  }

  if (beforeLast === 'notehost') {
    return path.join(runDir, '..')
  }

  return path.join(runDir, '..', 'notehost')
}
