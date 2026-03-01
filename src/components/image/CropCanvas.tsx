import { useCallback, useEffect, useRef, useState } from 'react'

export type CropRect = {
  x: number
  y: number
  width: number
  height: number
}

type Handle =
  | 'nw' | 'n' | 'ne'
  | 'w'          | 'e'
  | 'sw' | 's' | 'se'
  | 'move'

type DragState = {
  handle: Handle
  startMouseX: number
  startMouseY: number
  startRect: CropRect
}

type CropCanvasProps = {
  src: string
  imageWidth: number
  imageHeight: number
  cropRect: CropRect
  onCropChange: (rect: CropRect) => void
  aspectRatio?: number | null
  /** Fine-grained rotation (degrees) applied as visual preview inside the canvas */
  rotation?: number
  /** CSS max-height for the outer wrapper, e.g. '60vh'. Defaults to '60vh'. */
  maxHeight?: string
}

const HANDLE_RADIUS = 6
const CORNER_BRACKET_LEN = 16
const MIN_SIZE = 20
const HIT_SLOP = 10

function clamp(val: number, min: number, max: number) {
  return Math.min(Math.max(val, min), max)
}

function hitHandle(
  mx: number,
  my: number,
  rect: CropRect,
  scale: number,
): Handle | null {
  const r = {
    x: rect.x * scale,
    y: rect.y * scale,
    w: rect.width * scale,
    h: rect.height * scale,
  }
  const cx = r.x + r.w / 2
  const cy = r.y + r.h / 2
  const slop = HANDLE_RADIUS + HIT_SLOP

  const handles: Record<Handle, [number, number]> = {
    nw: [r.x, r.y],
    n: [cx, r.y],
    ne: [r.x + r.w, r.y],
    w: [r.x, cy],
    e: [r.x + r.w, cy],
    sw: [r.x, r.y + r.h],
    s: [cx, r.y + r.h],
    se: [r.x + r.w, r.y + r.h],
    move: [0, 0],
  }

  for (const [handle, [hx, hy]] of Object.entries(handles) as [Handle, [number, number]][]) {
    if (handle === 'move') continue
    if (Math.abs(mx - hx) < slop && Math.abs(my - hy) < slop) return handle
  }

  if (mx > r.x && mx < r.x + r.w && my > r.y && my < r.y + r.h) return 'move'
  return null
}

function cursorForHandle(h: Handle | null): string {
  if (!h) return 'crosshair'
  const map: Record<Handle, string> = {
    nw: 'nw-resize', n: 'n-resize', ne: 'ne-resize',
    w: 'w-resize', e: 'e-resize',
    sw: 'sw-resize', s: 's-resize', se: 'se-resize',
    move: 'move',
  }
  return map[h]
}

function drawRoundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

