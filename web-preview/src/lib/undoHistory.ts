// Undo/redo history for the app's user-intent state (Ctrl+Z / Ctrl+Shift+Z).
//
// Design: pure observation, no setter instrumentation. The App rebuilds a flat
// snapshot object of by-reference state atoms every render and feeds it to
// `useUndoHistory`; the hook compares the ACTIVE atoms against the current
// history entry each commit and, on a change, records the *settled* state after
// a trailing debounce — so a drag (dozens of per-pointermove commits), a typing
// burst, or a slider sweep collapses into one undo step. A capture-phase
// `pointerdown` flush seals the previous gesture before a new one starts.
//
// Snapshots are cheap because every tracked write site is immutable (the config
// clusters are spread-merged, `words` is rebuilt via `map`, Files and rendered
// PdfBackgrounds are immutable values): an entry is ~30 shared references, and
// consecutive entries share every atom that didn't change.
//
// Restores are absorbed, not recorded: after undo/redo the app's reactive
// pipelines re-fire and converge on the restored state; for `settleMs` after a
// restore (and after mount) observed changes overwrite the current entry
// instead of pushing a new one, keeping the effect cascade out of history.

import { useCallback, useEffect, useRef, useState } from 'react'

// True when any ACTIVE atom differs between two snapshots. `shallowKeys` are
// compared per-property instead of by identity: the config-cluster setters
// allocate a fresh object even for a no-op write (and async clamps re-write
// identical values), which would otherwise register phantom changes.
export function activeSnapshotChanged<S extends Record<string, unknown>>(
  a: S,
  b: S,
  activeKeys: readonly (keyof S)[],
  shallowKeys: readonly (keyof S)[],
): boolean {
  for (const key of activeKeys) {
    const va = a[key]
    const vb = b[key]
    if (shallowKeys.includes(key)) {
      if (shallowChanged(va as Record<string, unknown>, vb as Record<string, unknown>)) return true
    } else if (!Object.is(va, vb)) {
      return true
    }
  }
  return false
}

function shallowChanged(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  if (Object.is(a, b)) return false
  if (!a || !b) return true
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return true
  return keys.some((k) => !Object.is(a[k], b[k]))
}

// Focus guard for the Ctrl+Z listener: true when the element edits text, so
// the browser's native undo applies and the app must stay out of the way.
const NON_TEXT_INPUT_TYPES = new Set(['checkbox', 'radio', 'file', 'range', 'button', 'submit', 'reset', 'color'])
function isTextEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag === 'INPUT') return !NON_TEXT_INPUT_TYPES.has((target as HTMLInputElement).type)
  return false
}

export interface UndoHistoryOptions<S> {
  // Max entries kept (oldest evicted). Entries are shared-reference objects,
  // so the cap bounds retention of stale Files/renders, not raw copies.
  limit?: number
  // Trailing debounce that turns a burst of commits into one entry.
  debounceMs?: number
  // Post-restore / post-mount window during which changes are absorbed into
  // the current entry instead of recorded (soaks up effect cascades).
  settleMs?: number
  // Comparison for "did the user change anything" (see activeSnapshotChanged).
  isChanged: (a: S, b: S) => boolean
  // Injectable clock/scheduler so the class is unit-testable without timers.
  now?: () => number
  // Must return a cancel function.
  schedule?: (fn: () => void, ms: number) => () => void
  // Notified whenever canUndo/canRedo may have changed.
  onUpdate?: () => void
}

// Pure history engine: entries + cursor + gesture coalescing. DOM-free.
export class UndoHistory<S> {
  private entries: S[]
  private cursor = 0
  private latest: S
  private cancelTimer: (() => void) | null = null
  private settleUntil: number
  private readonly limit: number
  private readonly debounceMs: number
  private readonly settleMs: number
  private readonly isChanged: (a: S, b: S) => boolean
  private readonly now: () => number
  private readonly schedule: (fn: () => void, ms: number) => () => void
  private readonly onUpdate: (() => void) | undefined

  constructor(initial: S, opts: UndoHistoryOptions<S>) {
    this.entries = [initial]
    this.latest = initial
    this.limit = opts.limit ?? 50
    this.debounceMs = opts.debounceMs ?? 400
    this.settleMs = opts.settleMs ?? 1000
    this.isChanged = opts.isChanged
    this.now = opts.now ?? (() => Date.now())
    this.schedule = opts.schedule ?? ((fn, ms) => {
      const id = setTimeout(fn, ms)
      return () => clearTimeout(id)
    })
    this.onUpdate = opts.onUpdate
    // Mount settle: initial effect churn (default fonts, first renders) is
    // absorbed into entry 0 rather than becoming an undoable step.
    this.settleUntil = this.now() + this.settleMs
  }

  get current(): S {
    return this.entries[this.cursor]
  }

  get canUndo(): boolean {
    return this.cursor > 0 || (this.cancelTimer !== null && this.isChanged(this.latest, this.current))
  }

  get canRedo(): boolean {
    return this.cursor < this.entries.length - 1
  }

