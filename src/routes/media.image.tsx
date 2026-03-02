import { removeBackground } from '@imgly/background-removal'
import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CropCanvas, { type CropRect } from '#/components/image/CropCanvas'
import DropZone from '#/components/media/DropZone'
import {
  ASPECT_RATIOS,
  estimateOutputSize,
  formatBytes,
  IMAGE_FORMATS,
  type ImageFormat,
  type ImageOperation,
  processImage,
} from '#/lib/image-processor'

export const Route = createFileRoute('/media/image')({ component: ImageStudio })

type Dims = { width: number; height: number }

type ResultState = {
  blob: Blob
  url: string
  width: number
  height: number
}

type BgUndoState = {
  file: File
  fileUrl: string
  dims: Dims | null
  imgEl: HTMLImageElement | null
  result: ResultState | null
  showResult: boolean
}

type ImageFileEntry = {
  id: string
  file: File
  fileUrl: string
  dims: Dims | null
  imgEl: HTMLImageElement | null
  rotation: number
  cropMode: boolean
  cropRect: CropRect | null
  cropAspect: number | null
  cropRotation: number
  customW: string
  customH: string
  maintainAR: boolean
  targetAspect: number | null
  result: ResultState | null
  error: string | null
  showResult: boolean
  processing: boolean
  progress: number
  bgRemoving: boolean
  bgRemoveProgress: string
  bgFillColor: string
  bgUndo: BgUndoState | null
}

// ─── Section divider ──────────────────────────────────────────────────────────

function Section({
  title,
  badge,
  accent,
  children,
}: {
  title: string
  badge?: string
  accent?: boolean
  children: React.ReactNode
}) {
  return (
    <div
      style={{
        borderBottom: '1px solid var(--mz-border)',
        paddingBottom: 14,
        marginBottom: 14,
      }}
    >
      <div className="flex items-center justify-between mb-2.5">
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: accent ? 'var(--mz-accent)' : 'var(--mz-text-2)',
          }}
        >
          {title}
        </span>
        {badge && (
          <span
            className={`mz-badge ${accent ? 'mz-badge-accent' : ''}`}
          >
            {badge}
          </span>
        )}
      </div>
      {children}
    </div>
  )
}

// ─── Compact icon button ──────────────────────────────────────────────────────

function IconBtn({
  onClick,
  title,
  active,
  children,
}: {
  onClick: () => void
  title: string
  active?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="mz-btn mz-btn-ghost"
      style={{
        padding: '6px 8px',
        ...(active ? { color: 'var(--mz-accent)', borderColor: 'var(--mz-accent-border)' } : {}),
      }}
    >
      {children}
    </button>
  )
}

// ─── Circular rotation dial ───────────────────────────────────────────────────