export default function CropCanvas({
  src,
  imageWidth,
  imageHeight,
  cropRect,
  onCropChange,
  aspectRatio = null,
  rotation = 0,
  maxHeight = '60vh',
}: CropCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const scaleRef = useRef(1)
  const [cursor, setCursor] = useState('crosshair')
  const [isDragging, setIsDragging] = useState(false)

  // Keep latest values in refs so draw() can always read current state
  // without needing to be re-created via useCallback deps.
  const cropRectRef = useRef(cropRect)
  const aspectRatioRef = useRef(aspectRatio)
  const rotationRef = useRef(rotation)
  cropRectRef.current = cropRect
  aspectRatioRef.current = aspectRatio
  rotationRef.current = rotation

  // draw is stable — never recreated, reads from refs
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !imgRef.current) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const scale = scaleRef.current
    const w = canvas.width
    const h = canvas.height
    const cr = cropRectRef.current
    const rot = rotationRef.current
    const ar = aspectRatioRef.current
    const rad = (rot * Math.PI) / 180

    ctx.clearRect(0, 0, w, h)

    // Draw full image (rotated if needed)
    ctx.globalAlpha = 1
    if (rot !== 0) {
      ctx.save()
      ctx.translate(w / 2, h / 2)
      ctx.rotate(rad)
      ctx.drawImage(imgRef.current, -w / 2, -h / 2, w, h)
      ctx.restore()
    } else {
      ctx.drawImage(imgRef.current, 0, 0, w, h)
    }

    // Dark mask outside crop
    ctx.save()
    ctx.globalAlpha = 0.6
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, w, h)

    const cx = cr.x * scale
    const cy = cr.y * scale
    const cw = cr.width * scale
    const ch = cr.height * scale

    // Cut out crop region
    ctx.globalCompositeOperation = 'destination-out'
    ctx.globalAlpha = 1
    drawRoundedRect(ctx, cx, cy, cw, ch, 2)
    ctx.fill()
    ctx.restore()

    // Redraw crisp image inside crop
    ctx.save()
    ctx.beginPath()
    drawRoundedRect(ctx, cx, cy, cw, ch, 2)
    ctx.clip()
    if (rot !== 0) {
      ctx.translate(w / 2, h / 2)
      ctx.rotate(rad)
      ctx.drawImage(imgRef.current, -w / 2, -h / 2, w, h)
    } else {
      ctx.drawImage(imgRef.current, 0, 0, w, h)
    }
    ctx.restore()

    // Crop border
    ctx.save()
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'
    ctx.lineWidth = 1
    ctx.strokeRect(cx + 0.5, cy + 0.5, cw - 1, ch - 1)
    ctx.restore()

    // Rule of thirds grid
    ctx.save()
    ctx.globalAlpha = 0.22
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 0.75
    for (let i = 1; i < 3; i++) {
      const gx = cx + (cw * i) / 3
      const gy = cy + (ch * i) / 3
      ctx.beginPath()
      ctx.moveTo(gx, cy)
      ctx.lineTo(gx, cy + ch)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(cx, gy)
      ctx.lineTo(cx + cw, gy)
      ctx.stroke()
    }
    ctx.restore()

    // Corner bracket handles (L-shaped)
    ctx.save()
    const bl = CORNER_BRACKET_LEN
    type CornerSpec = [number, number, number, number]
    const corners: CornerSpec[] = [
      [cx,      cy,       bl,  bl],
      [cx + cw, cy,      -bl,  bl],
      [cx,      cy + ch,  bl, -bl],
      [cx + cw, cy + ch, -bl, -bl],
    ]
    ctx.shadowColor = 'rgba(0,0,0,0.5)'
    ctx.shadowBlur = 4
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    for (const [x, y, dx, dy] of corners) {
      ctx.beginPath()
      ctx.moveTo(x + dx, y)
      ctx.lineTo(x, y)
      ctx.lineTo(x, y + dy)
      ctx.stroke()
    }
    ctx.restore()

    // Edge mid-point handles
    ctx.save()
    const midPoints: [number, number][] = [
      [cx + cw / 2, cy],
      [cx + cw / 2, cy + ch],
      [cx, cy + ch / 2],
      [cx + cw, cy + ch / 2],
    ]
    ctx.shadowColor = 'rgba(0,0,0,0.4)'
    ctx.shadowBlur = 3
    for (const [hx, hy] of midPoints) {
      ctx.beginPath()
      ctx.arc(hx, hy, HANDLE_RADIUS - 1, 0, Math.PI * 2)
      ctx.fillStyle = '#fff'
      ctx.fill()
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'
      ctx.lineWidth = 1
      ctx.stroke()
    }
    ctx.restore()

    // Dimension overlay
    if (cw > 80 && ch > 40) {
      const label = `${Math.round(cr.width)} × ${Math.round(cr.height)}`
      const fontSize = Math.min(12, Math.max(9, cw / 20))
      ctx.save()
      ctx.font = `500 ${fontSize}px 'IBM Plex Sans', monospace`
      const tw = ctx.measureText(label).width
      const px = 8
      const py = 4
      const rw2 = tw + px * 2
      const rh2 = fontSize + py * 2
      const rx2 = cx + (cw - rw2) / 2
      const ry2 = cy + (ch - rh2) / 2

      ctx.globalAlpha = 0.7
      ctx.fillStyle = '#000'
      drawRoundedRect(ctx, rx2, ry2, rw2, rh2, rh2 / 2)
      ctx.fill()

      ctx.globalAlpha = 1
      ctx.fillStyle = '#fff'
      ctx.textBaseline = 'top'
      ctx.fillText(label, rx2 + px, ry2 + py)
      ctx.restore()
    }

    // Aspect lock label
    if (ar && cw > 70) {
      ctx.save()
      ctx.font = '500 9px IBM Plex Sans, monospace'
      ctx.globalAlpha = 0.6
      ctx.fillStyle = '#4fb8b2'
      ctx.textAlign = 'right'
      ctx.textBaseline = 'top'
      ctx.fillText('⊞ locked', cx + cw - 6, cy + 5)
      ctx.restore()
    }
  }, []) // stable — reads all values from refs

  // Load image once when src changes. draw is intentionally excluded — it's stable
  // and we don't want a full image reload every time cropRect/rotation change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: draw is stable ref, excluded deliberately
  useEffect(() => {
    const img = new Image()
    img.onload = () => {
      imgRef.current = img
      draw()
    }
    img.src = src
  }, [src])

  // Redraw whenever any visual input changes. draw is stable so safe to call from here.
  // biome-ignore lint/correctness/useExhaustiveDependencies: cropRect/aspectRatio/rotation are intentional triggers
  useEffect(() => {
    draw()
  }, [cropRect, aspectRatio, rotation])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const syncSize = () => {
      // Read the canvas's own rendered CSS size — always correct regardless of parent
      const rect = canvas.getBoundingClientRect()
      const displayW = Math.round(rect.width)
      const displayH = Math.round(rect.height)
      if (displayW === 0 || displayH === 0) return
      scaleRef.current = displayW / imageWidth
      canvas.width = displayW
      canvas.height = displayH
      draw()
    }
    const observer = new ResizeObserver(syncSize)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [imageWidth, draw])

  // Keyboard nudge — handled directly on the focusable wrapper div
  function onWrapperKeyDown(e: React.KeyboardEvent) {
    const NUDGE = e.shiftKey ? 10 : 1
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return
    e.preventDefault()
    const cr = cropRect
    let nx = cr.x
    let ny = cr.y
    if (e.key === 'ArrowLeft')  nx = clamp(cr.x - NUDGE, 0, imageWidth - cr.width)
    if (e.key === 'ArrowRight') nx = clamp(cr.x + NUDGE, 0, imageWidth - cr.width)
    if (e.key === 'ArrowUp')    ny = clamp(cr.y - NUDGE, 0, imageHeight - cr.height)
    if (e.key === 'ArrowDown')  ny = clamp(cr.y + NUDGE, 0, imageHeight - cr.height)
    if (nx !== cr.x || ny !== cr.y) onCropChange({ ...cr, x: nx, y: ny })
  }

  function getPos(e: React.MouseEvent | React.TouchEvent): [number, number] {
    const canvas = canvasRef.current
    if (!canvas) return [0, 0]
    const rect = canvas.getBoundingClientRect()
    const client = 'touches' in e ? e.touches[0] ?? e.changedTouches[0] : e
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    return [(client.clientX - rect.left) * scaleX, (client.clientY - rect.top) * scaleY]
  }

  function applyAspectRatio(next: CropRect): CropRect {
    if (!aspectRatio) return next
    const newH = Math.max(MIN_SIZE, next.width / aspectRatio)
    return { ...next, height: Math.min(newH, imageHeight - next.y) }
  }

  function onPointerDown(e: React.MouseEvent | React.TouchEvent) {
    // Grab focus so keyboard nudge works without the user clicking elsewhere
    canvasRef.current?.focus()
    const [mx, my] = getPos(e)
    const scale = scaleRef.current
    const handle = hitHandle(mx, my, cropRect, scale)

    setIsDragging(true)
    if (handle) {
      dragRef.current = {
        handle,
        startMouseX: mx,
        startMouseY: my,
        startRect: { ...cropRect },
      }
    } else {
      const ix = clamp(mx / scale, 0, imageWidth)
      const iy = clamp(my / scale, 0, imageHeight)
      dragRef.current = {
        handle: 'se',
        startMouseX: mx,
        startMouseY: my,
        startRect: { x: ix, y: iy, width: 0, height: 0 },
      }
      onCropChange({ x: ix, y: iy, width: 0, height: 0 })
    }
  }

  function onPointerMove(e: React.MouseEvent | React.TouchEvent) {
    const [mx, my] = getPos(e)
    const scale = scaleRef.current

    if (!dragRef.current) {
      const h = hitHandle(mx, my, cropRect, scale)
      setCursor(cursorForHandle(h))
      return
    }

    const { handle, startMouseX, startMouseY, startRect } = dragRef.current
    const dx = (mx - startMouseX) / scale
    const dy = (my - startMouseY) / scale

    let next = { ...startRect }

    if (handle === 'move') {
      next.x = clamp(startRect.x + dx, 0, imageWidth - startRect.width)
      next.y = clamp(startRect.y + dy, 0, imageHeight - startRect.height)
    } else {
      if (handle === 'se' || handle === 's' || handle === 'sw') {
        next.height = Math.max(MIN_SIZE, startRect.height + dy)
      }
      if (handle === 'ne' || handle === 'n' || handle === 'nw') {
        const newH = Math.max(MIN_SIZE, startRect.height - dy)
        next.y = startRect.y + startRect.height - newH
        next.height = newH
      }
      if (handle === 'se' || handle === 'e' || handle === 'ne') {
        next.width = Math.max(MIN_SIZE, startRect.width + dx)
      }
      if (handle === 'sw' || handle === 'w' || handle === 'nw') {
        const newW = Math.max(MIN_SIZE, startRect.width - dx)
        next.x = startRect.x + startRect.width - newW
        next.width = newW
      }

      next.x = clamp(next.x, 0, imageWidth - MIN_SIZE)
      next.y = clamp(next.y, 0, imageHeight - MIN_SIZE)
      next.width = clamp(next.width, MIN_SIZE, imageWidth - next.x)
      next.height = clamp(next.height, MIN_SIZE, imageHeight - next.y)

      next = applyAspectRatio(next)
    }

    onCropChange(next)
  }

  function onPointerUp() {
    dragRef.current = null
    setIsDragging(false)
  }

  return (
    // tabIndex makes the div focusable so keydown events fire on it directly
    // (avoids fighting with range sliders that swallow shift+arrow on window)
    <div
      className="relative overflow-hidden"
      style={{
        touchAction: 'none',
        borderRadius: '8px',
        // min() ensures the div never causes vertical overflow:
        // - 100% = fill available column width (landscape images)
        // - maxHeight * (imageWidth/imageHeight) = the width at which height === maxHeight (portrait images)
        width: `min(100%, calc(${maxHeight} * ${imageWidth / imageHeight}))`,
        aspectRatio: `${imageWidth} / ${imageHeight}`,
        boxShadow: isDragging
          ? '0 0 0 2px var(--mz-accent)'
          : '0 0 0 1px var(--mz-border)',
        transition: 'box-shadow 120ms ease',
      }}
    >
      <canvas
        ref={canvasRef}
        // tabIndex on canvas is fine — it already has pointer handlers (interactive)
        tabIndex={0}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          cursor,
          userSelect: 'none',
          display: 'block',
          outline: 'none',
        }}
        onMouseDown={onPointerDown}
        onMouseMove={onPointerMove}
        onMouseUp={onPointerUp}
        onMouseLeave={onPointerUp}
        onKeyDown={onWrapperKeyDown}
        onTouchStart={(e) => { e.preventDefault(); onPointerDown(e) }}
        onTouchMove={(e) => { e.preventDefault(); onPointerMove(e) }}
        onTouchEnd={onPointerUp}
      />
      <div
        style={{
          position: 'absolute', bottom: 8, right: 10,
          fontSize: 10, color: 'rgba(255,255,255,0.4)',
          pointerEvents: 'none',
          fontFamily: 'IBM Plex Sans, monospace',
          letterSpacing: '0.02em',
        }}
      >
        ↑↓←→ nudge · shift+arrow ×10
      </div>
    </div>
  )
}
