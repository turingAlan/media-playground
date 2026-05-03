/**
 * Local-storage store for history and presets.
 * Pure module — no React imports at top level; hooks are exported separately.
 */

// ─── Keys ─────────────────────────────────────────────────────────────────────

export const HISTORY_KEY        = 'mz-history'
export const IMAGE_PRESETS_KEY  = 'mz-presets-image'
export const VIDEO_PRESETS_KEY  = 'mz-presets-video'
export const QR_PRESETS_KEY     = 'mz-presets-qr'

const MAX_HISTORY = 50

// ─── Types ────────────────────────────────────────────────────────────────────

export type HistoryKind = 'image' | 'video' | 'qr'

export type HistoryEntry = {
  id: string
  timestamp: number
  kind: HistoryKind
  /** Short display label, e.g. "photo.jpg" */
  label: string
  /** One-line detail, e.g. "WebP · Q85 · 1920×1080" */
  detail: string
}

export type ImagePreset = {
  id: string
  name: string
  format: string     // e.g. 'image/webp'
  quality: number    // 0-1
}

export type VideoPreset = {
  id: string
  name: string
  formats: string[]
  crf: number
  encodingPreset: string
  scale: string | null
  removeAudio: boolean
  audioBitrate: string
}

export type QRPresetSettings = {
  errorLevel: string
  margin: number
  shape: 'square' | 'circle'
  dotType: string
  // biome-ignore lint/suspicious/noExplicitAny: serialised colour config
  dotColor: any
  bgTransparent: boolean
  bgColor: string
  csType: string
  csColorInherit: boolean
  // biome-ignore lint/suspicious/noExplicitAny: serialised colour config
  csColor: any
  cdType: string
  cdColorInherit: boolean
  // biome-ignore lint/suspicious/noExplicitAny: serialised colour config
  cdColor: any
  logoSize: number
  logoMargin: number
  logoHideDots: boolean
  exportFormat: string
  exportSize: number
}

export type QRPreset = {
  id: string
  name: string
  settings: QRPresetSettings
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

function safeGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function safeSet(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    // Notify same-tab listeners
    window.dispatchEvent(new StorageEvent('storage', { key }))
  } catch {
    // quota exceeded – ok
  }
}

// ─── History ──────────────────────────────────────────────────────────────────

export function getHistory(): HistoryEntry[] {
  return safeGet<HistoryEntry[]>(HISTORY_KEY, [])
}

export function addHistory(entry: Omit<HistoryEntry, 'id' | 'timestamp'>): void {
  const next: HistoryEntry = { ...entry, id: uid(), timestamp: Date.now() }
  safeSet(HISTORY_KEY, [next, ...getHistory()].slice(0, MAX_HISTORY))
}

export function clearHistory(): void {
  safeSet(HISTORY_KEY, [])
}

// ─── Image presets ────────────────────────────────────────────────────────────

export function getImagePresets(): ImagePreset[] {
  return safeGet<ImagePreset[]>(IMAGE_PRESETS_KEY, [])
}

export function saveImagePreset(data: Omit<ImagePreset, 'id'>): ImagePreset {
  const preset: ImagePreset = { ...data, id: uid() }
  safeSet(IMAGE_PRESETS_KEY, [...getImagePresets(), preset])
  return preset
}

export function renameImagePreset(id: string, name: string): void {
  safeSet(IMAGE_PRESETS_KEY, getImagePresets().map((p) => p.id === id ? { ...p, name } : p))
}

export function deleteImagePreset(id: string): void {
  safeSet(IMAGE_PRESETS_KEY, getImagePresets().filter((p) => p.id !== id))
}

// ─── Video presets ────────────────────────────────────────────────────────────

export function getVideoPresets(): VideoPreset[] {
  return safeGet<VideoPreset[]>(VIDEO_PRESETS_KEY, [])
}

export function saveVideoPreset(data: Omit<VideoPreset, 'id'>): VideoPreset {
  const preset: VideoPreset = { ...data, id: uid() }
  safeSet(VIDEO_PRESETS_KEY, [...getVideoPresets(), preset])
  return preset
}

export function renameVideoPreset(id: string, name: string): void {
  safeSet(VIDEO_PRESETS_KEY, getVideoPresets().map((p) => p.id === id ? { ...p, name } : p))
}

export function deleteVideoPreset(id: string): void {
  safeSet(VIDEO_PRESETS_KEY, getVideoPresets().filter((p) => p.id !== id))
}

// ─── QR presets ───────────────────────────────────────────────────────────────

export function getQRPresets(): QRPreset[] {
  return safeGet<QRPreset[]>(QR_PRESETS_KEY, [])
}

export function saveQRPreset(data: Omit<QRPreset, 'id'>): QRPreset {
  const preset: QRPreset = { ...data, id: uid() }
  safeSet(QR_PRESETS_KEY, [...getQRPresets(), preset])
  return preset
}

export function renameQRPreset(id: string, name: string): void {
  safeSet(QR_PRESETS_KEY, getQRPresets().map((p) => p.id === id ? { ...p, name } : p))
}

export function deleteQRPreset(id: string): void {
  safeSet(QR_PRESETS_KEY, getQRPresets().filter((p) => p.id !== id))
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useState } from 'react'

function useStorageState<T>(key: string, getter: () => T): T {
  const [value, setValue] = useState<T>(getter)

  const refresh = useCallback(() => setValue(getter()), [getter])

  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (!e.key || e.key === key) refresh()
    }
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [key, refresh])

  return value
}

export function useHistory(): HistoryEntry[] {
  return useStorageState(HISTORY_KEY, useCallback(getHistory, []))
}

export function useImagePresets(): ImagePreset[] {
  return useStorageState(IMAGE_PRESETS_KEY, useCallback(getImagePresets, []))
}

export function useVideoPresets(): VideoPreset[] {
  return useStorageState(VIDEO_PRESETS_KEY, useCallback(getVideoPresets, []))
}

export function useQRPresets(): QRPreset[] {
  return useStorageState(QR_PRESETS_KEY, useCallback(getQRPresets, []))
}

// ─── Cross-component preset loading via custom events ─────────────────────────

export const LOAD_IMAGE_PRESET_EVENT = 'mz:load-image-preset'
export const LOAD_VIDEO_PRESET_EVENT = 'mz:load-video-preset'
export const LOAD_QR_PRESET_EVENT    = 'mz:load-qr-preset'

export function emitLoadImagePreset(preset: ImagePreset): void {
  window.dispatchEvent(new CustomEvent(LOAD_IMAGE_PRESET_EVENT, { detail: preset }))
}

export function emitLoadVideoPreset(preset: VideoPreset): void {
  window.dispatchEvent(new CustomEvent(LOAD_VIDEO_PRESET_EVENT, { detail: preset }))
}

export function emitLoadQRPreset(preset: QRPreset): void {
  window.dispatchEvent(new CustomEvent(LOAD_QR_PRESET_EVENT, { detail: preset }))
}
