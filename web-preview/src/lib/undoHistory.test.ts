import { describe, it, expect } from 'vitest'
import { UndoHistory, activeSnapshotChanged, type UndoHistoryOptions } from './undoHistory'

// Only the DOM-free engine is unit-tested here (the useUndoHistory hook needs a
// real browser — same trade-off as screenshot.test.ts). Time and scheduling are
// injected: `tick(ms)` advances the clock and fires any due timer, simulating
// the debounce without real timeouts.

type Snap = Record<string, unknown>

function harness(opts: Partial<UndoHistoryOptions<Snap>> & { initial?: Snap } = {}) {
  let now = 0
  let timer: { fn: () => void; at: number } | null = null
  let updates = 0
  const history = new UndoHistory<Snap>(opts.initial ?? { v: 0 }, {
    limit: opts.limit,
    debounceMs: opts.debounceMs ?? 400,
    settleMs: opts.settleMs ?? 1000,
    isChanged: opts.isChanged ?? ((a, b) => a.v !== b.v),
    now: () => now,
    schedule: (fn, ms) => {
      timer = { fn, at: now + ms }
      return () => {
        timer = null
      }
    },
    onUpdate: () => updates++,
  })
  const tick = (ms: number) => {
    now += ms
    if (timer && now >= timer.at) {
      const fn = timer.fn
      timer = null
      fn()
    }
  }
  return { history, tick, getUpdates: () => updates }
}

// Convenience: start past the mount-settle window so observations record.
function settled(opts: Parameters<typeof harness>[0] = {}) {
  const h = harness(opts)
  h.tick(1001)
  return h
}

