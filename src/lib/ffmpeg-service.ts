/**
 * FFmpeg WASM service
 * - Core/WASM blobs are loaded from local node_modules (no CDN)
 * - Each processVideo() call gets its own fresh FFmpeg instance
 *   so multiple formats can be converted in parallel
 * - AV1 (VP9) uses a two-step encode to strip alpha from the source
 *   before passing to libvpx-vp9, avoiding WASM heap crashes
 */

import coreWasmUrl from '@ffmpeg/core/wasm?url'
import coreJsUrl from '@ffmpeg/core?url'
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'

export type VideoFormat = 'mp4' | 'webm' | 'avi' | 'mov' | 'mkv' | 'gif' | 'hevc' | 'av1'

export type VideoProcessOptions = {
  format: VideoFormat
  /** CRF value 0-51, lower = better quality. ~23 default */
  crf?: number
  /** Remove audio track */
  removeAudio?: boolean
  /** Target audio bitrate e.g. '128k', '64k', '320k' */
  audioBitrate?: string
  /** Target resolution e.g. '1920:1080', '1280:720', '-1:720' */
  scale?: string
  /** Preset: ultrafast ... veryslow */
  preset?: string
  /** Trim start seconds (input-side fast seek) */
  trimStart?: number
  /** Trim end seconds (absolute, from original start) */
  trimEnd?: number
}

export type ProgressCallback = (ratio: number) => void

// ─── Blob URL cache ───────────────────────────────────────────────────────────

let blobCache: Promise<{ coreURL: string; wasmURL: string }> | null = null

function getBlobURLs() {
  if (!blobCache) {
    blobCache = Promise.all([
      toBlobURL(coreJsUrl,   'text/javascript'),
      toBlobURL(coreWasmUrl, 'application/wasm'),
    ]).then(([coreURL, wasmURL]) => ({ coreURL, wasmURL }))
  }
  return blobCache
}

// ─── Warm-up (call on app mount) ─────────────────────────────────────────────

export async function loadFFmpeg(): Promise<void> {
  await getBlobURLs()
}

// ─── Trim helpers ────────────────────────────────────────────────────────────

/** Args to prepend before `-i` and append before `-y output` for trimming. */
function buildTrimArgs(opts: VideoProcessOptions): { pre: string[]; dur: string[] } {
  const pre: string[] = []
  const dur: string[] = []
  if (opts.trimStart && opts.trimStart > 0) pre.push('-ss', opts.trimStart.toFixed(3))
  if (opts.trimEnd !== undefined) {
    const start   = opts.trimStart ?? 0
    const length  = opts.trimEnd - start
    if (length > 0) dur.push('-t', length.toFixed(3))
  }
  return { pre, dur }
}

// ─── Per-job instance factory ─────────────────────────────────────────────────

async function createInstance(): Promise<FFmpeg> {
  const { coreURL, wasmURL } = await getBlobURLs()
  const ff = new FFmpeg()
  await ff.load({ coreURL, wasmURL })
  return ff
}

// ─── Codec / container maps ───────────────────────────────────────────────────
// @ffmpeg/core 0.12.x standard build does NOT include libx265 or libaom-av1.
// 'hevc' => libx264 H.264 high-quality (veryslow preset, low CRF)
// 'av1'  => libvpx VP8 WebM (VP9 OOMs in single-thread WASM on real files)

const CODEC_MAP: Record<VideoFormat, string> = {
  mp4:  'libx264',
  webm: 'libvpx',      // VP8 — much faster in WASM and fully stable
  mov:  'libx264',
  mkv:  'libx264',
  avi:  'libxvid',
  gif:  'gif',
  hevc: 'libx264',
  av1:  'libvpx',    // VP8 WebM — VP9 OOMs in ST WASM; same container, reliable
}

const EXT_MAP: Partial<Record<VideoFormat, string>> = {
  hevc: 'mp4',
  av1:  'webm',
}

const MIME_MAP: Record<VideoFormat, string> = {
  mp4:  'video/mp4',
  webm: 'video/webm',
  avi:  'video/x-msvideo',
  mov:  'video/quicktime',
  mkv:  'video/x-matroska',
  gif:  'image/gif',
  hevc: 'video/mp4',
  av1:  'video/webm',
}

