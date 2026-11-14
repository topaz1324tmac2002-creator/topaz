import { create } from 'zustand'
import { DEFAULT_DESIGN, type BandParams, type Design, type EngravingParams, type EnvironmentId, type MetalId, type SculptMode, type StoneParams } from './core/types'

export type TabId = 'band' | 'stone' | 'engrave' | 'material' | 'export'
export type ToastKind = 'info' | 'warn' | 'error' | 'ok'
export interface Toast {
  id: number
  text: string
  kind: ToastKind
}

const STORAGE_KEY = 'jewelry-studio:design:v1'
const HISTORY_MS = 800
const HISTORY_MAX = 50

let lastKey = ''
let lastAt = 0
let toastSeq = 0
let saveTimer: ReturnType<typeof setTimeout> | null = null

function loadSaved(): Design {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_DESIGN
    const parsed = JSON.parse(raw) as Partial<Design>
    return {
      band: { ...DEFAULT_DESIGN.band, ...(parsed.band ?? {}) },
      stone: { ...DEFAULT_DESIGN.stone, ...(parsed.stone ?? {}) },
      engraving: { ...DEFAULT_DESIGN.engraving, ...(parsed.engraving ?? {}) },
      metal: parsed.metal ?? DEFAULT_DESIGN.metal,
      environment: parsed.environment ?? DEFAULT_DESIGN.environment,
    }
  } catch {
    return DEFAULT_DESIGN
  }
}

function scheduleSave(design: Design): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(design))
    } catch {
      /* 저장 공간 부족 등은 조용히 무시 */
    }
  }, 1000)
}

interface State {
  design: Design
  tab: TabId
  sculptMode: SculptMode
  brushRadiusMm: number
  brushStrength: number
  turntable: boolean
  highQuality: boolean
  toast: Toast | null
  undoStack: Design[]
  redoStack: Design[]
  sculptAction: { type: 'undo' | 'reset'; seq: number } | null

  setTab: (tab: TabId) => void
  patchBand: (patch: Partial<BandParams>, key?: string) => void
  patchStone: (patch: Partial<StoneParams>, key?: string) => void
  patchEngraving: (patch: Partial<EngravingParams>, key?: string) => void
  setMetal: (metal: MetalId) => void
  setEnvironment: (env: EnvironmentId) => void
  setSculptMode: (mode: SculptMode) => void
  setHighQuality: (on: boolean) => void
  setBrush: (patch: { radiusMm?: number; strength?: number }) => void
  setTurntable: (on: boolean) => void
  undo: () => void
  redo: () => void
  resetDesign: () => void
  requestSculptAction: (type: 'undo' | 'reset') => void
  showToast: (text: string, kind?: ToastKind) => void
  dismissToast: (id: number) => void
}

const initialDesign = typeof localStorage === 'undefined' ? DEFAULT_DESIGN : loadSaved()

export const useStore = create<State>()((set, get) => {
  /** 실행 취소 스택에 이전 상태를 쌓습니다. 같은 조작의 연속 입력은 0.8초 안에서 하나로 묶습니다. */
  const commit = (next: Design, key: string): void => {
    const now = Date.now()
    const coalesce = key === lastKey && now - lastAt < HISTORY_MS
    lastKey = key
    lastAt = now
    const prev = get().design
    if (!coalesce) {
      set((s) => ({
        design: next,
        undoStack: [...s.undoStack, prev].slice(-HISTORY_MAX),
        redoStack: [],
      }))
    } else {
      set({ design: next })
    }
    scheduleSave(next)
  }

  return {
    design: initialDesign,
    tab: 'band',
    sculptMode: 'off',
    brushRadiusMm: 2.2,
    brushStrength: 0.5,
    turntable: false,
    highQuality: true,
    toast: null,
    undoStack: [],
    redoStack: [],
    sculptAction: null,

    setTab: (tab) => set({ tab }),

    patchBand: (patch, key = 'band:' + Object.keys(patch).join(',')) => {
      const s = get()
      commit({ ...s.design, band: { ...s.design.band, ...patch } }, key)
    },
    patchStone: (patch, key = 'stone:' + Object.keys(patch).join(',')) => {
      const s = get()
      commit({ ...s.design, stone: { ...s.design.stone, ...patch } }, key)
    },
    patchEngraving: (patch, key = 'engrave:' + Object.keys(patch).join(',')) => {
      const s = get()
      commit({ ...s.design, engraving: { ...s.design.engraving, ...patch } }, key)
    },
    setMetal: (metal) => commit({ ...get().design, metal }, 'metal'),
    setEnvironment: (environment) => commit({ ...get().design, environment }, 'environment'),

    setSculptMode: (mode) => set({ sculptMode: mode }),
    setHighQuality: (on) => set({ highQuality: on }),
    setBrush: (patch) =>
      set((s) => ({
        brushRadiusMm: patch.radiusMm ?? s.brushRadiusMm,
        brushStrength: patch.strength ?? s.brushStrength,
      })),
    setTurntable: (on) => set({ turntable: on }),

    undo: () => {
      const s = get()
      const prev = s.undoStack[s.undoStack.length - 1]
      if (!prev) return
      lastKey = ''
      set({
        design: prev,
        undoStack: s.undoStack.slice(0, -1),
        redoStack: [...s.redoStack, s.design],
      })
      scheduleSave(prev)
    },
    redo: () => {
      const s = get()
      const next = s.redoStack[s.redoStack.length - 1]
      if (!next) return
      lastKey = ''
      set({
        design: next,
        redoStack: s.redoStack.slice(0, -1),
        undoStack: [...s.undoStack, s.design],
      })
      scheduleSave(next)
    },
    resetDesign: () => {
      const s = get()
      set({ design: DEFAULT_DESIGN, undoStack: [...s.undoStack, s.design], redoStack: [] })
      scheduleSave(DEFAULT_DESIGN)
    },

    requestSculptAction: (type) =>
      set((s) => ({ sculptAction: { type, seq: (s.sculptAction?.seq ?? 0) + 1 } })),

    showToast: (text, kind = 'info') => {
      const id = ++toastSeq
      set({ toast: { id, text, kind } })
      setTimeout(() => {
        if (get().toast?.id === id) set({ toast: null })
      }, 3200)
    },
    dismissToast: (id) => set((s) => (s.toast?.id === id ? { toast: null } : {})),
  }
})

useStore.subscribe((s) => {
  if (s.design) scheduleSave(s.design)
})