describe('UndoHistory', () => {
  it('records a settled change after the debounce and undoes/redoes it', () => {
    const { history, tick } = settled()
    history.observe({ v: 1 })
    expect(history.canRedo).toBe(false)
    tick(400)
    expect(history.canUndo).toBe(true)

    expect(history.undo()).toEqual({ v: 0 })
    expect(history.canUndo).toBe(false)
    expect(history.canRedo).toBe(true)
    expect(history.redo()).toEqual({ v: 1 })
    expect(history.canRedo).toBe(false)
  })

  it('coalesces a 60 Hz drag into a single entry', () => {
    const { history, tick } = settled()
    for (let i = 1; i <= 60; i++) {
      history.observe({ v: i })
      tick(16) // inter-frame gap < debounce keeps extending the window
    }
    tick(400) // pointer went quiet — debounce fires
    expect(history.undo()).toEqual({ v: 0 })
    expect(history.canUndo).toBe(false) // whole drag was one entry
  })

  it('flushPending seals the current gesture immediately (pointerdown splitter)', () => {
    const { history, tick } = settled()
    history.observe({ v: 1 })
    tick(100) // debounce still pending
    history.flushPending() // user starts a new gesture
    history.observe({ v: 2 })
    tick(400)

    expect(history.undo()).toEqual({ v: 1 })
    expect(history.undo()).toEqual({ v: 0 })
  })

  it('undo flushes the pending gesture first, so Ctrl+Z mid-burst undoes the burst', () => {
    const { history } = settled()
    history.observe({ v: 1 }) // debounce armed, not yet committed
    expect(history.undo()).toEqual({ v: 0 })
    expect(history.canRedo).toBe(true)
  })

  it('does not record a burst that converges back to the recorded state', () => {
    const { history, tick } = settled()
    history.observe({ v: 5 })
    history.observe({ v: 0 }) // drag returned to origin
    tick(400)
    expect(history.canUndo).toBe(false)
  })

  it('truncates the redo tail when a new change is recorded after undo', () => {
    const { history, tick } = settled({ settleMs: 0 }) // no absorb window, pure stack semantics
    history.observe({ v: 1 })
    tick(400)
    history.observe({ v: 2 })
    tick(400)
    history.undo()
    expect(history.canRedo).toBe(true)
    history.observe({ v: 9 })
    tick(400)
    expect(history.canRedo).toBe(false)
    expect(history.undo()).toEqual({ v: 1 })
  })

  it('evicts the oldest entry past the limit', () => {
    const { history, tick } = settled({ limit: 3 })
    for (const v of [1, 2, 3]) {
      history.observe({ v })
      tick(400)
    }
    // limit 3 → entries [1, 2, 3]; the initial {v:0} was evicted.
    expect(history.undo()).toEqual({ v: 2 })
    expect(history.undo()).toEqual({ v: 1 })
    expect(history.undo()).toBeNull()
  })

  it('absorbs post-restore convergence into the current entry instead of recording', () => {
    const { history, tick } = settled()
    history.observe({ v: 1 })
    tick(400)
    history.undo() // restore {v:0}; settle window opens
    // Reactive pipelines converge with a slightly different value…
    history.observe({ v: 0.5 })
    expect(history.canUndo).toBe(false) // absorbed, not recorded
    expect(history.canRedo).toBe(true) // redo tail untouched by absorption
    expect(history.current).toEqual({ v: 0.5 })
  })

  it('endSettle stops absorption: a drag right after undo becomes its own entry', () => {
    const { history, tick } = settled()
    history.observe({ v: 1 })
    tick(400)
    history.undo() // settle window opens around the restored {v:0}
    tick(100)
    history.endSettle() // user pressed pointer — gesture, not churn
    history.observe({ v: 7 }) // drag moves stream
    tick(400)
    // The restored entry must be intact and the drag its own entry.
    expect(history.undo()).toEqual({ v: 0 })
  })

  it('absorbs mount-time churn into entry 0', () => {
    const { history, tick } = harness() // still inside the mount settle window
    history.observe({ v: 1 })
    history.observe({ v: 2 })
    tick(1001)
    expect(history.canUndo).toBe(false)
    expect(history.current).toEqual({ v: 2 })
  })

  it('shares unchanged atom identities across entries', () => {
    const words = [{ x: 1 }]
    const file = { name: 'bg.pdf' }
    const isChanged = (a: Snap, b: Snap) => a.words !== b.words || a.file !== b.file
    const { history, tick } = settled({ initial: { words, file }, isChanged })
    const movedWords = [{ x: 2 }]
    history.observe({ words: movedWords, file }) // drag moved a word; file untouched
    tick(400)
    const prev = history.undo()!
    expect(prev.file).toBe(file) // unchanged atom is the same reference
    expect(prev.words).toBe(words)
  })

  it('notifies onUpdate when undo-ability changes', () => {
    const { history, tick, getUpdates } = settled()
    const before = getUpdates()
    history.observe({ v: 1 }) // pending gesture → canUndo flips true
    tick(400) // commit
    history.undo()
    expect(getUpdates()).toBeGreaterThan(before)
  })
})

describe('activeSnapshotChanged', () => {
  const active = ['config', 'words'] as const

  it('uses identity for plain atoms and per-key comparison for shallow ones', () => {
    const config = { a: 1, b: 'x' }
    const words = [1, 2]
    const base = { config, words }
    // Fresh cluster object with identical values — the setters' no-op case.
    expect(activeSnapshotChanged({ config: { ...config }, words }, base, active, ['config'])).toBe(false)
    // Same shape, one differing value.
    expect(activeSnapshotChanged({ config: { ...config, b: 'y' }, words }, base, active, ['config'])).toBe(true)
    // Non-shallow atom compares by identity even when deep-equal.
    expect(activeSnapshotChanged({ config, words: [1, 2] }, base, active, [])).toBe(true)
    expect(activeSnapshotChanged({ config, words }, base, active, [])).toBe(false)
  })

  it('ignores atoms outside activeKeys', () => {
    const base = { config: { a: 1 }, words: [], passive: 'p1' }
    const next = { ...base, passive: 'p2' }
    expect(activeSnapshotChanged(next, base, active, ['config'])).toBe(false)
  })
})
