import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

// ─── Grip icon (3 vertical lines) ────────────────────────────────────────────
function GripLines() {
  return (
    <div style={{ display: 'flex', gap: 2, alignItems: 'center', justifyContent: 'center' }}>
      {[0,1,2].map((i) => (
        <div key={i} style={{ width: 1.5, height: 10, borderRadius: 1, background: 'rgba(0,0,0,0.45)' }} />
      ))}
    </div>
  )
}

import DropZone from '#/components/media/DropZone'
import {
  formatBytes,
  loadFFmpeg,
  processVideo,
  type VideoFormat,
} from '#/lib/ffmpeg-service'

export const Route = createFileRoute('/media/video')({ component: VideoStudio })

type VideoResult = {
  blob: Blob
  url: string
  format: VideoFormat
  ext: string
}

type VideoFileEntry = {
  id: string
  file: File
  fileUrl: string
  poster: string | null
  videoError: boolean
  videoDuration: number
  trimEnabled: boolean
  trimStart: number
  trimEnd: number
  results: VideoResult[]
  errors: Partial<Record<VideoFormat, string>>
  formatProgress: Partial<Record<VideoFormat, number>>
  processing: boolean
}

function Section({ title, badge, children }: { title: string; badge?: string; children: React.ReactNode }) {
  return (
    <div style={{ borderBottom: '1px solid var(--mz-border)', paddingBottom: 14, marginBottom: 14 }}>
      <div className="flex items-center justify-between mb-2.5">
        <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--mz-text-2)' }}>{title}</span>
        {badge && <span className="mz-badge">{badge}</span>}
      </div>
      {children}
    </div>
  )
}

function fmtTime(s: number): string {
  const m   = Math.floor(s / 60)
  const sec = (s % 60).toFixed(1)
  return m > 0 ? `${m}:${sec.padStart(4, '0')}` : `${sec}s`
}