// ─── Processing ───────────────────────────────────────────────────────────────

export async function processVideo(
  file: File,
  options: VideoProcessOptions,
  onProgress?: ProgressCallback,
): Promise<Blob> {
  const ff = await createInstance()
  onProgress?.(0.01)

  const logs: string[] = []

  function parseTime(hms: string): number {
    const [h, m, s] = hms.split(':').map(Number)
    return h * 3600 + m * 60 + s
  }

  // Single shared progress state — phase is updated between steps so a single
  // listener covers both steps without the listener-leak problem of calling
  // ff.on() multiple times (listeners are additive in @ffmpeg/ffmpeg).
  let progressLo = 0.01
  let progressHi = 0.99
  let totalSecs  = 0
  let statsLinesSeen = 0

  function setProgressPhase(lo: number, hi: number) {
    progressLo     = lo
    progressHi     = hi
    totalSecs      = 0   // reset so new Duration: is picked up for this step
    statsLinesSeen = 0
  }

  ff.on('log', ({ message }: { message: string }) => {
    logs.push(message)
    if (!onProgress) return
    if (totalSecs === 0) {
      const dm = message.match(/Duration:\s*(\d+:\d+:\d+\.?\d*)/)
      if (dm) totalSecs = parseTime(dm[1])
    }
    const tm = message.match(/time=(\d+:\d+:\d+\.?\d*)/)
    if (tm) {
      let ratio: number
      if (totalSecs > 0) {
        ratio = Math.min(parseTime(tm[1]) / totalSecs, 0.99)
      } else {
        statsLinesSeen++
        ratio = Math.min(1 - Math.exp(-statsLinesSeen / 12), 0.95)
      }
      onProgress(progressLo + ratio * (progressHi - progressLo))
    }
  })

  const outExt  = EXT_MAP[options.format] ?? options.format
  const inName  = `input.${file.name.split('.').pop() ?? 'bin'}`
  const outName = `output.${outExt}`
  const codec   = CODEC_MAP[options.format]

  await ff.writeFile(inName, await fetchFile(file))

  // ── AV1 slot: two-step encode to strip alpha, then VP8 WebM ───────────────
  // Step 1: transcode to clean MP4 — removes alpha_mode=1 (YUVA420P) carried
  // by MediaRecorder/canvas WebM sources that crash libvpx in single-thread WASM.
  // Step 2: encode clean MP4 to VP8 WebM. VP9 reliably OOMs on real-size files
  // in ST WASM regardless of deadline setting; VP8 uses a fraction of the memory.
  const { pre: tPre, dur: tDur } = buildTrimArgs(options)

  if (options.format === 'av1') {
    // Step 1 — 1→40%: decode to clean MP4 (strips alpha, normalises pix_fmt)
    // Trim is applied here so step 2 works on the already-trimmed source.
    setProgressPhase(0.01, 0.4)
    const preArgs = [
      ...tPre, '-i', inName,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'ultrafast', '-crf', '18',
      '-c:a', 'aac',
      ...tDur, '-y', 'pre.mp4',
    ]
    const r1 = await ff.exec(preArgs)
    if (r1 !== 0) throw new Error(`Pre-transcode failed (${r1}):\n${logs.slice(-10).join('\n')}`)

    // Step 2 — 40→99%: encode from clean source.
    // VP9 (libvpx-vp9) reliably OOMs in single-thread WASM on real-world files
    // even with deadline realtime. VP8 (libvpx) uses a fraction of the memory and
    // is confirmed stable — same .webm container, broadly supported everywhere.
    setProgressPhase(0.4, 0.99)
    const vp8Args = [
      '-i', 'pre.mp4',
      '-c:v', 'libvpx',
      '-b:v', '1200k',
      '-quality', 'good', '-cpu-used', '3',
      '-qmin', '4', '-qmax', '48',
    ]
    if (options.scale) vp8Args.push('-vf', `scale=${options.scale}`)
    if (options.removeAudio) {
      vp8Args.push('-an')
    } else {
      vp8Args.push('-c:a', 'libvorbis', '-b:a', options.audioBitrate ?? '128k')
    }
    vp8Args.push('-y', outName)

    const r2 = await ff.exec(vp8Args)
    if (r2 !== 0) throw new Error(`VP8 encode failed (${r2}):\n${logs.slice(-10).join('\n')}`)

    const data = await ff.readFile(outName)
    return new Blob([new Uint8Array(data as Uint8Array)], { type: MIME_MAP.av1 })
  }

  // ── All other formats ─────────────────────────────────────────────────────
  // setProgressPhase already initialised to 0.01→0.99 above

  // GIF: handle separately — two-pass palette generation with fps throttle.
  // Must be done before the generic args block because GIF needs no audio args.
  if (options.format === 'gif') {
    const palette = 'palette.png'
    // Cap to 15fps — processing every frame of 24/30fps video OOMs WASM quickly.
    // Default scale to 480px wide if none specified, to keep file size sane.
    const scaleF  = options.scale ?? '480:-1'
    const step1Filter = `fps=15,scale=${scaleF}:flags=lanczos,palettegen`
    const step2Filter = `[0:v] fps=15,scale=${scaleF}:flags=lanczos [x]; [x][1:v] paletteuse`

    const r1 = await ff.exec([...tPre, '-i', inName, ...tDur, '-vf', step1Filter, '-y', palette])
    if (r1 !== 0) throw new Error(`GIF palette failed (${r1}):\n${logs.slice(-20).join('\n')}`)

    const r2 = await ff.exec([...tPre, '-i', inName, ...tDur, '-i', palette, '-filter_complex', step2Filter, '-y', outName])
    if (r2 !== 0) throw new Error(`GIF encode failed (${r2}):\n${logs.slice(-20).join('\n')}`)

    const data = await ff.readFile(outName)
    return new Blob([new Uint8Array(data as Uint8Array)], { type: MIME_MAP.gif })
  }

  const args: string[] = [...tPre, '-i', inName]

  // Video codec
  if (codec !== 'gif') {
    args.push('-c:v', codec)
  }

  // CRF quality
  if (options.crf !== undefined &&
      ['libx264', 'libx265', 'libvpx', 'libvpx-vp9', 'libaom-av1'].includes(codec)) {
    args.push('-crf', String(options.crf))
  }

  // Codec-specific speed / bitrate controls
  if (codec === 'libvpx') {
    // VP8: use bitrate ceiling alongside CRF for constrained-quality mode
    args.push('-b:v', '2M')
    const q: Record<string, string> = {
      ultrafast: '5', fast: '4', medium: '3', slow: '2', veryslow: '1',
    }
    args.push('-quality', 'good', '-cpu-used', q[options.preset ?? 'medium'] ?? '3')
  } else if (codec === 'libx264') {
    // HEVC mode: force highest quality preset
    const p = options.format === 'hevc' ? 'veryslow' : (options.preset ?? 'medium')
    args.push('-preset', p)
  }

  // Pixel format for broad playback compat
  if (['mp4', 'mov', 'mkv', 'hevc'].includes(options.format)) {
    args.push('-pix_fmt', 'yuv420p')
  }

  // Audio — WebM/AV1 needs Vorbis (libopus is not in the standard @ffmpeg/core WASM build);
  // everything else uses AAC
  if (options.removeAudio) {
    args.push('-an')
  } else {
    const needsVorbis = ['webm', 'av1'].includes(options.format)
    args.push('-c:a', needsVorbis ? 'libvorbis' : 'aac', '-b:a', options.audioBitrate ?? '128k')
  }

  // Scale
  if (options.scale) {
    args.push('-vf', `scale=${options.scale}`)
  }

  // GIF is handled above and returns early. All remaining formats use args.
  args.push(...tDur)
  args.push('-y', outName)
  const ret = await ff.exec(args)
  if (ret !== 0) throw new Error(`FFmpeg failed (code ${ret}):\n${logs.slice(-20).join('\n')}`)

  const data = await ff.readFile(outName)
  await ff.deleteFile(inName)
  await ff.deleteFile(outName)

  return new Blob([new Uint8Array(data as Uint8Array)], { type: MIME_MAP[options.format] })
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / k ** i).toFixed(1)} ${sizes[i]}`
}
