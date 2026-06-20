import { useEffect } from 'react'

import { refreshGitStatus } from '@/store/git'

// Resolve the active workspace cwd to a git repo root and load status into the
// shared git store. Mounted once at a high level so the branch widget + Commit
// tool window both read fresh status regardless of which (if any) is open.
export function useGitStatusWatch(cwd: string) {
  useEffect(() => {
    let cancelled = false

    const load = async () => {
      const trimmed = cwd.trim()

      if (!trimmed) {
        await refreshGitStatus(null)

        return
      }

      const root = (await window.hermesDesktop?.gitRoot?.(trimmed)) ?? null

      if (!cancelled) {
        await refreshGitStatus(root)
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [cwd])
}