function VideoTrimTimeline({
  duration, start, end, currentTime,
  onStartChange, onEndChange, onSeek,
}: {
  duration: number
  start: number
  end: number
  currentTime: number
  onStartChange: (v: number) => void
  onEndChange:   (v: number) => void
  onSeek: (t: number) => void
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragTip, setDragTip] = useState<{ which: 'start' | 'end' | 'seek'; time: number } | null>(null)
  const [hovered, setHovered] = useState<'start' | 'end' | null>(null)
  const MIN_GAP  = Math.max(0.5, duration * 0.005)

  function posToSec(clientX: number) {
    if (!trackRef.current) return 0
    const rect = trackRef.current.getBoundingClientRect()
    return Math.max(0, Math.min(duration, ((clientX - rect.left) / rect.width) * duration))
  }

  function makeDrag(which: 'start' | 'end' | 'seek') {
    return (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const apply = (clientX: number) => {
        const sec = posToSec(clientX)
        let clamped = sec
        if (which === 'start') {
          clamped = Math.max(0, Math.min(sec, end - MIN_GAP))
          onStartChange(clamped)
        } else if (which === 'end') {
          clamped = Math.min(duration, Math.max(sec, start + MIN_GAP))
          onEndChange(clamped)
        } else {
          onSeek(sec)
        }
        setDragTip({ which, time: clamped })
      }
      apply('touches' in e ? e.touches[0].clientX : e.clientX)
      const move = (ev: MouseEvent | TouchEvent) =>
        apply('touches' in ev ? ev.touches[0].clientX : ev.clientX)
      const up = () => {
        setDragTip(null)
        window.removeEventListener('mousemove', move)
        window.removeEventListener('mouseup',   up)
        window.removeEventListener('touchmove', move as EventListener)
        window.removeEventListener('touchend',  up)
      }
      window.addEventListener('mousemove', move)
      window.addEventListener('mouseup',   up)
      window.addEventListener('touchmove', move as EventListener, { passive: false })
      window.addEventListener('touchend',  up)
    }
  }

  const s  = (start       / duration) * 100
  const e  = (end         / duration) * 100
  const ct = (currentTime / duration) * 100

  // ── Tick marks ─────────────────────────────────────────────────────────────
  // Pick a sensible interval (every 1s, 5s, 10s, 30s, 60s …)
  const tickIntervals = [1, 2, 5, 10, 15, 30, 60, 120, 300]
  const maxTicks = 12
  const tickInterval = tickIntervals.find((t) => duration / t <= maxTicks) ?? 300
  const ticks: number[] = []
  for (let t = tickInterval; t < duration; t += tickInterval) ticks.push(t)

  const TRACK_H  = 40
  const HANDLE_W = 16
  const OVERHANG = 6

  return (
    <div style={{ userSelect: 'none' }}>
      {/* ── Main scrubber ──────────────────────────────────────── */}
      <div style={{ position: 'relative', paddingLeft: HANDLE_W, paddingRight: HANDLE_W }}>
        {/* Click-to-seek outer container */}
        <div
          ref={trackRef}
          onMouseDown={makeDrag('seek')}
          onTouchStart={makeDrag('seek')}
          style={{
            position: 'relative',
            height: TRACK_H + OVERHANG * 2,
            cursor: 'crosshair',
          }}
        >
          {/* ── Track body ─────────────────────────────────────── */}
          <div style={{
            position: 'absolute',
            top: OVERHANG, left: 0, right: 0, height: TRACK_H,
            borderRadius: 5,
            overflow: 'hidden',
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
          }}>
            {/* Left cut zone — hatched */}
            <div style={{
              position: 'absolute', top: 0, left: 0, width: `${s}%`, height: '100%',
              background: 'rgba(0,0,0,0.55)',
              backgroundImage: 'repeating-linear-gradient(135deg, transparent, transparent 6px, rgba(255,255,255,0.03) 6px, rgba(255,255,255,0.03) 12px)',
            }} />
            {/* Keep zone fill */}
            <div style={{
              position: 'absolute', top: 0, left: `${s}%`, width: `${e - s}%`, height: '100%',
              background: 'rgba(251,191,36,0.12)',
            }} />
            {/* Right cut zone — hatched */}
            <div style={{
              position: 'absolute', top: 0, left: `${e}%`, right: 0, height: '100%',
              background: 'rgba(0,0,0,0.55)',
              backgroundImage: 'repeating-linear-gradient(135deg, transparent, transparent 6px, rgba(255,255,255,0.03) 6px, rgba(255,255,255,0.03) 12px)',
            }} />
            {/* Tick marks */}
            {ticks.map((t) => (
              <div key={t} style={{
                position: 'absolute', top: 0,
                left: `${(t / duration) * 100}%`,
                width: 1, height: '100%',
                background: 'rgba(255,255,255,0.08)',
                pointerEvents: 'none',
              }} />
            ))}
            {/* Playhead line */}
            <div style={{
              position: 'absolute', top: 0,
              left: `${ct}%`,
              transform: 'translateX(-50%)',
              width: 2, height: '100%',
              background: 'rgba(255,255,255,0.92)',
              boxShadow: '0 0 6px rgba(255,255,255,0.4)',
              pointerEvents: 'none',
              zIndex: 4,
            }} />
          </div>

          {/* ── Amber top+bottom rails for keep zone ───────────── */}
          <div style={{
            position: 'absolute',
            top: OVERHANG, left: `${s}%`, width: `${e - s}%`, height: TRACK_H,
            borderTop: '2px solid var(--mz-amber)',
            borderBottom: '2px solid var(--mz-amber)',
            pointerEvents: 'none',
            zIndex: 2,
            boxSizing: 'border-box',
          }} />

          {/* ── Playhead head (circle) ─────────────────────────── */}
          <div style={{
            position: 'absolute',
            top: OVERHANG - 5,
            left: `${ct}%`,
            transform: 'translateX(-50%)',
            width: 10, height: 10, borderRadius: '50%',
            background: '#fff',
            border: '2px solid rgba(255,255,255,0.6)',
            boxShadow: '0 1px 4px rgba(0,0,0,0.6)',
            pointerEvents: 'none',
            zIndex: 5,
          }} />

          {/* Current time badge — only when dragging seek */}
          {dragTip?.which === 'seek' && (
            <div style={{
              position: 'absolute',
              bottom: OVERHANG + TRACK_H + 4,
              left: `${ct}%`,
              transform: 'translateX(-50%)',
              background: 'rgba(0,0,0,0.85)',
              color: '#fff',
              fontSize: 10,
              fontFamily: 'monospace',
              padding: '2px 6px',
              borderRadius: 4,
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              zIndex: 8,
            }}>
              {fmtTime(currentTime)}
            </div>
          )}

          {/* ── Start handle ───────────────────────────────────── */}
          <button
            type="button" aria-label="Trim start"
            onMouseDown={makeDrag('start')}
            onTouchStart={makeDrag('start')}
            onMouseEnter={() => setHovered('start')}
            onMouseLeave={() => setHovered(null)}
            style={{
              position: 'absolute',
              top: OVERHANG,
              left: `${s}%`,
              transform: 'translateX(-100%)',
              width: HANDLE_W, height: TRACK_H,
              borderRadius: '5px 0 0 5px',
              background: hovered === 'start' || dragTip?.which === 'start'
                ? '#fcd34d'
                : 'var(--mz-amber)',
              cursor: 'col-resize', zIndex: 6,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: 'none', padding: 0,
              boxShadow: '-3px 0 10px rgba(0,0,0,0.5)',
              transition: 'background 0.1s',
            }}
          >
            <GripLines />
            {/* Live time tooltip */}
            {(dragTip?.which === 'start' || hovered === 'start') && (
              <div style={{
                position: 'absolute', bottom: '100%', left: '50%',
                transform: 'translateX(-50%)',
                marginBottom: 5,
                background: 'var(--mz-amber)',
                color: 'rgba(0,0,0,0.8)',
                fontSize: 10, fontFamily: 'monospace', fontWeight: 700,
                padding: '2px 7px', borderRadius: 4,
                whiteSpace: 'nowrap',
                boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
              }}>
                {fmtTime(dragTip?.which === 'start' ? dragTip.time : start)}
              </div>
            )}
          </button>

          {/* ── End handle ─────────────────────────────────────── */}
          <button
            type="button" aria-label="Trim end"
            onMouseDown={makeDrag('end')}
            onTouchStart={makeDrag('end')}
            onMouseEnter={() => setHovered('end')}
            onMouseLeave={() => setHovered(null)}
            style={{
              position: 'absolute',
              top: OVERHANG,
              left: `${e}%`,
              width: HANDLE_W, height: TRACK_H,
              borderRadius: '0 5px 5px 0',
              background: hovered === 'end' || dragTip?.which === 'end'
                ? '#fcd34d'
                : 'var(--mz-amber)',
              cursor: 'col-resize', zIndex: 6,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              border: 'none', padding: 0,
              boxShadow: '3px 0 10px rgba(0,0,0,0.5)',
              transition: 'background 0.1s',
            }}
          >
            <GripLines />
            {/* Live time tooltip */}
            {(dragTip?.which === 'end' || hovered === 'end') && (
              <div style={{
                position: 'absolute', bottom: '100%', left: '50%',
                transform: 'translateX(-50%)',
                marginBottom: 5,
                background: 'var(--mz-amber)',
                color: 'rgba(0,0,0,0.8)',
                fontSize: 10, fontFamily: 'monospace', fontWeight: 700,
                padding: '2px 7px', borderRadius: 4,
                whiteSpace: 'nowrap',
                boxShadow: '0 2px 6px rgba(0,0,0,0.4)',
              }}>
                {fmtTime(dragTip?.which === 'end' ? dragTip.time : end)}
              </div>
            )}
          </button>
        </div>

        {/* ── Tick labels ────────────────────────────────────── */}
        <div style={{ position: 'relative', height: 14, marginTop: 2 }}>
          {/* Total duration at far right */}
          <span style={{
            position: 'absolute', right: 0,
            fontSize: 9, fontFamily: 'monospace', color: 'rgba(255,255,255,0.25)',
            whiteSpace: 'nowrap',
          }}>{fmtTime(duration)}</span>
          {/* 0 at far left */}
          <span style={{
            position: 'absolute', left: 0,
            fontSize: 9, fontFamily: 'monospace', color: 'rgba(255,255,255,0.25)',
          }}>0</span>
          {ticks.map((t) => (
            <span key={t} style={{
              position: 'absolute', left: `${(t / duration) * 100}%`,
              transform: 'translateX(-50%)',
              fontSize: 9, fontFamily: 'monospace', color: 'rgba(255,255,255,0.2)',
              whiteSpace: 'nowrap',
            }}>{fmtTime(t)}</span>
          ))}
        </div>
      </div>

      {/* ── Summary bar ────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '6px 0 0',
        fontSize: 10, fontFamily: 'monospace',
      }}>
        <span style={{ color: 'var(--mz-amber)', fontWeight: 600 }}>
          {fmtTime(start)}
        </span>
        <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.08)' }} />
        <span style={{ color: 'rgba(255,255,255,0.45)' }}>
          {fmtTime(end - start)} selected
        </span>
        <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.08)' }} />
        <span style={{ color: 'var(--mz-amber)', fontWeight: 600 }}>
          {fmtTime(end)}
        </span>
      </div>
    </div>
  )
}

// HEVC => libx264 HQ  (libx265 not in standard @ffmpeg/core WASM build)
// AV1  => libvpx-vp9 best  (libaom-av1 not in standard WASM build)
const VIDEO_FORMATS: { value: VideoFormat; label: string; desc: string; ext: string }[] = [
  { value: 'mp4',  label: 'MP4',  desc: 'H.264',    ext: 'mp4'  },
  { value: 'webm', label: 'WebM', desc: 'VP8',        ext: 'webm' },
  { value: 'hevc', label: 'HEVC', desc: 'x264 HQ',   ext: 'mp4'  },
  { value: 'av1',  label: 'AV1',  desc: 'VP9 best',  ext: 'webm' },
  { value: 'mov',  label: 'MOV',  desc: 'QuickTime', ext: 'mov'  },
  { value: 'mkv',  label: 'MKV',  desc: 'Matroska',  ext: 'mkv'  },
  { value: 'gif',  label: 'GIF',  desc: 'Animated',  ext: 'gif'  },
]

const ASPECT_SCALES: { label: string; value: string | null }[] = [
  { label: 'Original', value: null        },
  { label: '16:9',     value: '-2:720'    },
  { label: '4:3',      value: '-2:480'    },
  { label: '1:1',      value: '720:720'   },
  { label: '9:16',     value: '720:-2'    },
  { label: '720p',     value: '1280:720'  },
  { label: '1080p',    value: '1920:1080' },
  { label: '480p',     value: '854:480'   },
]

const PRESETS  = ['ultrafast', 'fast', 'medium', 'slow', 'veryslow']
const AUDIO_BITRATES = ['64k', '96k', '128k', '192k', '256k', '320k']

function VideoStudio() {
  // ── File queue ───────────────────────────────────────────────────────────
  const [entries, setEntries] = useState<VideoFileEntry[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)

  // ── Global conversion settings ───────────────────────────────────────────
  const [selectedFormats, setSelectedFormats] = useState<VideoFormat[]>(['mp4'])
  const [crf, setCrf]                   = useState(23)
  const [removeAudio, setRemoveAudio]   = useState(false)
  const [audioBitrate, setAudioBitrate] = useState('128k')
  const [scale, setScale]               = useState<string | null>(null)
  const [preset, setPreset]             = useState('medium')

  // ── FFmpeg ───────────────────────────────────────────────────────────────
  const [ffmpegLoaded, setFfmpegLoaded]   = useState(false)
  const [ffmpegLoading, setFfmpegLoading] = useState(false)
  const [loadError, setLoadError]         = useState<string | null>(null)

  // ── Refs ─────────────────────────────────────────────────────────────────
  const videoRef       = useRef<HTMLVideoElement>(null)
  const addMoreRef     = useRef<HTMLInputElement>(null)
  // per-entry results map (avoids stale closures in parallel format processing)
  const entryResultsRef = useRef<Map<string, VideoResult[]>>(new Map())
  // timeline current time (active entry only)
  const [currentTime, setCurrentTime] = useState(0)

  // ── Active entry ─────────────────────────────────────────────────────────
  const activeEntry = useMemo(
    () => entries.find((e) => e.id === activeId) ?? null,
    [entries, activeId],
  )

  // ── FFmpeg load ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (ffmpegLoaded || ffmpegLoading) return
    setFfmpegLoading(true)
    setLoadError(null)
    loadFFmpeg()
      .then(() => setFfmpegLoaded(true))
      .catch((e) => setLoadError(e instanceof Error ? e.message : 'Failed to load FFmpeg'))
      .finally(() => setFfmpegLoading(false))
  }, [ffmpegLoaded, ffmpegLoading])

  // ── Cleanup on unmount ───────────────────────────────────────────────────
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => {
    setEntries((prev) => {
      for (const e of prev) {
        URL.revokeObjectURL(e.fileUrl)
        for (const r of e.results) URL.revokeObjectURL(r.url)
      }
      return []
    })
  }, [])

  // ── Helpers ──────────────────────────────────────────────────────────────
  function updateEntry(id: string, updates: Partial<VideoFileEntry>) {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...updates } : e)))
  }

  function makeEntry(file: File): VideoFileEntry {
    const id      = Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
    const fileUrl = URL.createObjectURL(file)
    // generate thumbnail asynchronously
    const thumb = document.createElement('video')
    thumb.preload = 'metadata'; thumb.muted = true; thumb.playsInline = true
    thumb.src = fileUrl
    const capture = () => {
      try {
        const c = document.createElement('canvas')
        c.width = thumb.videoWidth || 640; c.height = thumb.videoHeight || 360
        c.getContext('2d')?.drawImage(thumb, 0, 0, c.width, c.height)
        updateEntry(id, { poster: c.toDataURL('image/jpeg', 0.7) })
      } catch { /* ignore */ } finally { thumb.src = '' }
    }
    thumb.addEventListener('seeked', capture, { once: true })
    thumb.addEventListener('loadedmetadata', () => {
      thumb.currentTime = Math.min(1, (thumb.duration * 0.1) || 0)
    }, { once: true })
    thumb.addEventListener('error', () => { thumb.src = '' }, { once: true })
    return {
      id, file, fileUrl, poster: null, videoError: false, videoDuration: 0,
      trimEnabled: false, trimStart: 0, trimEnd: 0,
      results: [], errors: {}, formatProgress: {}, processing: false,
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleFiles = useCallback((files: File[]) => {
    const newEntries = files.map((f) => makeEntry(f))
    setEntries((prev) => {
      if (prev.length === 0) setActiveId(newEntries[0]?.id ?? null)
      return [...prev, ...newEntries]
    })
  }, [])

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const handleAddMore = useCallback((files: File[]) => {
    const newEntries = files.map((f) => makeEntry(f))
    setEntries((prev) => [...prev, ...newEntries])
    setActiveId((prev) => prev ?? newEntries[0]?.id ?? null)
  }, [])

  const handleSeek = useCallback((t: number) => {
    if (videoRef.current) { videoRef.current.currentTime = t; setCurrentTime(t) }
  }, [])

  function handleRemoveEntry(id: string) {
    setEntries((prev) => {
      const target = prev.find((e) => e.id === id)
      if (target) {
        URL.revokeObjectURL(target.fileUrl)
        for (const r of target.results) URL.revokeObjectURL(r.url)
      }
      const next = prev.filter((e) => e.id !== id)
      if (activeId === id) {
        const idx = prev.findIndex((e) => e.id === id)
        setActiveId((next[idx] ?? next[idx - 1] ?? next[0] ?? null)?.id ?? null)
      }
      return next
    })
  }

  function toggleFormat(fmt: VideoFormat) {
    setSelectedFormats((prev) =>
      prev.includes(fmt)
        ? prev.length === 1 ? prev : prev.filter((f) => f !== fmt)
        : [...prev, fmt],
    )
  }

  async function handleProcess(entryId: string) {
    const snap = entries.find((e) => e.id === entryId)
    if (!snap || !ffmpegLoaded || selectedFormats.length === 0 || snap.processing) return
    for (const r of snap.results) URL.revokeObjectURL(r.url)
    entryResultsRef.current.set(entryId, [])
    setEntries((prev) => prev.map((e) => e.id === entryId ? {
      ...e, processing: true, results: [], errors: {},
      formatProgress: Object.fromEntries(selectedFormats.map((f) => [f, 1])),
    } : e))

    await Promise.allSettled(
      selectedFormats.map(async (fmt) => {
        const fmtDef = VIDEO_FORMATS.find((f) => f.value === fmt)!
        try {
          const blob = await processVideo(
            snap.file,
            {
              format: fmt, crf, removeAudio,
              audioBitrate: removeAudio ? undefined : audioBitrate,
              scale: scale ?? undefined, preset,
              trimStart: snap.trimEnabled ? snap.trimStart : undefined,
              trimEnd:   snap.trimEnabled ? snap.trimEnd   : undefined,
            },
            (p) => setEntries((prev) => prev.map((e) => e.id === entryId ? {
              ...e, formatProgress: { ...e.formatProgress, [fmt]: Math.max(1, Math.round(p * 100)) },
            } : e)),
          )
          const result: VideoResult = { blob, url: URL.createObjectURL(blob), format: fmt, ext: fmtDef.ext }
          const cur = entryResultsRef.current.get(entryId) ?? []
          const upd = [...cur, result]
          entryResultsRef.current.set(entryId, upd)
          setEntries((prev) => prev.map((e) => e.id === entryId ? {
            ...e, results: upd, formatProgress: { ...e.formatProgress, [fmt]: 100 },
          } : e))
        } catch (err) {
          setEntries((prev) => prev.map((e) => e.id === entryId ? {
            ...e,
            errors: { ...e.errors, [fmt]: err instanceof Error ? err.message : 'Failed' },
            formatProgress: { ...e.formatProgress, [fmt]: -1 },
          } : e))
        }
      }),
    )
    setEntries((prev) => prev.map((e) => e.id === entryId ? { ...e, processing: false } : e))
  }

  async function handleProcessAll() {
    for (const entry of entries) {
      if (!entry.processing) await handleProcess(entry.id)
    }
  }

  function handleReset() {
    for (const e of entries) {
      URL.revokeObjectURL(e.fileUrl)
      for (const r of e.results) URL.revokeObjectURL(r.url)
    }
    entryResultsRef.current.clear()
    setEntries([]); setActiveId(null)
  }

  function handleDownload(r: VideoResult, entry: VideoFileEntry) {
    const base   = entry.file.name.replace(/\.[^.]+$/, '')
    const suffix = selectedFormats.length > 1 ? `-${r.format}` : ''
    const a = document.createElement('a')
    a.href = r.url; a.download = `${base}-mz${suffix}.${r.ext}`; a.click()
  }

  function handleDownloadAllFormats(entry: VideoFileEntry) {
    entry.results.forEach((r, i) => setTimeout(() => handleDownload(r, entry), i * 150))
  }

  // ── Derived values for active entry display ──────────────────────────────
  const file           = activeEntry?.file ?? null
  const fileUrl        = activeEntry?.fileUrl ?? null
  const results        = activeEntry?.results ?? []
  const errors         = activeEntry?.errors ?? {}
  const formatProgress = activeEntry?.formatProgress ?? {}
  const processing     = activeEntry?.processing ?? false
  const videoError     = activeEntry?.videoError ?? false
  const poster         = activeEntry?.poster ?? null
  const videoDuration  = activeEntry?.videoDuration ?? 0
  const trimEnabled    = activeEntry?.trimEnabled ?? false
  const trimStart      = activeEntry?.trimStart ?? 0
  const trimEnd        = activeEntry?.trimEnd ?? 0

  const fmtProgressValues = Object.values(formatProgress).filter((v) => (v ?? -1) >= 0)
  const overallProgress   = fmtProgressValues.length
    ? Math.round(fmtProgressValues.reduce((a, b) => a + (b ?? 0), 0) / selectedFormats.length)
    : 0

  const previewUrl    = results.length > 0 ? results[results.length - 1].url : fileUrl
  const previewMime   = results.length > 0 ? results[results.length - 1].blob.type : (file?.type ?? '')
  const errorList     = Object.entries(errors) as [VideoFormat, string][]
  const anyProcessing = entries.some((e) => e.processing)

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="mz-app flex flex-col min-h-screen">
      <div className="mz-topbar">
        <a href="/media" className="flex items-center gap-1.5 no-underline"
          style={{ color: 'var(--mz-text-2)' }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--mz-text)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--mz-text-2)' }}
        >
          <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          <span className="text-xs">Media</span>
        </a>
        <span className="text-xs" style={{ color: 'var(--mz-border-2)' }}>/</span>
        <span className="text-xs font-semibold" style={{ color: 'var(--mz-text)' }}>Video Studio</span>
        {file && (
          <>
            <span className="text-xs" style={{ color: 'var(--mz-border-2)' }}>·</span>
            <span className="mz-mono truncate max-w-40" style={{ color: 'var(--mz-text-2)', fontSize: '11px' }}>{file.name}</span>
            <span className="mz-badge">{formatBytes(file.size)}</span>
          </>
        )}
        {entries.length > 1 && (
          <span className="mz-badge" style={{ background: 'var(--mz-amber)', color: 'rgba(0,0,0,0.75)' }}>
            {entries.length} files
          </span>
        )}
        <div className="flex-1" />
        <span className="mz-badge">FFmpeg · WASM</span>
      </div>

      {entries.length === 0 ? (
        /* ── Drop zone ── */
        <div className="flex flex-1 items-center justify-center px-6 py-12">
          <div className="w-full max-w-sm">
            <p className="mz-label mb-3">Video Studio</p>
            <h1 className="mb-2 text-[30px] font-light tracking-tight leading-none" style={{ color: 'var(--mz-text)' }}>
              Drop videos
            </h1>
            <p className="mb-8 text-sm" style={{ color: 'var(--mz-text-2)' }}>
              Convert, compress, strip audio and export to multiple formats in parallel — entirely in your browser. Drop multiple files to batch process.
            </p>
            {loadError && (
              <div className="mb-4 flex items-center gap-2.5 rounded-md px-3 py-2.5 text-xs"
                style={{
                  border: '1px solid var(--mz-error)',
                  background: 'rgba(255,82,82,0.06)',
                  color: 'var(--mz-error)',
                }}
              >
                {loadError}
              </div>
            )}
            <DropZone
              accept={['video/*', '.mp4', '.webm', '.mov', '.avi', '.mkv']}
              onFiles={handleFiles}
              multiple
              label="Drop videos here"
              sublabel="MP4, WebM, MOV, AVI, MKV · multiple files ok"
            />
          </div>
        </div>
      ) : (
        /* ── Workspace ── */
        <div className="flex flex-1 overflow-hidden">
          {/* ── Preview column ── */}
          <div className="flex min-w-0 flex-1 flex-col overflow-y-auto p-4 gap-3">
            <div className="mz-well overflow-hidden relative">
              {videoError ? (
                <div className="flex flex-col items-center justify-center gap-2 rounded-sm"
                  style={{ minHeight: 180, background: '#111', color: 'rgba(255,255,255,0.45)', fontSize: 13 }}>
                  <span style={{ fontSize: 28 }}>⚠️</span>
                  <span>This format cannot be previewed in your browser.</span>
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>
                    {previewMime || file?.name} · Convert to MP4 for in-browser playback
                  </span>
                </div>
              ) : (
                <>
                  <video key={previewUrl ?? ''} ref={videoRef} controls
                    poster={poster ?? undefined}
                    className="block w-full rounded-sm" style={{ maxHeight: '58vh', background: '#000' }}
                    onLoadedMetadata={() => {
                      if (!videoRef.current || !activeEntry) return
                      const dur = videoRef.current.duration
                      if (Number.isFinite(dur) && dur > 0) {
                        updateEntry(activeEntry.id, { videoDuration: dur, trimEnd: dur })
                      }
                    }}
                    onTimeUpdate={() => { if (videoRef.current) setCurrentTime(videoRef.current.currentTime) }}
                    onError={() => { if (activeEntry) updateEntry(activeEntry.id, { videoError: true }) }}
                  >
                    {previewUrl && <source src={previewUrl} type={previewMime || undefined} />}
                  </video>

                  {/* Trim timeline overlay */}
                  {trimEnabled && videoDuration > 0 && activeEntry && (
                    <div style={{
                      padding: '10px 12px 8px',
                      background: 'rgba(0,0,0,0.72)',
                      backdropFilter: 'blur(6px)',
                      borderTop: '1px solid rgba(255,255,255,0.06)',
                    }}>
                      <div className="flex items-center justify-between mb-2">
                        <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.45)' }}>Trim range</span>
                        <button
                          type="button"
                          onClick={() => updateEntry(activeEntry.id, { trimStart: 0, trimEnd: videoDuration })}
                          style={{ fontSize: '10px', color: 'rgba(255,255,255,0.35)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                          onMouseEnter={(ev) => { ev.currentTarget.style.color = 'rgba(255,255,255,0.7)' }}
                          onMouseLeave={(ev) => { ev.currentTarget.style.color = 'rgba(255,255,255,0.35)' }}
                        >Reset</button>
                      </div>
                      <VideoTrimTimeline
                        duration={videoDuration}
                        start={trimStart}
                        end={trimEnd}
                        currentTime={currentTime}
                        onStartChange={(v) => { updateEntry(activeEntry.id, { trimStart: v }); handleSeek(v) }}
                        onEndChange={(v) => updateEntry(activeEntry.id, { trimEnd: v })}
                        onSeek={handleSeek}
                      />
                    </div>
                  )}
                </>
              )}

              {/* Processing overlay */}
              {processing && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 rounded-sm"
                  style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}>
                  <div className="flex flex-col items-center gap-1">
                    <span className="mz-mono" style={{ fontSize: 32, fontWeight: 600, color: 'var(--mz-amber)', lineHeight: 1 }}>
                      {overallProgress > 0 ? `${overallProgress}%` : '···'}
                    </span>
                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>
                      {selectedFormats.length > 1 ? 'Converting in parallel...' : 'Converting...'}
                    </span>
                  </div>

                  {/* Per-format mini progress bars */}
                  <div className="flex flex-col gap-2" style={{ width: 220 }}>
                    {selectedFormats.map((fmt) => {
                      const fmtDef = VIDEO_FORMATS.find((f) => f.value === fmt)!
                      const p      = formatProgress[fmt] ?? 0
                      const done   = p >= 100
                      const failed = p === -1
                      return (
                        <div key={fmt} className="flex items-center gap-2">
                          <span className="mz-mono shrink-0" style={{ fontSize: 10, color: done ? 'var(--mz-amber)' : failed ? 'var(--mz-error)' : 'rgba(255,255,255,0.6)', width: 40 }}>
                            {fmtDef.label}
                          </span>
                          <div className="flex-1 rounded-full overflow-hidden" style={{ height: 3, background: 'rgba(255,255,255,0.12)' }}>
                            {failed ? (
                              <div className="h-full rounded-full" style={{ width: '100%', background: 'var(--mz-error)' }} />
                            ) : p >= 3 ? (
                              <div className="h-full rounded-full transition-all duration-200"
                                style={{ width: `${p}%`, background: done ? 'var(--mz-amber)' : 'rgba(251,191,36,0.7)' }} />
                            ) : (
                              <div className="h-full rounded-full"
                                style={{ width: '35%', background: 'rgba(251,191,36,0.5)', animation: 'mz-indeterminate 1.4s ease-in-out infinite' }} />
                            )}
                          </div>
                          <span className="mz-mono shrink-0" style={{ fontSize: 10, color: done ? 'var(--mz-amber)' : 'rgba(255,255,255,0.3)', width: 26, textAlign: 'right' }}>
                            {done ? '✓' : failed ? '✗' : p > 0 ? `${p}%` : ''}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="mz-mono truncate max-w-[200px]" style={{ color: 'var(--mz-text)', fontSize: '11px' }}>{file?.name}</span>
                {file && <span className="mz-mono" style={{ color: 'var(--mz-text-2)', fontSize: '11px' }}>{formatBytes(file.size)}</span>}
                {results.length === 1 && file && (
                  <span className="ml-auto flex items-center gap-2">
                    <span className="mz-mono" style={{ color: 'var(--mz-amber)', fontSize: '11px' }}>
                      {'→'} {formatBytes(results[0].blob.size)}
                    </span>
                    {results[0].blob.size < file.size && (
                      <span className="mz-badge mz-badge-amber">
                        -{Math.round((1 - results[0].blob.size / file.size) * 100)}%
                      </span>
                    )}
                  </span>
                )}
              </div>
            </div>

            {/* Errors */}
            {errorList.length > 0 && (
              <div className="flex flex-col gap-1">
                {errorList.map(([fmt, msg]) => (
                  <div key={fmt} className="rounded-md px-3 py-2 text-xs"
                    style={{ border: '1px solid var(--mz-error)', color: 'var(--mz-error)', background: 'rgba(255,82,82,0.08)' }}>
                    {fmt.toUpperCase()}: {msg}
                  </div>
                ))}
              </div>
            )}

            {/* Outputs for active file */}
            {results.length > 0 && (
              <div className="mz-well">
                <div className="flex items-center justify-between mb-2">
                  <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--mz-text-2)' }}>
                    Output{results.length > 1 ? 's' : ''}
                    {processing && results.length < selectedFormats.length && (
                      <span style={{ opacity: 0.5, fontWeight: 400, marginLeft: 6 }}>
                        {results.length}/{selectedFormats.length}
                      </span>
                    )}
                  </span>
                  {results.length > 1 && !processing && activeEntry && (
                    <button type="button" onClick={() => handleDownloadAllFormats(activeEntry)}
                      className="mz-btn mz-btn-ghost" style={{ padding: '4px 10px', fontSize: '11px', gap: 4 }}>
                      <svg aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                        <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                      </svg>
                      Download all
                    </button>
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  {results.map((r) => {
                    const fmtDef = VIDEO_FORMATS.find((f) => f.value === r.format)!
                    const saved  = file && file.size > 0 ? Math.round((1 - r.blob.size / file.size) * 100) : 0
                    return (
                      <div key={r.format} className="flex items-center gap-3 rounded-md px-3 py-2"
                        style={{ background: 'var(--mz-surface-2)', border: '1px solid var(--mz-border)' }}>
                        <span className="font-semibold text-xs" style={{ color: 'var(--mz-text)', minWidth: 40 }}>{fmtDef.label}</span>
                        <span className="opacity-40 text-[10px]">{fmtDef.desc}</span>
                        <span className="mz-mono text-[11px]" style={{ color: 'var(--mz-text-2)' }}>{formatBytes(r.blob.size)}</span>
                        {saved > 0 && <span className="mz-badge mz-1badge-amber">-{saved}%</span>}
                        <div className="flex-1" />
                        {activeEntry && (
                          <button type="button" onClick={() => handleDownload(r, activeEntry)}
                            className="mz-btn mz-btn-ghost" style={{ padding: '4px 10px', fontSize: '11px', gap: 4 }}>
                            <svg aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                              <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                            </svg>
                            .{r.ext}
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {/* ── Sidebar ── */}
          <div className="flex w-72 shrink-0 flex-col overflow-y-auto border-l px-4 pt-4 pb-3 xl:w-80"
            style={{ borderColor: 'var(--mz-border)', background: 'var(--mz-surface)' }}>

            {/* ── File queue ── */}
            <Section
              title={entries.length > 1 ? `Queue · ${entries.length} files` : 'File'}
              badge={
                entries.filter((e) => e.results.length > 0).length > 0
                  ? `${entries.filter((e) => e.results.length > 0).length}/${entries.length} done`
                  : undefined
              }
            >
              <div className="flex flex-col gap-1 mb-2">
                {entries.map((entry) => {
                  const isActive = entry.id === activeId
                  const ep = Object.values(entry.formatProgress).filter((v) => (v ?? -1) >= 0)
                  const epPct = ep.length
                    ? Math.round(ep.reduce((a, b) => a + (b ?? 0), 0) / selectedFormats.length)
                    : 0
                  return (
                    <div
                      key={entry.id}
                      className="flex items-center gap-2 rounded-md px-2 py-1.5 cursor-pointer"
                      style={{
                        background: isActive ? 'var(--mz-surface-2)' : 'transparent',
                        border: `1px solid ${isActive ? 'var(--mz-border-2)' : 'transparent'}`,
                        transition: 'background 0.1s',
                      }}
                      onClick={() => { setActiveId(entry.id); setCurrentTime(0) }}
                      onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'var(--mz-surface-2)' }}
                      onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
                    >
                      {/* Thumbnail */}
                      <div className="shrink-0 rounded overflow-hidden"
                        style={{ width: 32, height: 18, background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {entry.poster
                          ? <img src={entry.poster} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          : <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                        }
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="mz-mono truncate" style={{ fontSize: '10px', color: isActive ? 'var(--mz-text)' : 'var(--mz-text-2)' }}>
                          {entry.file.name}
                        </p>
                        <p style={{ fontSize: '9px', color: 'var(--mz-text-2)' }}>{formatBytes(entry.file.size)}</p>
                      </div>
                      {entry.processing
                        ? <span className="mz-mono shrink-0" style={{ fontSize: '9px', color: 'var(--mz-amber)' }}>{epPct > 0 ? `${epPct}%` : '···'}</span>
                        : entry.results.length > 0
                          ? <svg aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--mz-amber)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><polyline points="20 6 9 17 4 12"/></svg>
                          : null
                      }
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleRemoveEntry(entry.id) }}
                        className="shrink-0"
                        style={{ color: 'var(--mz-text-2)', background: 'none', border: 'none', cursor: 'pointer', padding: '1px 3px', fontSize: '14px', lineHeight: 1, opacity: 0.5 }}
                        title="Remove"
                        onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = 'var(--mz-error)' }}
                        onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.5'; e.currentTarget.style.color = 'var(--mz-text-2)' }}
                      >×</button>
                    </div>
                  )
                })}
              </div>
              {/* Add more files */}
              <button
                type="button"
                className="mz-btn mz-btn-ghost w-full gap-2"
                style={{ fontSize: '11px', justifyContent: 'center' }}
                onClick={() => addMoreRef.current?.click()}
              >
                <svg aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                Add more files
              </button>
              <input
                ref={addMoreRef}
                type="file"
                accept="video/*,.mp4,.webm,.mov,.avi,.mkv"
                multiple
                className="sr-only"
                onChange={(e) => {
                  const files = Array.from(e.target.files ?? [])
                  if (files.length) handleAddMore(files)
                  e.target.value = ''
                }}
                tabIndex={-1}
              />
            </Section>

            {loadError && (
              <div className="mb-3 flex items-center gap-2 rounded-md px-3 py-2.5 text-xs"
                style={{
                  border: '1px solid var(--mz-error)',
                  background: 'rgba(255,82,82,0.06)',
                  color: 'var(--mz-error)',
                }}>
                {loadError}
              </div>
            )}

            <Section
              title="Output Formats"
              badge={selectedFormats.length > 1 ? `${selectedFormats.length} parallel` : selectedFormats[0]?.toUpperCase()}
            >
              <div className="grid grid-cols-3 gap-1">
                {VIDEO_FORMATS.map((f) => {
                  const isActive = selectedFormats.includes(f.value)
                  return (
                    <button key={f.value} type="button" onClick={() => toggleFormat(f.value)}
                      className={`mz-chip flex-col gap-0.5 py-2 ${isActive ? 'is-active' : ''}`}
                      style={{ fontSize: '11px', position: 'relative' }}>
                      {isActive && selectedFormats.length > 1 && (
                        <span style={{
                          position: 'absolute', top: 3, right: 4,
                          width: 6, height: 6, borderRadius: '50%',
                          background: 'var(--mz-amber)',
                        }} />
                      )}
                      <span className="font-semibold">{f.label}</span>
                      <span className="opacity-40 text-[9px]">{f.desc}</span>
                    </button>
                  )
                })}
              </div>
              <div className="mt-2 space-y-0.5">
                {selectedFormats.length > 1 && (
                  <p style={{ fontSize: '10px', color: 'var(--mz-text-2)' }}>
                    All formats run in parallel · tap to toggle
                  </p>
                )}
                {(selectedFormats.includes('hevc') || selectedFormats.includes('av1')) && (
                  <p style={{ fontSize: '10px', color: 'var(--mz-text-2)', fontStyle: 'italic' }}>
                    * HEVC uses x264 HQ · AV1 uses VP9 best (WASM limit)
                  </p>
                )}
              </div>
            </Section>

            <Section title="Compression" badge={`CRF ${crf}`}>
              <div className="space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="mz-label">Quality (CRF)</span>
                    <span className="mz-mono" style={{ color: 'var(--mz-amber)', fontSize: '11px' }}>
                      {crf < 18 ? 'High' : crf > 28 ? 'Small' : 'Balanced'}
                    </span>
                  </div>
                  <input type="range" min={0} max={51} step={1} value={crf}
                    onChange={(e) => setCrf(Number(e.target.value))}
                    className="mz-slider w-full" />
                  <div className="mt-1 flex justify-between" style={{ fontSize: '10px', color: 'var(--mz-text-2)' }}>
                    <span>Best quality</span><span>Smallest file</span>
                  </div>
                </div>
                {!selectedFormats.every((f) => ['gif', 'webm', 'av1'].includes(f)) && (
                  <div>
                    <p className="mz-label mb-2">Encoding Preset</p>
                    <div className="flex flex-wrap gap-1">
                      {PRESETS.map((p) => (
                        <button key={p} type="button" onClick={() => setPreset(p)}
                          className={`mz-chip ${preset === p ? 'is-active' : ''}`} style={{ fontSize: '11px' }}>
                          {p}
                        </button>
                      ))}
                    </div>
                    <p className="mt-1.5" style={{ fontSize: '10px', color: 'var(--mz-text-2)' }}>Slower = smaller file, same quality</p>
                  </div>
                )}
              </div>
            </Section>

            <Section title="Audio" badge={removeAudio ? 'muted' : audioBitrate}>
              <div className="space-y-3">
                <label className="flex cursor-pointer items-center gap-3">
                  <button type="button" onClick={() => setRemoveAudio((v) => !v)}
                    className={`mz-toggle ${removeAudio ? 'is-on' : ''}`}>
                    <span className="mz-toggle-knob" />
                  </button>
                  <span className="text-xs font-semibold" style={{ color: 'var(--mz-text)' }}>Remove audio track</span>
                </label>
                {!removeAudio && (
                  <div>
                    <p className="mz-label mb-2">Bitrate</p>
                    <div className="flex flex-wrap gap-1">
                      {AUDIO_BITRATES.map((b) => (
                        <button key={b} type="button" onClick={() => setAudioBitrate(b)}
                          className={`mz-chip ${audioBitrate === b ? 'is-active' : ''}`} style={{ fontSize: '11px' }}>
                          {b}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </Section>

            <Section title="Aspect Ratio & Scale" badge={scale ? (ASPECT_SCALES.find((s) => s.value === scale)?.label) : undefined}>
              <div className="grid grid-cols-4 gap-1">
                {ASPECT_SCALES.map((s) => (
                  <button key={s.label} type="button" onClick={() => setScale(s.value ?? null)}
                    className={`mz-chip justify-center ${scale === (s.value ?? null) ? 'is-active' : ''}`}
                    style={{ fontSize: '10px', padding: '4px 4px' }}>
                    {s.label}
                  </button>
                ))}
              </div>
            </Section>

            {/* Trim — per active file */}
            {activeEntry && (
              <Section
                title="Trim"
                badge={trimEnabled && videoDuration > 0 ? `${fmtTime(trimStart)} – ${fmtTime(trimEnd)}` : undefined}
              >
                <div className="space-y-3">
                  <label className="flex cursor-pointer items-center gap-3">
                    <button type="button"
                      onClick={() => updateEntry(activeEntry.id, { trimEnabled: !trimEnabled })}
                      className={`mz-toggle ${trimEnabled ? 'is-on' : ''}`}>
                      <span className="mz-toggle-knob" />
                    </button>
                    <span className="text-xs font-semibold" style={{ color: 'var(--mz-text)' }}>Trim clip</span>
                  </label>
                  {trimEnabled && videoDuration > 0 && (
                    <div className="flex items-center justify-between gap-1 mt-1">
                      <div className="flex flex-col items-start gap-0.5">
                        <span style={{ fontSize: 9, color: 'var(--mz-text-2)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Start</span>
                        <input
                          type="number" min={0} max={trimEnd - 0.25} step={0.1}
                          value={trimStart.toFixed(1)}
                          onChange={(e) => updateEntry(activeEntry.id, { trimStart: Math.max(0, Math.min(+e.target.value, trimEnd - 0.25)) })}
                          className="mz-mono"
                          style={{ width: 56, fontSize: 12, background: 'var(--mz-surface-2)', border: '1px solid var(--mz-border)', borderRadius: 4, padding: '3px 6px', color: 'var(--mz-amber)' }}
                        />
                      </div>
                      <div className="flex flex-col items-center gap-0.5">
                        <span style={{ fontSize: 9, color: 'var(--mz-text-2)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Duration</span>
                        <span className="mz-mono" style={{ fontSize: 12, color: 'var(--mz-text)' }}>{fmtTime(trimEnd - trimStart)}</span>
                      </div>
                      <div className="flex flex-col items-end gap-0.5">
                        <span style={{ fontSize: 9, color: 'var(--mz-text-2)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>End</span>
                        <input
                          type="number" min={trimStart + 0.25} max={videoDuration} step={0.1}
                          value={trimEnd.toFixed(1)}
                          onChange={(e) => updateEntry(activeEntry.id, { trimEnd: Math.min(videoDuration, Math.max(+e.target.value, trimStart + 0.25)) })}
                          className="mz-mono"
                          style={{ width: 56, fontSize: 12, background: 'var(--mz-surface-2)', border: '1px solid var(--mz-border)', borderRadius: 4, padding: '3px 6px', color: 'var(--mz-amber)', textAlign: 'right' }}
                        />
                      </div>
                    </div>
                  )}
                  {trimEnabled && videoDuration === 0 && (
                    <p style={{ fontSize: '10px', color: 'var(--mz-text-2)' }}>Waiting for video metadata…</p>
                  )}
                </div>
              </Section>
            )}

            <div className="flex-1" />

            <div className="flex flex-col gap-1.5">
              {/* Process current file */}
              <button type="button"
                onClick={() => activeEntry && handleProcess(activeEntry.id)}
                disabled={processing || !ffmpegLoaded || !activeEntry}
                className="mz-btn mz-btn-primary gap-1.5"
                style={!processing && ffmpegLoaded ? { background: 'var(--mz-amber)', borderColor: 'var(--mz-amber)', color: 'var(--mz-accent-fg)' } : {}}>
                {processing ? (
                  <>
                    <svg aria-hidden="true" className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" strokeOpacity="0.3"/><path d="M12 2a10 10 0 0 1 10 10"/>
                    </svg>
                    {overallProgress > 0 ? `${overallProgress}%` : 'Processing...'}
                  </>
                ) : (
                  results.length > 0
                    ? `Re-process${selectedFormats.length > 1 ? ` (${selectedFormats.length})` : ''}`
                    : `Process${selectedFormats.length > 1 ? ` ${selectedFormats.length} formats` : ''}`
                )}
              </button>

              {/* Process all files */}
              {entries.length > 1 && (
                <button type="button"
                  onClick={handleProcessAll}
                  disabled={anyProcessing || !ffmpegLoaded}
                  className="mz-btn mz-btn-ghost gap-1.5"
                  style={{ fontSize: '11px' }}>
                  {anyProcessing ? (
                    <>
                      <svg aria-hidden="true" className="animate-spin" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" strokeOpacity="0.3"/><path d="M12 2a10 10 0 0 1 10 10"/>
                      </svg>
                      Processing all...
                    </>
                  ) : (
                    <>
                      <svg aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="5 3 19 12 5 21 5 3"/>
                      </svg>
                      Process all {entries.length} files
                    </>
                  )}
                </button>
              )}

              {processing && (
                <div className="space-y-1">
                  <div className="mz-progress">
                    {overallProgress > 0 ? (
                      <div className="mz-progress-bar transition-all duration-300"
                        style={{ width: `${overallProgress}%`, background: 'var(--mz-amber)' }} />
                    ) : (
                      <div className="mz-progress-bar"
                        style={{ width: '40%', background: 'var(--mz-amber)', animation: 'mz-indeterminate 1.4s ease-in-out infinite' }} />
                    )}
                  </div>
                  <div className="flex justify-between" style={{ fontSize: '10px', color: 'var(--mz-text-2)' }}>
                    <span>
                      {selectedFormats.length > 1
                        ? `${results.length}/${selectedFormats.length} done`
                        : 'Converting...'}
                    </span>
                    {overallProgress > 0 && <span className="mz-mono" style={{ color: 'var(--mz-amber)' }}>{overallProgress}%</span>}
                  </div>
                </div>
              )}

              <button type="button" onClick={handleReset}
                className="text-center transition-colors"
                style={{ fontSize: '11px', color: 'var(--mz-text-2)' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--mz-text)' }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--mz-text-2)' }}>
                Clear all files
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
