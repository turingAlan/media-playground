/**
 * Image processor – runs operations in a Web Worker via OffscreenCanvas
 */

import type {
  ImageFormat,
  ImageOperation,
  WorkerRequest,
  WorkerResponse,
} from '../workers/image.worker'

export type { ImageFormat, ImageOperation }

// Re-export formatBytes utility
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / k ** i).toFixed(1)} ${sizes[i]}`
}

// ─── Worker singleton ─────────────────────────────────────────────────────────

let worker: Worker | null = null
const pending = new Map<
  string,
  { resolve: (r: { blob: Blob; width: number; height: number }) => void; reject: (e: Error) => void; onProgress?: (p: number) => void }
>()

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../workers/image.worker', import.meta.url), {
      type: 'module',
    })
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data
      const entry = pending.get(msg.id)
      if (!entry) return
      if (msg.type === 'progress') {
        entry.onProgress?.(msg.percent)
      } else if (msg.type === 'result') {
        pending.delete(msg.id)
        entry.resolve({ blob: msg.blob, width: msg.width, height: msg.height })
      } else if (msg.type === 'error') {
        pending.delete(msg.id)
        entry.reject(new Error(msg.message))
      }
    }
    worker.onerror = (e) => {
      for (const entry of pending.values()) entry.reject(new Error(e.message))
      pending.clear()
    }
  }
  return worker
}

// ─── Public API ───────────────────────────────────────────────────────────────

let idCounter = 0

export type ProcessImageOptions = {
  file: File
  operations: ImageOperation[]
  outputFormat: ImageFormat
  quality?: number // 0–1, default 0.85
  onProgress?: (percent: number) => void
}

export async function processImage(opts: ProcessImageOptions): Promise<{ blob: Blob; width: number; height: number }> {
  const { file, operations, outputFormat, quality = 0.85, onProgress } = opts
  const bitmap = await createImageBitmap(file)
  const id = String(++idCounter)

  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress })
    const req: WorkerRequest = {
      id,
      type: 'process',
      payload: { bitmap, operations, outputFormat, quality },
    }
    const w = getWorker()
    w.postMessage(req, [bitmap])
  })
}

/**
 * Quickly estimate output size without going to the worker.
 * This is a rough heuristic based on typical compression ratios.
 */
export function estimateOutputSize(
  originalBytes: number,
  format: ImageFormat,
  quality: number,
): number {
  const ratios: Record<ImageFormat, number> = {
    'image/jpeg': 0.15 * (1 + quality),
    'image/webp': 0.1 * (1 + quality),
    'image/png': 0.7,
    'image/avif': 0.06 * (1 + quality),
  }
  return Math.round(originalBytes * (ratios[format] ?? 0.5))
}

export const IMAGE_FORMATS: { value: ImageFormat; label: string; ext: string }[] = [
  { value: 'image/jpeg', label: 'JPEG', ext: 'jpg' },
  { value: 'image/png', label: 'PNG', ext: 'png' },
  { value: 'image/webp', label: 'WebP', ext: 'webp' },
  { value: 'image/avif', label: 'AVIF', ext: 'avif' },
]

export const ASPECT_RATIOS = [
  { label: 'Free', value: null },
  { label: '1:1', value: 1 },
  { label: '4:3', value: 4 / 3 },
  { label: '16:9', value: 16 / 9 },
  { label: '9:16', value: 9 / 16 },
  { label: '3:2', value: 3 / 2 },
  { label: '2:3', value: 2 / 3 },
] as const
