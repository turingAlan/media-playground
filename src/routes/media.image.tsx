import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
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
  // File
  const [file, setFile] = useState<File | null>(null)
  const [fileUrl, setFileUrl] = useState<string | null>(null)
  const [dims, setDims] = useState<Dims | null>(null)

  // Tools
  const [format, setFormat] = useState<ImageFormat>('image/webp')
  const [quality, setQuality] = useState(0.85)
  const [rotation, setRotation] = useState(0)
  const [targetAspect, setTargetAspect] = useState<number | null>(null)
  const [cropMode, setCropMode] = useState(false)
  const [cropRect, setCropRect] = useState<CropRect | null>(null)
  const [cropAspect, setCropAspect] = useState<number | null>(null)
  const [cropRotation, setCropRotation] = useState(0)
  const [customW, setCustomW] = useState('')
  const [customH, setCustomH] = useState('')
  const [maintainAR, setMaintainAR] = useState(true)

  // Processing
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<ResultState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [showResult, setShowResult] = useState(false)

  // Live preview
  const liveCanvasRef = useRef<HTMLCanvasElement>(null)
  const imgElRef = useRef<HTMLImageElement | null>(null)
  const prevResultUrl = useRef<string | null>(null)

  // ─── File handling ──────────────────────────────────────────────────────────

  const handleFile = useCallback((f: File) => {
    const url = URL.createObjectURL(f)
    setFile(f)
    setFileUrl(url)
    setResult(null)
    setError(null)
    setShowResult(false)
    setCropMode(false)
    setCropRect(null)
    setRotation(0)
    setTargetAspect(null)
    setCustomW('')
    setCustomH('')
    const img = new Image()
    img.onload = () => {
      setDims({ width: img.naturalWidth, height: img.naturalHeight })
      imgElRef.current = img
    }
    img.src = url
  }, [])

  useEffect(() => {
    return () => { if (fileUrl) URL.revokeObjectURL(fileUrl) }
  }, [fileUrl])

  useEffect(() => {
    return () => { if (result?.url) URL.revokeObjectURL(result.url) }
  }, [result])

  // ─── Live preview rendering ─────────────────────────────────────────────────

  const drawLivePreview = useCallback(() => {
    const canvas = liveCanvasRef.current
    const img = imgElRef.current
    if (!canvas || !img || !dims) return

    // Source region (before rotation)
    let srcX = 0
    let srcY = 0
    let srcW = dims.width
    let srcH = dims.height

    if (cropMode && cropRect && cropRect.width > 0 && cropRect.height > 0) {
      srcX = cropRect.x; srcY = cropRect.y
      srcW = cropRect.width; srcH = cropRect.height
    } else if (targetAspect) {
      const imgAspect = dims.width / dims.height
      if (targetAspect > imgAspect) {
        srcW = dims.width
        srcH = dims.width / targetAspect
        srcY = (dims.height - srcH) / 2
      } else {
        srcH = dims.height
        srcW = dims.height * targetAspect
        srcX = (dims.width - srcW) / 2
      }
    }

    // Rotated output dimensions
    const rad = (rotation * Math.PI) / 180
    const cos = Math.abs(Math.cos(rad))
    const sin = Math.abs(Math.sin(rad))
    const outW = Math.round(srcW * cos + srcH * sin)
    const outH = Math.round(srcW * sin + srcH * cos)

    canvas.width = outW
    canvas.height = outH

    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, outW, outH)
    ctx.save()
    ctx.translate(outW / 2, outH / 2)
    ctx.rotate(rad)
    ctx.drawImage(img, srcX, srcY, srcW, srcH, -srcW / 2, -srcH / 2, srcW, srcH)
    ctx.restore()
  }, [dims, rotation, cropMode, cropRect, targetAspect])

  // Re-render live preview whenever controls change
  useEffect(() => {
    if (!cropMode) drawLivePreview()
  }, [drawLivePreview, cropMode])

  // When image first loads
  useEffect(() => {
    const img = imgElRef.current
    if (!img || !dims) return
    drawLivePreview()
  }, [dims, drawLivePreview])

  // ─── Crop tool helpers ──────────────────────────────────────────────────────

  function enterCropMode() {
    if (!dims) return
    setCropRect(cropRect && cropRect.width > 0
      ? cropRect
      : { x: 0, y: 0, width: dims.width, height: dims.height },
    )
    setCropRotation(0)
    setShowResult(false)
    setCropMode(true)
  }

  function confirmCrop() {
    // Merge fine crop rotation into main rotation
    if (cropRotation !== 0) {
      setRotation((r) => ((r + cropRotation + 360) % 360))
    }
    setCropRotation(0)
    setCropMode(false)
    // live preview will update via state change
  }

  function cancelCrop() {
    setCropMode(false)
    setCropRotation(0)
    setCropRect(null)
  }

  // ─── Custom resize ──────────────────────────────────────────────────────────

  function handleCustomWChange(v: string) {
    setCustomW(v)
    if (maintainAR && dims && v) {
      const nw = parseInt(v)
      if (!Number.isNaN(nw)) setCustomH(String(Math.round(nw * (dims.height / dims.width))))
    }
  }

  function handleCustomHChange(v: string) {
    setCustomH(v)
    if (maintainAR && dims && v) {
      const nh = parseInt(v)
      if (!Number.isNaN(nh)) setCustomW(String(Math.round(nh * (dims.width / dims.height))))
    }
  }

  // ─── Build ops for export ───────────────────────────────────────────────────

  function buildOps(): ImageOperation[] {
    const ops: ImageOperation[] = []

    if (cropRect && cropRect.width > 0 && cropRect.height > 0) {
      ops.push({ kind: 'crop', ...cropRect })
    }

    if (rotation !== 0) {
      ops.push({ kind: 'rotate', degrees: rotation })
    }

    const nw = parseInt(customW)
    const nh = parseInt(customH)
    if (nw > 0 && nh > 0) {
      ops.push({ kind: 'resize', width: nw, height: nh, fit: 'fill' })
    } else if (targetAspect && dims) {
      const baseW = cropRect && cropRect.width > 0 ? cropRect.width : dims.width
      const baseH = cropRect && cropRect.height > 0 ? cropRect.height : dims.height
      const newH = Math.round(baseW / targetAspect)
      if (newH !== baseH) {
        ops.push({ kind: 'resize', width: baseW, height: newH, fit: 'cover' })
      }
    }

    return ops
  }

  // ─── Export ─────────────────────────────────────────────────────────────────

  async function handleProcess() {
    if (!file) return
    setProcessing(true)
    setProgress(0)
    setError(null)
    try {
      const ops = buildOps()
      const { blob, width, height } = await processImage({
        file,
        operations: ops,
        outputFormat: format,
        quality,
        onProgress: setProgress,
      })
      if (prevResultUrl.current) URL.revokeObjectURL(prevResultUrl.current)
      const url = URL.createObjectURL(blob)
      prevResultUrl.current = url
      setResult({ blob, url, width, height })
      setShowResult(true)
      setProgress(100)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Processing failed')
    } finally {
      setProcessing(false)
    }
  }

  function handleReset() {
    setFile(null)
    setFileUrl(null)
    setDims(null)
    setResult(null)
    setError(null)
    setCropMode(false)
    setCropRect(null)
    setCropRotation(0)
    setRotation(0)
    setTargetAspect(null)
    setCustomW('')
    setCustomH('')
    setProgress(0)
    setShowResult(false)
    imgElRef.current = null
  }

  function handleDownload() {
    if (!result || !file) return
    const ext = IMAGE_FORMATS.find((f) => f.value === format)?.ext ?? 'jpg'
    const a = document.createElement('a')
    a.href = result.url
    a.download = `${file.name.replace(/\.[^.]+$/, '')}-mz.${ext}`
    a.click()
  }

  // ─── Derived values ─────────────────────────────────────────────────────────

  const estimatedSize = file ? estimateOutputSize(file.size, format, quality) : 0
  const reduction = file && estimatedSize
    ? Math.round((1 - estimatedSize / file.size) * 100)
    : 0

  // Computed output preview dimensions (live estimate)
  const liveOutDims = (() => {
    if (!dims) return null
    let w = dims.width
    let h = dims.height
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

  // ─── Render ─────────────────────────────────────────────────────────────────

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
        <span className="text-xs font-semibold" style={{ color: 'var(--mz-text)' }}>Image Studio</span>
        {file && (
          <>
            <span className="text-xs" style={{ color: 'var(--mz-border-2)' }}>·</span>
            <span className="mz-mono truncate max-w-40" style={{ color: 'var(--mz-text-2)', fontSize: '11px' }}>{file.name}</span>
            {dims && <span className="mz-badge">{dims.width}×{dims.height}</span>}
            {dims && liveOutDims && (liveOutDims.width !== dims.width || liveOutDims.height !== dims.height) && (
              <span className="mz-badge mz-badge-accent">→ {liveOutDims.width}×{liveOutDims.height}</span>
            )}
          </>
        )}
        <div className="flex-1" />
        {file && (
          <div className="flex items-center gap-1.5">
            {/* Quick rotate */}
            <IconBtn onClick={() => setRotation((r) => (r + 270) % 360)} title="Rotate CCW 90°">
              <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10"/>
                <path d="M20.49 15a9 9 0 1 1-.49-3.87"/>
              </svg>
            </IconBtn>
            <IconBtn onClick={() => setRotation((r) => (r + 90) % 360)} title="Rotate CW 90°">
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
        <span className="mz-badge">Canvas · Web Worker</span>
      </div>

      {!file ? (
        /* ── Drop zone ── */
        <div className="flex flex-1 items-center justify-center px-6 py-12">
          <div className="w-full max-w-sm">
            <p className="mz-label mb-3">Image Studio</p>
            <h1 className="mb-2 text-[30px] font-light tracking-tight leading-none" style={{ color: 'var(--mz-text)' }}>
              Drop an image
            </h1>
            <p className="mb-8 text-sm" style={{ color: 'var(--mz-text-2)' }}>
              Convert, compress, crop and rotate — entirely in your browser.
            </p>
            <DropZone
              accept={['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif', 'image/bmp']}
              onFile={handleFile}
              label="Drop an image here"
              sublabel="JPEG, PNG, WebP, AVIF, GIF, BMP"
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
                /* Crop canvas — centre it; portrait images self-constrain via min() width */
                <div className="flex justify-center">
                  <CropCanvas
                    src={fileUrl}
                    imageWidth={dims.width}
                    imageHeight={dims.height}
                    cropRect={cropRect ?? { x: 0, y: 0, width: dims.width, height: dims.height }}
                    onCropChange={setCropRect}
                    aspectRatio={cropAspect}
                    rotation={cropRotation}
                    maxHeight="60vh"
                  />
                </div>
              ) : showResult && result ? (
                /* Export result */
                <img
                  src={result.url}
                  alt="Result"
                  className="block mx-auto rounded-sm"
                  style={{ maxWidth: '100%', maxHeight: '60vh', height: 'auto', width: 'auto' }}
                />
              ) : (
                /* Live preview canvas */
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
                  {formatBytes(file.size)}
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
                    {result.blob.size < file.size && (
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
                      onClick={() => setCropAspect(ar.value ?? null)}
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
                  <RotationDial value={cropRotation} onChange={setCropRotation} />
                  <button
                    type="button"
                    onClick={() => setCropRotation(0)}
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
                  onClick={() => setShowResult(false)}
                  className={`mz-chip ${!showResult ? 'is-active' : ''}`}
                >
                  Live preview
                </button>
                <button
                  type="button"
                  onClick={() => setShowResult(true)}
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
                    onClick={() => setRotation(deg)}
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
                      onClick={() => { setCropRect(null); setCropAspect(null) }}
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
                        onClick={() => setCropAspect(ar.value ?? null)}
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
              badge={targetAspect ? ASPECT_RATIOS.find(a => a.value === targetAspect)?.label : undefined}
            >
              <div className="flex flex-wrap gap-1">
                {ASPECT_RATIOS.map((ar) => (
                  <button
                    key={ar.label}
                    type="button"
                    onClick={() => setTargetAspect(ar.value ?? null)}
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
                    onClick={() => { setCustomW(''); setCustomH('') }}
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
                <input type="checkbox" checked={maintainAR} onChange={(e) => setMaintainAR(e.target.checked)} />
                Lock aspect ratio
              </label>
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
                  onClick={handleProcess}
                  disabled={processing}
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
                {result && (
                  <button
                    type="button"
                    onClick={handleDownload}
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
                Open different file
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