function RotationDial({
  value,
  onChange,
}: {
  value: number
  onChange: (deg: number) => void
}) {
  const SIZE = 72
  const R = 28
  const CX = SIZE / 2
  const CY = SIZE / 2
  const MIN = -45
  const MAX = 45
  const isDraggingRef = useRef(false)
  const svgRef = useRef<SVGSVGElement>(null)

  // Map value in [-45, 45] to an angle on the dial arc.
  // Arc spans 270° centred at the top (12 o'clock = -π/2).
  // -45 → -π/2 - 3π/4 (bottom-left), +45 → -π/2 + 3π/4 (bottom-right).
  const ARC_HALF = (3 * Math.PI) / 4  // half of 270° arc in radians
  const ARC_MID  = -Math.PI / 2       // 12 o'clock

  function valueToRad(v: number): number {
    return ARC_MID + ((v - MIN) / (MAX - MIN) - 0.5) * 2 * ARC_HALF
  }

  function radToValue(rad: number): number {
    const frac = (rad - (ARC_MID - ARC_HALF)) / (2 * ARC_HALF)
    return MIN + frac * (MAX - MIN)
  }

  // SVG arc path, explicit large-arc and sweep flags
  function arcPath(
    r: number,
    startRad: number,
    endRad: number,
    largeArc: 0 | 1,
    sweep: 0 | 1,
  ): string {
    const x1 = CX + r * Math.cos(startRad)
    const y1 = CY + r * Math.sin(startRad)
    const x2 = CX + r * Math.cos(endRad)
    const y2 = CY + r * Math.sin(endRad)
    return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${largeArc} ${sweep} ${x2.toFixed(2)} ${y2.toFixed(2)}`
  }

  const trackStart = valueToRad(MIN)                // bottom-left
  const trackEnd   = valueToRad(MAX)                // bottom-right
  const zeroRad    = valueToRad(0)                  // top
  const handleRad  = valueToRad(value)
  const hx = CX + R * Math.cos(handleRad)
  const hy = CY + R * Math.sin(handleRad)

  // Background track: 270° CW arc from bottom-left to bottom-right (large-arc=1, sweep=1)
  const trackD = arcPath(R, trackStart, trackEnd, 1, 1)

  // Fill arc: from zero (top) to current value — always ≤135° so large-arc=0
  // CW when positive (sweep=1), CCW when negative (sweep=0)
  const fillD = value !== 0
    ? arcPath(R, zeroRad, handleRad, 0, value > 0 ? 1 : 0)
    : null

  function onPointerDown(e: React.PointerEvent) {
    isDraggingRef.current = true
    ;(e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId)
    updateFromPointer(e)
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!isDraggingRef.current) return
    updateFromPointer(e)
  }

  function onPointerUp(e: React.PointerEvent) {
    isDraggingRef.current = false
    ;(e.currentTarget as SVGSVGElement).releasePointerCapture(e.pointerId)
  }

  function updateFromPointer(e: React.PointerEvent) {
    if (!svgRef.current) return
    const rect = svgRef.current.getBoundingClientRect()
    const scaleX = SIZE / rect.width
    const scaleY = SIZE / rect.height
    const dx = (e.clientX - rect.left) * scaleX - CX
    const dy = (e.clientY - rect.top)  * scaleY - CY
    let angle = Math.atan2(dy, dx)

    const arcStart = ARC_MID - ARC_HALF  // -225° = -5π/4
    const arcEnd   = ARC_MID + ARC_HALF  // -45°  = -π/4 ... in +ve rotation: +135°

    // Normalise into the valid arc window
    while (angle < arcStart - 0.01) angle += 2 * Math.PI
    while (angle > arcEnd   + 0.01) angle -= 2 * Math.PI

    const clamped = Math.max(arcStart, Math.min(arcEnd, angle))
    onChange(Math.round(radToValue(clamped) * 2) / 2)   // 0.5° steps
  }

  // Ticks at every 15°
  const ticks = [-45, -30, -15, 0, 15, 30, 45]

  return (
    <div className="flex flex-1 items-center gap-3 min-w-0">
      {/* Dial wheel */}
      <svg
        ref={svgRef}
        role="img"
        aria-label={`Rotation dial, current angle ${value}°`}
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        style={{ flexShrink: 0, cursor: 'grab', touchAction: 'none', userSelect: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {/* Background track */}
        <path d={trackD} fill="none" stroke="var(--mz-border-2)" strokeWidth="3.5" strokeLinecap="round" />

        {/* Filled segment */}
        {fillD && (
          <path d={fillD} fill="none" stroke="var(--mz-accent)" strokeWidth="3.5" strokeLinecap="round" />
        )}

        {/* Tick marks */}
        {ticks.map((t) => {
          const ta = valueToRad(t)
          const len  = t === 0 ? 5 : 3
          const inner = R - len
          return (
            <line
              key={t}
              x1={(CX + inner * Math.cos(ta)).toFixed(2)}
              y1={(CY + inner * Math.sin(ta)).toFixed(2)}
              x2={(CX + (R + 1) * Math.cos(ta)).toFixed(2)}
              y2={(CY + (R + 1) * Math.sin(ta)).toFixed(2)}
              stroke={t === 0 ? 'var(--mz-accent)' : 'var(--mz-text-2)'}
              strokeWidth={t === 0 ? 1.5 : 0.75}
              strokeLinecap="round"
              opacity={t === 0 ? 0.9 : 0.45}
            />
          )
        })}

        {/* Handle dot */}
        <circle cx={hx.toFixed(2)} cy={hy.toFixed(2)} r="5" fill="var(--mz-accent)" stroke="var(--mz-surface)" strokeWidth="1.5" />

        {/* Centre readout */}
        <text
          x={CX} y={CY + 1}
          textAnchor="middle" dominantBaseline="middle"
          fill={value !== 0 ? 'var(--mz-accent)' : 'var(--mz-text-2)'}
          style={{ fontSize: 10, fontFamily: 'IBM Plex Mono, monospace', fontWeight: 600 }}
        >
          {value > 0 ? `+${value}` : value}°
        </text>
      </svg>

      {/* Slider ruler */}
      <div className="flex-1 flex flex-col gap-1 min-w-0">
        <input
          type="range"
          min={MIN}
          max={MAX}
          step={0.5}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="mz-slider w-full"
        />
        <div className="flex justify-between pointer-events-none" style={{ paddingLeft: 4, paddingRight: 4 }}>
          {[-45, -30, -15, 0, 15, 30, 45].map((t) => (
            <span
              key={t}
              style={{
                fontSize: 8,
                fontFamily: 'IBM Plex Mono, monospace',
                color: t === 0 ? 'var(--mz-accent)' : 'var(--mz-text-2)',
                opacity: t === 0 ? 0.9 : 0.4,
                lineHeight: 1,
              }}
            >
              {t === 0 ? '0' : `${t > 0 ? '+' : ''}${t}`}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

function ImageStudio() {
  // ── File queue ───────────────────────────────────────────────────────────
  const [entries, setEntries] = useState<ImageFileEntry[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)

  // ── Global settings ──────────────────────────────────────────────────────
  const [format, setFormat] = useState<ImageFormat>('image/webp')
  const [quality, setQuality] = useState(0.85)

  // ── Refs ─────────────────────────────────────────────────────────────────
  const liveCanvasRef  = useRef<HTMLCanvasElement>(null)
  const imgElRef       = useRef<HTMLImageElement | null>(null)
  const addMoreRef     = useRef<HTMLInputElement>(null)
  const prevResultUrls = useRef<Map<string, string>>(new Map())

  // ── Active entry ─────────────────────────────────────────────────────────
  const activeEntry = useMemo(
    () => entries.find((e) => e.id === activeId) ?? null,
    [entries, activeId],
  )

  // Sync imgElRef to active entry's loaded image
  useEffect(() => { imgElRef.current = activeEntry?.imgEl ?? null }, [activeEntry])

  // Cleanup on unmount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => () => {
    setEntries((prev) => {
      for (const e of prev) {
        URL.revokeObjectURL(e.fileUrl)
        if (e.result?.url) URL.revokeObjectURL(e.result.url)
        if (e.bgUndo?.fileUrl) URL.revokeObjectURL(e.bgUndo.fileUrl)
      }
      return []
    })
  }, [])

  // ── Helpers ──────────────────────────────────────────────────────────────
  function updateEntry(id: string, updates: Partial<ImageFileEntry>) {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, ...updates } : e)))
  }

  function updateActive(updates: Partial<ImageFileEntry>) {
    if (activeId) updateEntry(activeId, updates)
  }

  // ── drawLivePreview ──────────────────────────────────────────────────────
  const drawLivePreview = useCallback(() => {
    const canvas = liveCanvasRef.current
    const img = imgElRef.current
    if (!canvas || !img || !activeEntry?.dims) return
    const { dims, cropMode, cropRect, targetAspect, rotation, cropRotation } = activeEntry

    let srcX = 0, srcY = 0, srcW = dims.width, srcH = dims.height
    if (cropMode && cropRect && cropRect.width > 0 && cropRect.height > 0) {
      srcX = cropRect.x; srcY = cropRect.y; srcW = cropRect.width; srcH = cropRect.height
    } else if (targetAspect) {
      const imgAspect = dims.width / dims.height
      if (targetAspect > imgAspect) { srcW = dims.width; srcH = dims.width / targetAspect; srcY = (dims.height - srcH) / 2 }
      else { srcH = dims.height; srcW = dims.height * targetAspect; srcX = (dims.width - srcW) / 2 }
    }

    const effectiveRot = rotation + (cropMode ? cropRotation : 0)
    const rad = (effectiveRot * Math.PI) / 180
    const cos = Math.abs(Math.cos(rad)); const sin = Math.abs(Math.sin(rad))
    const outW = Math.round(srcW * cos + srcH * sin)
    const outH = Math.round(srcW * sin + srcH * cos)
    canvas.width = outW; canvas.height = outH
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, outW, outH)
    ctx.save()
    ctx.translate(outW / 2, outH / 2)
    ctx.rotate(rad)
    ctx.drawImage(img, srcX, srcY, srcW, srcH, -srcW / 2, -srcH / 2, srcW, srcH)
    ctx.restore()
  }, [activeEntry])

  // Re-draw whenever active entry or its settings change
  useEffect(() => {
    if (activeEntry && !activeEntry.cropMode) drawLivePreview()
  }, [drawLivePreview, activeEntry])

  // ── File handling ─────────────────────────────────────────────────────────
  const makeImageEntry = useCallback((f: File): ImageFileEntry => {
    const id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
    const url = URL.createObjectURL(f)
    const img = new Image()
    img.onload = () => {
      setEntries((prev) => prev.map((e) => e.id === id
        ? { ...e, dims: { width: img.naturalWidth, height: img.naturalHeight }, imgEl: img }
        : e,
      ))
    }
    img.src = url
    return {
      id, file: f, fileUrl: url, dims: null, imgEl: null,
      rotation: 0, cropMode: false, cropRect: null, cropAspect: null, cropRotation: 0,
      customW: '', customH: '', maintainAR: true, targetAspect: null,
      result: null, error: null, showResult: false, processing: false, progress: 0,
      bgRemoving: false, bgRemoveProgress: '', bgFillColor: 'transparent', bgUndo: null,
    }
  }, [])

  const handleFiles = useCallback((newFiles: File[]) => {
    const newEntries = newFiles.map(makeImageEntry)
    setEntries((prev) => {
      if (prev.length === 0) setActiveId(newEntries[0]?.id ?? null)
      return [...prev, ...newEntries]
    })
  }, [makeImageEntry])

  const handleAddMore = useCallback((newFiles: File[]) => {
    const newEntries = newFiles.map(makeImageEntry)
    setEntries((prev) => [...prev, ...newEntries])
    setActiveId((prev) => prev ?? newEntries[0]?.id ?? null)
  }, [makeImageEntry])

  function handleRemoveEntry(id: string) {
    setEntries((prev) => {
      const target = prev.find((e) => e.id === id)
      if (target) {
        URL.revokeObjectURL(target.fileUrl)
        if (target.result?.url) URL.revokeObjectURL(target.result.url)
        if (target.bgUndo?.fileUrl) URL.revokeObjectURL(target.bgUndo.fileUrl)
      }
      const next = prev.filter((e) => e.id !== id)
      if (activeId === id) {
        const idx = prev.findIndex((e) => e.id === id)
        setActiveId((next[idx] ?? next[idx - 1] ?? next[0] ?? null)?.id ?? null)
      }
      return next
    })
  }

  // ── Crop helpers ──────────────────────────────────────────────────────────
  function enterCropMode() {
    if (!activeEntry?.dims) return
    const rect = activeEntry.cropRect && activeEntry.cropRect.width > 0
      ? activeEntry.cropRect
      : { x: 0, y: 0, width: activeEntry.dims.width, height: activeEntry.dims.height }
    updateActive({ cropMode: true, cropRect: rect, cropRotation: 0, showResult: false })
  }

  function confirmCrop() {
    if (!activeEntry) return
    updateActive({
      ...(activeEntry.cropRotation !== 0
        ? { rotation: (activeEntry.rotation + activeEntry.cropRotation + 360) % 360 }
        : {}),
      cropRotation: 0, cropMode: false,
    })
  }

  function cancelCrop() { updateActive({ cropMode: false, cropRotation: 0 }) }

  // ── Custom resize helpers ─────────────────────────────────────────────────
  function handleCustomWChange(v: string) {
    if (!activeEntry) return
    const u: Partial<ImageFileEntry> = { customW: v }
    if (activeEntry.maintainAR && activeEntry.dims && v) {
      const nw = parseInt(v)
      if (!Number.isNaN(nw)) u.customH = String(Math.round(nw * (activeEntry.dims.height / activeEntry.dims.width)))
    }
    updateActive(u)
  }

  function handleCustomHChange(v: string) {
    if (!activeEntry) return
    const u: Partial<ImageFileEntry> = { customH: v }
    if (activeEntry.maintainAR && activeEntry.dims && v) {
      const nh = parseInt(v)
      if (!Number.isNaN(nh)) u.customW = String(Math.round(nh * (activeEntry.dims.width / activeEntry.dims.height)))
    }
    updateActive(u)
  }

  // ── Build ops ─────────────────────────────────────────────────────────────
  function buildOps(entry: ImageFileEntry): ImageOperation[] {
    const ops: ImageOperation[] = []
    const { cropRect, rotation, customW, customH, targetAspect, dims } = entry
    if (cropRect && cropRect.width > 0 && cropRect.height > 0) ops.push({ kind: 'crop', ...cropRect })
    if (rotation !== 0) ops.push({ kind: 'rotate', degrees: rotation })
    const nw = parseInt(customW); const nh = parseInt(customH)
    if (nw > 0 && nh > 0) {
      ops.push({ kind: 'resize', width: nw, height: nh, fit: 'fill' })
    } else if (targetAspect && dims) {
      const baseW = cropRect && cropRect.width > 0 ? cropRect.width : dims.width
      const baseH = cropRect && cropRect.height > 0 ? cropRect.height : dims.height
      const newH = Math.round(baseW / targetAspect)
      if (newH !== baseH) ops.push({ kind: 'resize', width: baseW, height: newH, fit: 'cover' })
    }
    return ops
  }

  // ── Export ────────────────────────────────────────────────────────────────
  async function handleProcess(entryId: string) {
    const entry = entries.find((e) => e.id === entryId)
    if (!entry) return
    updateEntry(entryId, { processing: true, progress: 0, error: null })
    try {
      const ops = buildOps(entry)
      const { blob, width, height } = await processImage({
        file: entry.file, operations: ops, outputFormat: format, quality,
        onProgress: (p) => updateEntry(entryId, { progress: p }),
      })
      const prevUrl = prevResultUrls.current.get(entryId)
      if (prevUrl) URL.revokeObjectURL(prevUrl)
      const url = URL.createObjectURL(blob)
      prevResultUrls.current.set(entryId, url)
      updateEntry(entryId, { result: { blob, url, width, height }, showResult: true, progress: 100, processing: false })
    } catch (e) {
      updateEntry(entryId, { error: e instanceof Error ? e.message : 'Processing failed', processing: false })
    }
  }

  async function handleProcessAll() {
    for (const entry of entries) {
      if (!entry.processing) await handleProcess(entry.id)
    }
  }

  // ── Background removal ────────────────────────────────────────────────────
  async function handleBgRemove() {
    if (!activeEntry) return
    const entryId = activeEntry.id
    const sourceFile = activeEntry.file
    const sourceFileUrl = activeEntry.fileUrl
    const sourceBgFill = activeEntry.bgFillColor
    const sourceDims = activeEntry.dims
    const sourceImgEl = activeEntry.imgEl
    const sourceResult = activeEntry.result
    const sourceShowResult = activeEntry.showResult
    const prevUndo = activeEntry.bgUndo
    updateEntry(entryId, { bgRemoving: true, bgRemoveProgress: 'Initialising model…', error: null })
    try {
      const blob = await removeBackground(sourceFile, {
        progress: (key: string, current: number, total: number) => {
          const pct = total > 0 ? Math.round((current / total) * 100) : 0
          const label = key.includes('fetch') || key.includes('load')
            ? `Downloading model… ${pct}%`
            : `Processing… ${pct}%`
          updateEntry(entryId, { bgRemoveProgress: label })
        },
      })

      const fillColor = sourceBgFill

      let resultBlob = blob
      if (fillColor !== 'transparent') {
        // Composite the bg-removed PNG over a solid fill color
        const blobUrl = URL.createObjectURL(blob)
        resultBlob = await new Promise<Blob>((resolve) => {
          const img = new Image()
          img.onload = () => {
            const canvas = document.createElement('canvas')
            canvas.width = img.naturalWidth
            canvas.height = img.naturalHeight
            const ctx = canvas.getContext('2d')
            if (!ctx) {
              URL.revokeObjectURL(blobUrl)
              resolve(blob)
              return
            }
            ctx.fillStyle = fillColor
            ctx.fillRect(0, 0, canvas.width, canvas.height)
            ctx.drawImage(img, 0, 0)
            canvas.toBlob((b) => {
              resolve(b ?? blob)
            }, 'image/png')
            URL.revokeObjectURL(blobUrl)
          }
          img.src = blobUrl
        })
      }

      const prevUrl = prevResultUrls.current.get(entryId)
      if (prevUrl) URL.revokeObjectURL(prevUrl)
      const resultUrl = URL.createObjectURL(resultBlob)
      prevResultUrls.current.set(entryId, resultUrl)

      const resultImg = new Image()
      await new Promise<void>((r) => { resultImg.onload = () => r(); resultImg.src = resultUrl })

      const nextName = `${sourceFile.name.replace(/\.[^.]+$/, '')}-bg-removed.png`
      const nextFile = new File([resultBlob], nextName, { type: 'image/png' })

      if (prevUndo?.fileUrl && prevUndo.fileUrl !== sourceFileUrl) {
        URL.revokeObjectURL(prevUndo.fileUrl)
      }

      updateEntry(entryId, {
        file: nextFile,
        fileUrl: resultUrl,
        dims: { width: resultImg.naturalWidth, height: resultImg.naturalHeight },
        imgEl: resultImg,
        cropMode: false,
        result: { blob: resultBlob, url: resultUrl, width: resultImg.naturalWidth, height: resultImg.naturalHeight },
        showResult: false,
        bgRemoving: false,
        bgRemoveProgress: '',
        bgUndo: {
          file: sourceFile,
          fileUrl: sourceFileUrl,
          dims: sourceDims,
          imgEl: sourceImgEl,
          result: sourceResult,
          showResult: sourceShowResult,
        },
      })
    } catch (e) {
      updateEntry(entryId, {
        error: e instanceof Error ? e.message : 'Background removal failed',
        bgRemoving: false,
        bgRemoveProgress: '',
      })
    }
  }

  function handleUndoBgRemove() {
    if (!activeEntry?.bgUndo) return
    const entryId = activeEntry.id
    const { bgUndo } = activeEntry

    if (activeEntry.fileUrl !== bgUndo.fileUrl) {
      URL.revokeObjectURL(activeEntry.fileUrl)
    }

    const trackedResultUrl = prevResultUrls.current.get(entryId)
    if (trackedResultUrl && trackedResultUrl !== bgUndo.result?.url) {
      URL.revokeObjectURL(trackedResultUrl)
      prevResultUrls.current.delete(entryId)
    }
    if (bgUndo.result?.url) {
      prevResultUrls.current.set(entryId, bgUndo.result.url)
    }

    updateEntry(entryId, {
      file: bgUndo.file,
      fileUrl: bgUndo.fileUrl,
      dims: bgUndo.dims,
      imgEl: bgUndo.imgEl,
      result: bgUndo.result,
      showResult: bgUndo.showResult,
      cropMode: false,
      bgRemoving: false,
      bgRemoveProgress: '',
      bgUndo: null,
    })
  }

  function handleReset() {
    for (const e of entries) {
      URL.revokeObjectURL(e.fileUrl)
      if (e.result?.url) URL.revokeObjectURL(e.result.url)
      if (e.bgUndo?.fileUrl) URL.revokeObjectURL(e.bgUndo.fileUrl)
    }
    prevResultUrls.current.clear()
    setEntries([]); setActiveId(null)
  }

  function handleDownload(entry: ImageFileEntry) {
    if (!entry.result) return
    const ext = IMAGE_FORMATS.find((f) => f.value === format)?.ext ?? 'jpg'
    const a = document.createElement('a')
    a.href = entry.result.url
    a.download = `${entry.file.name.replace(/\.[^.]+$/, '')}-mz.${ext}`
    a.click()
  }

  // ── Active entry shortcuts ────────────────────────────────────────────────
  const file         = activeEntry?.file ?? null
  const fileUrl      = activeEntry?.fileUrl ?? null
  const dims         = activeEntry?.dims ?? null
  const rotation     = activeEntry?.rotation ?? 0
  const cropMode     = activeEntry?.cropMode ?? false
  const cropRect     = activeEntry?.cropRect ?? null
  const cropAspect   = activeEntry?.cropAspect ?? null
  const cropRotation = activeEntry?.cropRotation ?? 0
  const customW      = activeEntry?.customW ?? ''
  const customH      = activeEntry?.customH ?? ''
  const maintainAR   = activeEntry?.maintainAR ?? true
  const targetAspect = activeEntry?.targetAspect ?? null
  const result       = activeEntry?.result ?? null
  const error             = activeEntry?.error ?? null
  const showResult        = activeEntry?.showResult ?? false
  const processing        = activeEntry?.processing ?? false
  const progress          = activeEntry?.progress ?? 0
  const bgRemoving        = activeEntry?.bgRemoving ?? false
  const bgRemoveProgress  = activeEntry?.bgRemoveProgress ?? ''
  const bgFillColor       = activeEntry?.bgFillColor ?? 'transparent'
  const hasBgUndo         = Boolean(activeEntry?.bgUndo)

  const estimatedSize = file ? estimateOutputSize(file.size, format, quality) : 0
  const reduction     = file && estimatedSize ? Math.round((1 - estimatedSize / file.size) * 100) : 0

  const liveOutDims = (() => {
    if (!dims) return null
    let w = dims.width; let h = dims.height
    if (cropRect && cropRect.width > 0) { w = cropRect.width; h = cropRect.height }
    else if (targetAspect) {
      if (targetAspect > w / h) h = Math.round(w / targetAspect)
      else w = Math.round(h * targetAspect)
    }
    const nw = parseInt(customW); const nh = parseInt(customH)
    if (nw > 0 && nh > 0) { w = nw; h = nh }
    if (rotation === 90 || rotation === 270) { const t = w; w = h; h = t }
    return { width: w, height: h }
  })()

  const anyProcessing = entries.some((e) => e.processing)

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="mz-app flex flex-col min-h-screen">
      {/* Top bar */}
      <div className="mz-topbar">
        <a
          href="/media"
          className="flex items-center gap-1.5 no-underline"
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
        <span className="text-xs font-semibold whitespace-nowrap" style={{ color: 'var(--mz-text)' }}>Image Studio</span>
        {file && (
          <>
            <span className="text-xs" style={{ color: 'var(--mz-border-2)' }}>·</span>
            <span className="mz-mono truncate max-w-40" style={{ color: 'var(--mz-text-2)', fontSize: '11px' }}>{file.name}</span>
            {dims && <span className="mz-badge whitespace-nowrap">{dims.width}×{dims.height}</span>}
            {dims && liveOutDims && (liveOutDims.width !== dims.width || liveOutDims.height !== dims.height) && (
              <span className="mz-badge mz-badge-accent whitespace-nowrap">→ {liveOutDims.width}×{liveOutDims.height}</span>
            )}
          </>
        )}
        {entries.length > 1 && (
          <span className="mz-badge whitespace-nowrap" style={{ background: 'var(--mz-accent)', color: 'white' }}>
            {entries.length} files
          </span>
        )}
        <div className="flex-1" />
        {file && (
          <div className="flex items-center gap-1.5">
            {/* Quick rotate */}
            <IconBtn onClick={() => updateActive({ rotation: (rotation + 270) % 360 })} title="Rotate CCW 90°">
              <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10"/>
                <path d="M20.49 15a9 9 0 1 1-.49-3.87"/>
              </svg>
            </IconBtn>
            <IconBtn onClick={() => updateActive({ rotation: (rotation + 90) % 360 })} title="Rotate CW 90°">
              <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="1 4 1 10 7 10"/>
                <path d="M3.51 15a9 9 0 1 0 .49-3.87"/>
              </svg>
            </IconBtn>
            <IconBtn
              onClick={cropMode ? confirmCrop : enterCropMode}
              title={cropMode ? 'Confirm crop' : 'Open crop tool'}
              active={cropMode}
            >
              <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 2 6 6 2 6"/>
                <polyline points="18 22 18 18 22 18"/>
                <polyline points="6 22 6 18 2 18"/>
                <polyline points="18 2 18 6 22 6"/>
                <rect x="8" y="8" width="8" height="8"/>
              </svg>
            </IconBtn>
          </div>
        )}
        <span className="mz-badge whitespace-nowrap">Canvas · Web Worker</span>
      </div>

      {entries.length === 0 ? (
        /* ── Drop zone ── */
        <div className="flex flex-1 items-center justify-center px-6 py-12">
          <div className="w-full max-w-sm">
            <p className="mz-label mb-3">Image Studio</p>
            <h1 className="mb-2 text-[30px] font-light tracking-tight leading-none" style={{ color: 'var(--mz-text)' }}>
              Drop images
            </h1>
            <p className="mb-8 text-sm" style={{ color: 'var(--mz-text-2)' }}>
              Convert, compress, crop and rotate — entirely in your browser. Drop multiple files to batch process.
            </p>
            <DropZone
              accept={['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif', 'image/bmp']}
              onFiles={handleFiles}
              multiple
              label="Drop images here"
              sublabel="JPEG, PNG, WebP, AVIF, GIF, BMP · multiple files ok"
            />
          </div>
        </div>
      ) : (
        /* ── Workspace ── */
        <div className="flex flex-1 overflow-hidden">

          {/* ── Preview column ── */}
          <div className="flex min-w-0 flex-1 flex-col overflow-y-auto p-4 gap-3">

            {/* Main preview */}
            <div className="mz-well overflow-hidden">
              {cropMode && dims && fileUrl ? (
                <div className="flex justify-center">
                  <CropCanvas
                    src={fileUrl}
                    imageWidth={dims.width}
                    imageHeight={dims.height}
                    cropRect={cropRect ?? { x: 0, y: 0, width: dims.width, height: dims.height }}
                    onCropChange={(r) => updateActive({ cropRect: r })}
                    aspectRatio={cropAspect}
                    rotation={cropRotation}
                    maxHeight="60vh"
                  />
                </div>
              ) : showResult && result ? (
                <img
                  src={result.url}
                  alt="Result"
                  className="block mx-auto rounded-sm"
                  style={{ maxWidth: '100%', maxHeight: '60vh', height: 'auto', width: 'auto' }}
                />
              ) : (
                <canvas
                  ref={liveCanvasRef}
                  className="block mx-auto rounded-sm"
                  style={{ maxWidth: '100%', maxHeight: '60vh', height: 'auto', width: 'auto' }}
                />
              )}

              {/* Meta row */}
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="mz-mono" style={{ color: 'var(--mz-text-2)', fontSize: '11px' }}>
                  <span style={{ color: 'var(--mz-text)' }}>{dims?.width}</span>
                  {' × '}
                  <span style={{ color: 'var(--mz-text)' }}>{dims?.height}</span>
                  {' px · '}
                  {file && formatBytes(file.size)}
                </span>
                {liveOutDims && !showResult && (
                  <span className="mz-mono" style={{ color: 'var(--mz-accent)', fontSize: '11px' }}>
                    → {liveOutDims.width} × {liveOutDims.height} px
                  </span>
                )}
                {result && showResult && (
                  <span className="ml-auto flex items-center gap-2">
                    <span className="mz-mono" style={{ color: 'var(--mz-accent)', fontSize: '11px' }}>
                      {result.width} × {result.height} px · {formatBytes(result.blob.size)}
                    </span>
                    {file && result.blob.size < file.size && (
                      <span className="mz-badge mz-badge-accent">
                        -{Math.round((1 - result.blob.size / file.size) * 100)}%
                      </span>
                    )}
                  </span>
                )}
              </div>
            </div>

            {/* Crop controls bar */}
            {cropMode && (
              <div
                className="flex flex-col gap-2 rounded-md px-3 py-2.5"
                style={{ border: '1px solid var(--mz-accent-border)', background: 'var(--mz-accent-dim)' }}
              >
                {/* Aspect lock row */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="mz-label" style={{ color: 'var(--mz-accent)' }}>Aspect lock</span>
                  {ASPECT_RATIOS.map((ar) => (
                    <button
                      key={ar.label}
                      type="button"
                      onClick={() => updateActive({ cropAspect: ar.value ?? null })}
                      className={`mz-chip ${cropAspect === (ar.value ?? null) ? 'is-active' : ''}`}
                    >
                      {ar.label}
                    </button>
                  ))}
                  <div className="ml-auto flex items-center gap-2">
                    {cropRect && cropRect.width > 0 && (
                      <span className="mz-mono" style={{ fontSize: '11px', color: 'var(--mz-text-2)' }}>
                        {Math.round(cropRect.width)} × {Math.round(cropRect.height)}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={confirmCrop}
                      className="mz-btn mz-btn-primary"
                      style={{ padding: '3px 12px', fontSize: '11px' }}
                    >
                      Apply
                    </button>
                    <button
                      type="button"
                      onClick={cancelCrop}
                      className="mz-btn mz-btn-danger"
                      style={{ padding: '3px 10px', fontSize: '11px' }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>

                {/* Rotation dial row */}
                <div className="flex items-center gap-3">
                  <span className="mz-label" style={{ color: 'var(--mz-accent)', flexShrink: 0 }}>Straighten</span>
                  <RotationDial value={cropRotation} onChange={(v) => updateActive({ cropRotation: v })} />
                  <button
                    type="button"
                    onClick={() => updateActive({ cropRotation: 0 })}
                    className="mz-btn mz-btn-ghost"
                    style={{ padding: '2px 8px', fontSize: '10px', flexShrink: 0, opacity: cropRotation === 0 ? 0.35 : 1 }}
                    disabled={cropRotation === 0}
                  >
                    Reset
                  </button>
                </div>
              </div>
            )}

            {/* Toggle: live preview ↔ result */}
            {result && !cropMode && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => updateActive({ showResult: false })}
                  className={`mz-chip ${!showResult ? 'is-active' : ''}`}
                >
                  Live preview
                </button>
                <button
                  type="button"
                  onClick={() => updateActive({ showResult: true })}
                  className={`mz-chip ${showResult ? 'is-active' : ''}`}
                >
                  Exported result
                </button>
              </div>
            )}
          </div>

          {/* ── Sidebar ── */}
          <div
            className="flex w-72 shrink-0 flex-col overflow-y-auto border-l px-4 pt-4 pb-3 xl:w-80"
            style={{ borderColor: 'var(--mz-border)', background: 'var(--mz-surface)' }}
          >
            {/* ── File queue ── */}
            <Section
              title={entries.length > 1 ? `Queue · ${entries.length} files` : 'File'}
              badge={
                entries.filter((e) => e.result !== null).length > 0
                  ? `${entries.filter((e) => e.result !== null).length}/${entries.length} done`
                  : undefined
              }
            >
              <div className="flex flex-col gap-1 mb-2">
                {entries.map((entry) => {
                  const isActive = entry.id === activeId
                  return (
                    <div
                      key={entry.id}
                      className="flex items-center gap-2 rounded-md px-2 py-1.5 cursor-pointer"
                      style={{
                        background: isActive ? 'var(--mz-surface-2)' : 'transparent',
                        border: `1px solid ${isActive ? 'var(--mz-border-2)' : 'transparent'}`,
                        transition: 'background 0.1s',
                      }}
                      onClick={() => setActiveId(entry.id)}
                      onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'var(--mz-surface-2)' }}
                      onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
                    >
                      {/* Thumbnail */}
                      <div className="shrink-0 rounded overflow-hidden"
                        style={{ width: 28, height: 28, background: 'var(--mz-surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {entry.result?.url
                          ? <img src={entry.result.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          : <img src={entry.fileUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        }
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="mz-mono truncate" style={{ fontSize: '10px', color: isActive ? 'var(--mz-text)' : 'var(--mz-text-2)' }}>
                          {entry.file.name}
                        </p>
                        <p style={{ fontSize: '9px', color: 'var(--mz-text-2)' }}>{formatBytes(entry.file.size)}</p>
                      </div>
                      {entry.processing ? (
                        <svg aria-hidden="true" className="animate-spin shrink-0" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--mz-accent)" strokeWidth="2">
                          <circle cx="12" cy="12" r="10" strokeOpacity="0.3"/><path d="M12 2a10 10 0 0 1 10 10"/>
                        </svg>
                      ) : entry.result ? (
                        <svg aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--mz-accent)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      ) : null}
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
                accept="image/jpeg,image/png,image/webp,image/avif,image/gif,image/bmp"
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

            {/* FORMAT */}
            <Section title="Format">
              <div className="grid grid-cols-4 gap-1">
                {IMAGE_FORMATS.map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => setFormat(f.value)}
                    className={`mz-chip flex-col gap-0.5 py-2 ${format === f.value ? 'is-active' : ''}`}
                    style={{ fontSize: '11px' }}
                  >
                    <span className="font-semibold">{f.label}</span>
                    <span className="opacity-40 text-[9px]">.{f.ext}</span>
                  </button>
                ))}
              </div>
            </Section>

            {/* QUALITY */}
            <Section
              title="Quality"
              badge={format === 'image/png' ? 'lossless' : `${Math.round(quality * 100)}%`}
            >
              {format === 'image/png' ? (
                <p className="text-xs" style={{ color: 'var(--mz-text-2)' }}>PNG is lossless — no quality setting.</p>
              ) : (
                <div className="space-y-2.5">
                  <input
                    type="range" min={0.05} max={1} step={0.05} value={quality}
                    onChange={(e) => setQuality(Number(e.target.value))}
                    className="mz-slider w-full"
                  />
                  <div className="flex justify-between">
                    <span className="mz-label">Est. output</span>
                    <span className="mz-mono" style={{ color: 'var(--mz-text-2)', fontSize: '11px' }}>
                      ~{formatBytes(estimatedSize)}
                      {reduction > 0 && (
                        <span className="ml-1" style={{ color: 'var(--mz-accent)' }}>(-{reduction}%)</span>
                      )}
                    </span>
                  </div>
                </div>
              )}
            </Section>

            {/* ROTATE */}
            <Section title="Rotate" badge={rotation !== 0 ? `${rotation}°` : undefined}>
              <div className="flex gap-1.5">
                {[0, 90, 180, 270].map((deg) => (
                  <button
                    key={deg}
                    type="button"
                    onClick={() => updateActive({ rotation: deg })}
                    className={`mz-chip flex-1 justify-center ${rotation === deg ? 'is-active' : ''}`}
                    style={{ fontSize: '11px' }}
                  >
                    {deg}°
                  </button>
                ))}
              </div>
            </Section>

            {/* CROP */}
            <Section
              title="Crop"
              badge={cropRect && cropRect.width > 0 ? `${Math.round(cropRect.width)}×${Math.round(cropRect.height)}` : undefined}
              accent={cropMode}
            >
              {!cropMode ? (
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={enterCropMode}
                    className="mz-btn mz-btn-ghost flex-1 gap-2"
                    style={{ fontSize: '11px' }}
                  >
                    <svg aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="6 2 6 6 2 6"/>
                      <polyline points="18 22 18 18 22 18"/>
                      <polyline points="6 22 6 18 2 18"/>
                      <polyline points="18 2 18 6 22 6"/>
                      <rect x="8" y="8" width="8" height="8"/>
                    </svg>
                    {cropRect && cropRect.width > 0 ? 'Adjust crop' : 'Open crop tool'}
                  </button>
                  {cropRect && cropRect.width > 0 && (
                    <button
                      type="button"
                      onClick={() => updateActive({ cropRect: null, cropAspect: null })}
                      className="mz-btn mz-btn-danger"
                      style={{ padding: '5px 10px', fontSize: '11px' }}
                    >
                      Clear
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-4 gap-1">
                    {ASPECT_RATIOS.map((ar) => (
                      <button
                        key={ar.label}
                        type="button"
                        onClick={() => updateActive({ cropAspect: ar.value ?? null })}
                        className={`mz-chip justify-center ${cropAspect === (ar.value ?? null) ? 'is-active' : ''}`}
                        style={{ fontSize: '10px', padding: '4px 4px' }}
                      >
                        {ar.label}
                      </button>
                    ))}
                  </div>
                  {cropRect && cropRect.width > 0 && (
                    <div className="grid grid-cols-2 gap-1">
                      {[
                        { label: 'X', val: Math.round(cropRect.x) },
                        { label: 'Y', val: Math.round(cropRect.y) },
                        { label: 'W', val: Math.round(cropRect.width) },
                        { label: 'H', val: Math.round(cropRect.height) },
                      ].map(({ label, val }) => (
                        <div
                          key={label}
                          className="flex items-center gap-1.5 rounded-sm px-2 py-1"
                          style={{ border: '1px solid var(--mz-border)', background: 'var(--mz-surface-2)' }}
                        >
                          <span className="mz-label">{label}</span>
                          <span className="mz-mono" style={{ color: 'var(--mz-text)', fontSize: '11px' }}>{val}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-1.5 pt-1">
                    <button
                      type="button"
                      onClick={confirmCrop}
                      className="mz-btn mz-btn-primary flex-1"
                      style={{ fontSize: '11px', padding: '5px 8px' }}
                    >
                      Apply crop
                    </button>
                    <button
                      type="button"
                      onClick={cancelCrop}
                      className="mz-btn mz-btn-danger"
                      style={{ fontSize: '11px', padding: '5px 8px' }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </Section>

            {/* ASPECT RATIO */}
            <Section
              title="Aspect Ratio"
              badge={targetAspect ? ASPECT_RATIOS.find((a) => a.value === targetAspect)?.label : undefined}
            >
              <div className="flex flex-wrap gap-1">
                {ASPECT_RATIOS.map((ar) => (
                  <button
                    key={ar.label}
                    type="button"
                    onClick={() => updateActive({ targetAspect: ar.value ?? null })}
                    className={`mz-chip ${targetAspect === (ar.value ?? null) ? 'is-active' : ''}`}
                    style={{ fontSize: '11px' }}
                  >
                    {ar.label}
                  </button>
                ))}
              </div>
              {targetAspect && (
                <p className="mt-2 text-xs" style={{ color: 'var(--mz-text-2)' }}>
                  Crops to fit ratio (center), applied on export.
                </p>
              )}
            </Section>

            {/* RESIZE */}
            <Section title="Custom Size">
              <div className="flex items-center gap-2">
                <input
                  type="number" placeholder="W" value={customW}
                  onChange={(e) => handleCustomWChange(e.target.value)}
                  className="mz-input"
                />
                <span className="text-xs" style={{ color: 'var(--mz-text-2)' }}>×</span>
                <input
                  type="number" placeholder="H" value={customH}
                  onChange={(e) => handleCustomHChange(e.target.value)}
                  className="mz-input"
                />
                {(customW || customH) && (
                  <button
                    type="button"
                    onClick={() => updateActive({ customW: '', customH: '' })}
                    className="mz-btn mz-btn-ghost"
                    style={{ padding: '4px 8px', flexShrink: 0 }}
                  >
                    <svg aria-hidden="true" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                )}
              </div>
              <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs" style={{ color: 'var(--mz-text-2)' }}>
                <input type="checkbox" checked={maintainAR} onChange={(e) => updateActive({ maintainAR: e.target.checked })} />
                Lock aspect ratio
              </label>
            </Section>

            {/* ── BACKGROUND REMOVAL ── */}
            <Section title="Background Removal" badge="AI" accent>
              <p className="mb-3 text-xs leading-relaxed" style={{ color: 'var(--mz-text-2)' }}>
                Removes image background using an on-device AI model (~30 MB, cached after first use). The removed result becomes your new editable source.
              </p>

              {/* Fill color option */}
              <div className="mb-3">
                <div className="mz-label mb-2">Background fill after removal</div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => updateActive({ bgFillColor: 'transparent' })}
                    className={`mz-chip flex-1 justify-center ${
                      bgFillColor === 'transparent' ? 'is-active' : ''
                    }`}
                    style={{ fontSize: '11px' }}
                  >
                    Transparent
                  </button>
                  <div className="flex flex-1 items-center gap-1.5">
                    <input
                      type="color"
                      value={bgFillColor === 'transparent' ? '#ffffff' : bgFillColor}
                      onChange={(e) => updateActive({ bgFillColor: e.target.value })}
                      className="h-7 w-8 rounded cursor-pointer border-0 bg-transparent p-0"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        updateActive({
                          bgFillColor:
                            bgFillColor === 'transparent' ? '#ffffff' : bgFillColor,
                        })
                      }
                      className={`mz-chip flex-1 justify-center ${
                        bgFillColor !== 'transparent' ? 'is-active' : ''
                      }`}
                      style={{ fontSize: '11px' }}
                    >
                      {bgFillColor !== 'transparent' ? bgFillColor : 'Color'}
                    </button>
                  </div>
                </div>
              </div>

              {bgRemoving ? (
                <div
                  className="rounded-md px-3 py-3 space-y-2"
                  style={{ background: 'var(--mz-accent-dim)', border: '1px solid var(--mz-accent-border)' }}
                >
                  <div className="flex items-center gap-2">
                    <svg aria-hidden="true" className="animate-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--mz-accent)" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" strokeOpacity="0.3" />
                      <path d="M12 2a10 10 0 0 1 10 10" />
                    </svg>
                    <span className="text-xs" style={{ color: 'var(--mz-accent)' }}>
                      {bgRemoveProgress || 'Working…'}
                    </span>
                  </div>
                  <div className="mz-progress">
                    <div
                      className="mz-progress-bar"
                      style={{ width: bgRemoveProgress.includes('%') ? `${bgRemoveProgress.match(/(\d+)%/)?.[1] ?? 50}%` : '40%', animation: bgRemoveProgress.includes('%') ? 'none' : 'mz-indeterminate 1.4s infinite' }}
                    />
                  </div>
                  <p className="text-xs" style={{ color: 'var(--mz-text-2)' }}>First run downloads the AI model once; subsequent runs are instant.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={handleBgRemove}
                    disabled={!activeEntry || bgRemoving}
                    className="mz-btn mz-btn-ghost w-full gap-2"
                    style={{ fontSize: '12px' }}
                  >
                    <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 6l4.5 4.5M21 6l-4.5 4.5M3 18l4.5-4.5M21 18l-4.5-4.5" />
                      <rect x="9" y="9" width="6" height="6" rx="1" />
                    </svg>
                    Remove Background
                  </button>
                  {result && (
                    <p className="text-xs" style={{ color: 'var(--mz-text-2)' }}>
                      Continue cropping, rotating, resizing, and exporting from the removed-background image.
                    </p>
                  )}
                  {hasBgUndo && (
                    <button
                      type="button"
                      onClick={handleUndoBgRemove}
                      className="mz-btn mz-btn-danger w-full"
                      style={{ fontSize: '11px' }}
                    >
                      Undo remove background
                    </button>
                  )}
                </div>
              )}
            </Section>

            <div className="flex-1" />

            {/* Error */}
            {error && (
              <div
                className="mb-2 rounded-md px-3 py-2 text-xs"
                style={{ border: '1px solid var(--mz-error)', color: 'var(--mz-error)', background: 'rgba(255,82,82,0.08)' }}
              >
                {error}
              </div>
            )}

            {/* Actions */}
            <div className="flex flex-col gap-1.5">
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={() => activeEntry && handleProcess(activeEntry.id)}
                  disabled={processing || !activeEntry}
                  className="mz-btn mz-btn-primary flex-1 gap-1.5"
                >
                  {processing ? (
                    <>
                      <svg aria-hidden="true" className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="10" strokeOpacity="0.3"/>
                        <path d="M12 2a10 10 0 0 1 10 10"/>
                      </svg>
                      {progress > 0 && progress < 100 ? `${progress}%` : 'Processing…'}
                    </>
                  ) : result ? 'Re-export' : 'Export'}
                </button>
                {result && activeEntry && (
                  <button
                    type="button"
                    onClick={() => handleDownload(activeEntry)}
                    className="mz-btn mz-btn-ghost"
                    style={{ padding: '7px 12px' }}
                    title="Download"
                  >
                    <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="7 10 12 15 17 10"/>
                      <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                  </button>
                )}
              </div>

              {/* Export all */}
              {entries.length > 1 && (
                <button
                  type="button"
                  onClick={handleProcessAll}
                  disabled={anyProcessing}
                  className="mz-btn mz-btn-ghost gap-1.5"
                  style={{ fontSize: '11px' }}
                >
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
                      Export all {entries.length} images
                    </>
                  )}
                </button>
              )}

              {processing && (
                <div className="mz-progress">
                  <div className="mz-progress-bar" style={{ width: `${progress}%` }} />
                </div>
              )}

              <button
                type="button"
                onClick={handleReset}
                className="text-center transition-colors"
                style={{ fontSize: '11px', color: 'var(--mz-text-2)' }}
                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--mz-text)' }}
                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--mz-text-2)' }}
              >
                Clear all files
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

