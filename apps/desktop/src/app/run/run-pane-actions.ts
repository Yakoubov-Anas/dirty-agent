import { RUN_PANE_ID } from '@/store/layout'
import { setPaneOpen } from '@/store/panes'

// Open the Run results tool window (e.g. when a run starts).
export function openRunPane() {
  setPaneOpen(RUN_PANE_ID, true)
}
