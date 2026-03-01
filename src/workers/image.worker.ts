/**
 * Image processing Web Worker
 * Performs heavy image operations off the main thread via OffscreenCanvas
 */

export type ImageFormat = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/avif'

export type WorkerRequest =
  | { id: string; type: 'process'; payload: ProcessPayload }

export type ProcessPayload = {
  bitmap: ImageBitmap
  operations: ImageOperation[]
  outputFormat: ImageFormat
  quality: number // 0-1
}

export type ImageOperation =
  | { kind: 'crop'; x: number; y: number; width: number; height: number }
  | { kind: 'rotate'; degrees: number }
  | { kind: 'resize'; width: number; height: number; fit: 'fill' | 'contain' | 'cover' }
  | { kind: 'flip'; axis: 'h' | 'v' }

export type WorkerResponse =
  | { id: string; type: 'result'; blob: Blob; width: number; height: number }
  | { id: string; type: 'error'; message: string }
  | { id: string; type: 'progress'; percent: number }

// ─── Worker internals ────────────────────────────────────────────────────────

function applyRotation(
  source: OffscreenCanvas,
  degrees: number,
): OffscreenCanvas {
  const norm = ((degrees % 360) + 360) % 360
  const swapDims = norm === 90 || norm === 270
  const w = swapDims ? source.height : source.width
  const h = swapDims ? source.width : source.height
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d')!
  ctx.translate(w / 2, h / 2)
  ctx.rotate((norm * Math.PI) / 180)
  ctx.drawImage(source, -source.width / 2, -source.height / 2)
  return canvas
}

function applyCrop(
  source: OffscreenCanvas,
  x: number,
  y: number,
  width: number,
  height: number,
): OffscreenCanvas {
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(source, x, y, width, height, 0, 0, width, height)
  return canvas
}

function applyResize(
  source: OffscreenCanvas,
  targetW: number,
  targetH: number,
  fit: 'fill' | 'contain' | 'cover',
): OffscreenCanvas {
  const srcW = source.width
  const srcH = source.height
  let drawX = 0,
    drawY = 0,
    drawW = targetW,
    drawH = targetH

  if (fit === 'contain') {
    const scale = Math.min(targetW / srcW, targetH / srcH)
    drawW = srcW * scale
    drawH = srcH * scale
    drawX = (targetW - drawW) / 2
    drawY = (targetH - drawH) / 2
  } else if (fit === 'cover') {
    const scale = Math.max(targetW / srcW, targetH / srcH)
    drawW = srcW * scale
    drawH = srcH * scale
    drawX = (targetW - drawW) / 2
    drawY = (targetH - drawH) / 2
  }

  const canvas = new OffscreenCanvas(targetW, targetH)
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(source, drawX, drawY, drawW, drawH)
  return canvas
}

function applyFlip(source: OffscreenCanvas, axis: 'h' | 'v'): OffscreenCanvas {
  const canvas = new OffscreenCanvas(source.width, source.height)
  const ctx = canvas.getContext('2d')!
  if (axis === 'h') {
    ctx.translate(source.width, 0)
    ctx.scale(-1, 1)
  } else {
    ctx.translate(0, source.height)
    ctx.scale(1, -1)
  }
  ctx.drawImage(source, 0, 0)
  return canvas
}

async function processImage(payload: ProcessPayload): Promise<{ blob: Blob; width: number; height: number }> {
  // Start from the ImageBitmap
  let canvas = new OffscreenCanvas(payload.bitmap.width, payload.bitmap.height)
  const initCtx = canvas.getContext('2d')!
  initCtx.drawImage(payload.bitmap, 0, 0)

  // Apply operations in order
  for (const op of payload.operations) {
    if (op.kind === 'crop') {
      canvas = applyCrop(canvas, op.x, op.y, op.width, op.height)
    } else if (op.kind === 'rotate') {
      canvas = applyRotation(canvas, op.degrees)
    } else if (op.kind === 'resize') {
      canvas = applyResize(canvas, op.width, op.height, op.fit)
    } else if (op.kind === 'flip') {
      canvas = applyFlip(canvas, op.axis)
    }
  }

  const quality =
    payload.outputFormat === 'image/png' ? 1 : payload.quality

  const blob = await canvas.convertToBlob({
    type: payload.outputFormat,
    quality,
  })

  return { blob, width: canvas.width, height: canvas.height }
}

// ─── Message handler ──────────────────────────────────────────────────────────

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data
  if (msg.type === 'process') {
    try {
      self.postMessage({ id: msg.id, type: 'progress', percent: 10 } satisfies WorkerResponse)
      const result = await processImage(msg.payload)
      self.postMessage({ id: msg.id, type: 'progress', percent: 90 } satisfies WorkerResponse)
      self.postMessage({ id: msg.id, type: 'result', ...result } satisfies WorkerResponse)
    } catch (err) {
      self.postMessage({
        id: msg.id,
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      } satisfies WorkerResponse)
    }
  }
}