  // Called every React commit with the freshest snapshot.
  observe(latest: S): void {
    this.latest = latest
    if (!this.isChanged(latest, this.current)) return
    if (this.now() < this.settleUntil) {
      // Post-restore/mount convergence: fold into the current entry.
      this.entries[this.cursor] = latest
      return
    }
    // (Re)arm the trailing debounce; the gesture is recorded once it goes quiet.
    this.cancelTimer?.()
    const hadPending = this.cancelTimer !== null
    this.cancelTimer = this.schedule(() => {
      this.cancelTimer = null
      this.commit()
    }, this.debounceMs)
    // First observation of a new gesture flips canUndo — let the UI know.
    if (!hadPending) this.onUpdate?.()
  }

  // Seal any pending gesture immediately (new pointerdown, undo/redo, unmount).
  flushPending(): void {
    if (!this.cancelTimer) return
    this.cancelTimer()
    this.cancelTimer = null
    this.commit()
  }

  // Cancel a pending gesture without recording (unmount cleanup).
  cancelPending(): void {
    this.cancelTimer?.()
    this.cancelTimer = null
  }

  // A real user gesture (pointerdown/keydown) ends the settle window early:
  // absorption is only meant for machine churn (post-restore / post-mount
  // effect convergence) — without this, dragging within `settleMs` of an undo
  // would silently fold the drag's first moves into the restored entry.
  endSettle(): void {
    this.settleUntil = this.now()
  }

  undo(): S | null {
    this.flushPending()
    if (this.cursor === 0) return null
    this.cursor--
    this.markRestore()
    this.onUpdate?.()
    return this.current
  }

  redo(): S | null {
    this.flushPending()
    if (this.cursor >= this.entries.length - 1) return null
    this.cursor++
    this.markRestore()
    this.onUpdate?.()
    return this.current
  }

  private markRestore(): void {
    this.settleUntil = this.now() + this.settleMs
  }

  private commit(): void {
    // The burst may have converged back to the recorded state (e.g. a drag
    // returned to the origin) — record only real net changes.
    if (!this.isChanged(this.latest, this.current)) return
    this.entries.length = this.cursor + 1 // truncate the redo tail
    this.entries.push(this.latest)
    this.cursor++
    if (this.entries.length > this.limit) {
      this.entries.shift()
      this.cursor--
    }
    this.onUpdate?.()
  }
}

// React adapter: owns one UndoHistory, observes the snapshot each commit, and
// installs the global keyboard (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, Ctrl+Y) and
// gesture-splitting pointerdown listeners.
export function useUndoHistory<S extends Record<string, unknown>>(args: {
  snapshot: S
  activeKeys: readonly (keyof S)[]
  shallowKeys?: readonly (keyof S)[]
  restore: (s: S) => void
  limit?: number
  debounceMs?: number
  settleMs?: number
}): { undo: () => void; redo: () => void; canUndo: boolean; canRedo: boolean } {
  const { snapshot, activeKeys, shallowKeys = [], restore, limit, debounceMs, settleMs } = args
  const [, setVersion] = useState(0)
  // Latest-restore ref, updated at effect time (restore is only invoked from
  // event handlers/timers, never during render, so this is soon enough — and
  // its closure only captures stable setters anyway).
  const restoreRef = useRef(restore)
  useEffect(() => {
    restoreRef.current = restore
  })

  // One engine per mount; the isChanged closure captures the first render's
  // key arrays (their contents are constants).
  const [history] = useState(
    () =>
      new UndoHistory(snapshot, {
        limit,
        debounceMs,
        settleMs,
        isChanged: (a, b) => activeSnapshotChanged(a, b, activeKeys, shallowKeys),
        onUpdate: () => setVersion((v) => v + 1),
      }),
  )

  // Observe every commit (deliberately no dep array).
  useEffect(() => {
    history.observe(snapshot)
  })

  const undo = useCallback(() => {
    const s = history.undo()
    if (s) restoreRef.current(s)
  }, [history])

  const redo = useCallback(() => {
    const s = history.redo()
    if (s) restoreRef.current(s)
  }, [history])

  useEffect(() => {
    // Capture phase: seal the previous gesture before the new interaction's
    // state changes start streaming in, and end any settle window — user input
    // means convergence is over and what follows is intent.
    const onPointerDown = () => {
      history.endSettle()
      history.flushPending()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      // Any keystroke is a user gesture (typing right after an undo must not
      // be absorbed into the restored entry). Undo/redo below re-open their
      // own settle window after this.
      history.endSettle()
      if (e.defaultPrevented) return
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const key = e.key.toLowerCase()
      const isUndo = key === 'z' && !e.shiftKey
      const isRedo = (key === 'z' && e.shiftKey) || key === 'y'
      if (!isUndo && !isRedo) return
      // Inside a text-editable control the browser's native undo must win.
      // Non-text inputs (radio/checkbox/file/…) have no native undo, and they
      // keep focus after a click/upload — app undo should still work there.
      if (isTextEditable(e.target)) return
      e.preventDefault()
      if (isUndo) undo()
      else redo()
    }
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown)
      history.cancelPending()
    }
  }, [history, undo, redo])

  return { undo, redo, canUndo: history.canUndo, canRedo: history.canRedo }
}
