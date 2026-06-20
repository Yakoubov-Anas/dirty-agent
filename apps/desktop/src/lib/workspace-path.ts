/** `filePath` relative to `cwd`, or null when it is not inside the workspace.
 *  Separator- and case-insensitive (Windows + `file:` URLs); the returned slice
 *  preserves the original casing/separators. */
export function relativePathFromCwd(cwd: string, filePath: string): string | null {
  if (!cwd || !filePath) {
    return null
  }

  const root = cwd
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase()

  const full = filePath.replace(/\\/g, '/').toLowerCase()

  if (full === root || !full.startsWith(`${root}/`)) {
    return null
  }

  return filePath.slice(root.length).replace(/^[\\/]+/, '')
}
