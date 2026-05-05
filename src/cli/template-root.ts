import path from 'path'

export function resolveTemplateRoot(appPath: string) {
  const runDir = path.parse(appPath).dir
  const parts = runDir.split(path.sep)
  const last = parts[parts.length - 1]
  const beforeLast = parts[parts.length - 2]

  if (process.env.NOTION_MIRROR_CLI_DEBUG) {
    return path.join(runDir, '..', '..')
  }

  if (last === '.bin' && beforeLast === 'node_modules') {
    return path.join(runDir, '..', 'notion-mirror-generator')
  }

  if (last === 'cli' && beforeLast === 'dist') {
    return path.join(runDir, '..', '..')
  }

  if (beforeLast === 'notion-mirror-generator') {
    return path.join(runDir, '..')
  }

  return path.join(runDir, '..', 'notion-mirror-generator')
}
