import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
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

function TrimBar({
  duration, start, end, onStartChange, onEndChange, videoRef,
}: {
  duration: number
  start: number
  end: number
  onStartChange: (v: number) => void
  onEndChange:   (v: number) => void
  videoRef?: React.RefObject<HTMLVideoElement>
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const MIN_GAP  = Math.max(0.25, duration * 0.005)

  function posToSec(clientX: number) {
    if (!trackRef.current) return 0
    const rect = trackRef.current.getBoundingClientRect()
    return Math.max(0, Math.min(duration, ((clientX - rect.left) / rect.width) * duration))
  }

  function startDrag(which: 'start' | 'end') {
    return (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault()
      const move = (ev: MouseEvent | TouchEvent) => {
        const x   = 'touches' in ev ? ev.touches[0].clientX : ev.clientX
        const sec = posToSec(x)
        if (which === 'start') {
          const v = Math.max(0, Math.min(sec, end - MIN_GAP))
          onStartChange(v)
          if (videoRef?.current) videoRef.current.currentTime = v
        } else {
          onEndChange(Math.min(duration, Math.max(sec, start + MIN_GAP)))
        }
      }
      const up = () => {
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

  const s = (start / duration) * 100
  const e = (end   / duration) * 100

  const handleStyle: React.CSSProperties = {
    position: 'absolute', top: '50%', transform: 'translate(-50%, -50%)',
    width: 13, height: 24, borderRadius: 3,
    background: 'var(--mz-amber)', cursor: 'ew-resize',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    boxShadow: '0 1px 5px rgba(0,0,0,0.45)',
    zIndex: 2,
  }

  return (
    <div ref={trackRef} style={{ position: 'relative', height: 32, userSelect: 'none' }}>
      {/* Base track */}
      <div style={{
        position: 'absolute', top: '50%', left: 0, right: 0, height: 6,
        transform: 'translateY(-50%)', background: 'var(--mz-surface-2)',
        borderRadius: 3, border: '1px solid var(--mz-border)',
      }} />
      {/* Dimmed left (cut) */}
      <div style={{
        position: 'absolute', top: '50%', left: 0, width: `${s}%`, height: 6,
        transform: 'translateY(-50%)', background: 'rgba(0,0,0,0.3)', borderRadius: '3px 0 0 3px',
      }} />
      {/* Active range */}
      <div style={{
        position: 'absolute', top: '50%', left: `${s}%`, width: `${e - s}%`, height: 6,
        transform: 'translateY(-50%)', background: 'var(--mz-amber)', opacity: 0.85,
      }} />
      {/* Dimmed right (cut) */}
      <div style={{
        position: 'absolute', top: '50%', left: `${e}%`, right: 0, height: 6,
        transform: 'translateY(-50%)', background: 'rgba(0,0,0,0.3)', borderRadius: '0 3px 3px 0',
      }} />
      {/* Start handle */}
      <button
        type="button" aria-label="Trim start"
        style={{ ...handleStyle, left: `${s}%` }}
        onMouseDown={startDrag('start')} onTouchStart={startDrag('start')}>
        <div style={{ width: 2, height: 10, background: 'rgba(0,0,0,0.4)', borderRadius: 1 }} />
      </button>
      {/* End handle */}
      <button
        type="button" aria-label="Trim end"
        style={{ ...handleStyle, left: `${e}%` }}
        onMouseDown={startDrag('end')} onTouchStart={startDrag('end')}>
        <div style={{ width: 2, height: 10, background: 'rgba(0,0,0,0.4)', borderRadius: 1 }} />
      </button>
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
  const [file, setFile]       = useState<File | null>(null)
  const [fileUrl, setFileUrl] = useState<string | null>(null)

  const [selectedFormats, setSelectedFormats] = useState<VideoFormat[]>(['mp4'])
  const [crf, setCrf]                   = useState(23)
  const [removeAudio, setRemoveAudio]   = useState(false)
  const [audioBitrate, setAudioBitrate] = useState('128k')
  const [scale, setScale]               = useState<string | null>(null)
  const [preset, setPreset]             = useState('medium')

  const [ffmpegLoaded, setFfmpegLoaded]   = useState(false)
  const [ffmpegLoading, setFfmpegLoading] = useState(false)
  const [loadError, setLoadError]         = useState<string | null>(null)
  const [processing, setProcessing]       = useState(false)
  // per-format progress 0-100
  const [formatProgress, setFormatProgress] = useState<Partial<Record<VideoFormat, number>>>({})
  const [results, setResults]             = useState<VideoResult[]>([])
  const [errors, setErrors]               = useState<Partial<Record<VideoFormat, string>>>({})
  const [videoError, setVideoError]       = useState(false)
  const [poster, setPoster]               = useState<string | null>(null)

  // trim
  const videoRef                            = useRef<HTMLVideoElement>(null)
  const [videoDuration, setVideoDuration]   = useState(0)
  const [trimEnabled, setTrimEnabled]       = useState(false)
  const [trimStart, setTrimStart]           = useState(0)
  const [trimEnd, setTrimEnd]               = useState(0)

  // ref so parallel callbacks see latest results without stale closure
  const resultsRef = useRef<VideoResult[]>([])

  useEffect(() => {
    if (ffmpegLoaded || ffmpegLoading) return
    setFfmpegLoading(true)
    setLoadError(null)
    loadFFmpeg()
      .then(() => setFfmpegLoaded(true))
      .catch((e) => setLoadError(e instanceof Error ? e.message : 'Failed to load FFmpeg'))
      .finally(() => setFfmpegLoading(false))
  }, [ffmpegLoaded, ffmpegLoading])

  const handleFile = useCallback((f: File) => {
    setFile(f)
    const url = URL.createObjectURL(f)
    setFileUrl(url)
    setResults([])
    setErrors({})
    setTrimEnabled(false)
    setTrimStart(0)
    setTrimEnd(0)
    setVideoDuration(0)
    setVideoError(false)
    setPoster(null)
    // generate thumbnail at ~1 s (or 10 % of duration)
    const thumb = document.createElement('video')
    thumb.preload = 'metadata'
    thumb.muted = true
    thumb.playsInline = true
    thumb.src = url
    const capture = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width  = thumb.videoWidth  || 640
        canvas.height = thumb.videoHeight || 360
        canvas.getContext('2d')?.drawImage(thumb, 0, 0, canvas.width, canvas.height)
        setPoster(canvas.toDataURL('image/jpeg', 0.7))
      } catch {
        // ignore cross-origin / decode errors
      } finally {
        thumb.src = ''
      }
    }
    thumb.addEventListener('seeked', capture, { once: true })
    thumb.addEventListener('loadedmetadata', () => {
      const seekTo = Math.min(1, thumb.duration * 0.1 || 0)
      thumb.currentTime = seekTo > 0 ? seekTo : 0
    }, { once: true })
    thumb.addEventListener('error', () => { thumb.src = '' }, { once: true })
  }, [])

  useEffect(() => () => { if (fileUrl) URL.revokeObjectURL(fileUrl) }, [fileUrl])

  function toggleFormat(fmt: VideoFormat) {
    setSelectedFormats((prev) => {
      if (prev.includes(fmt)) return prev.length === 1 ? prev : prev.filter((f) => f !== fmt)
      return [...prev, fmt]
    })
  }

  async function handleProcess() {
    if (!file || !ffmpegLoaded || selectedFormats.length === 0) return
    setProcessing(true)
    for (const r of resultsRef.current) URL.revokeObjectURL(r.url)
    resultsRef.current = []
    setResults([])
    setErrors({})
    setFormatProgress(Object.fromEntries(selectedFormats.map((f) => [f, 1])))

    // Launch all formats in parallel — each gets its own FFmpeg instance
    await Promise.allSettled(
      selectedFormats.map(async (fmt) => {
        const fmtDef = VIDEO_FORMATS.find((f) => f.value === fmt)!
        try {
          const blob = await processVideo(
            file,
            {
              format: fmt, crf, removeAudio,
              audioBitrate: removeAudio ? undefined : audioBitrate,
              scale: scale ?? undefined, preset,
              trimStart: trimEnabled ? trimStart : undefined,
              trimEnd:   trimEnabled ? trimEnd   : undefined,
            },
            (p) => setFormatProgress((prev) => ({ ...prev, [fmt]: Math.max(1, Math.round(p * 100)) })),
          )
          const result: VideoResult = { blob, url: URL.createObjectURL(blob), format: fmt, ext: fmtDef.ext }
          resultsRef.current = [...resultsRef.current, result]
          setResults([...resultsRef.current])
          setVideoError(false)
          setFormatProgress((prev) => ({ ...prev, [fmt]: 100 }))
        } catch (e) {
          setErrors((prev) => ({ ...prev, [fmt]: e instanceof Error ? e.message : 'Failed' }))
          setFormatProgress((prev) => ({ ...prev, [fmt]: -1 }))
        }
      })
    )

    setProcessing(false)
  }

  function handleReset() {
    for (const r of resultsRef.current) URL.revokeObjectURL(r.url)
    resultsRef.current = []
    setFile(null); setFileUrl(null); setResults([]); setErrors({}); setFormatProgress({})
    setTrimEnabled(false); setTrimStart(0); setTrimEnd(0); setVideoDuration(0)
    setVideoError(false); setPoster(null)
  }

  function handleDownload(r: VideoResult) {
    if (!file) return
    const base   = file.name.replace(/\.[^.]+$/, '')
    const suffix = selectedFormats.length > 1 ? `-${r.format}` : ''
    const a      = document.createElement('a')
    a.href       = r.url
    a.download   = `${base}-mz${suffix}.${r.ext}`
    a.click()
  }

  function handleDownloadAll() {
    results.forEach((r, i) => setTimeout(() => handleDownload(r), i * 150))
  }

  // Overall progress = average of all running formats
  const fmtProgressValues = Object.values(formatProgress).filter((v) => (v ?? -1) >= 0)
  const overallProgress   = fmtProgressValues.length
    ? Math.round(fmtProgressValues.reduce((a, b) => a + (b ?? 0), 0) / selectedFormats.length)
    : 0

  const previewUrl  = results.length > 0 ? results[results.length - 1].url : fileUrl
  const previewMime = results.length > 0 ? results[results.length - 1].blob.type : (file?.type ?? '')
  const errorList   = Object.entries(errors) as [VideoFormat, string][]

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
        <div className="flex-1" />
        <span className="mz-badge">FFmpeg · WASM</span>
      </div>

      {!file ? (
        <div className="flex flex-1 items-center justify-center px-6 py-12">
          <div className="w-full max-w-sm">
            <p className="mz-label mb-3">Video Studio</p>
            <h1 className="mb-2 text-[30px] font-light tracking-tight leading-none" style={{ color: 'var(--mz-text)' }}>
              Drop a video
            </h1>
            <p className="mb-8 text-sm" style={{ color: 'var(--mz-text-2)' }}>
              Convert, compress, strip audio and export to multiple formats in parallel — entirely in your browser.
            </p>
            {(ffmpegLoading || loadError) && (
              <div className="mb-4 flex items-center gap-2.5 rounded-md px-3 py-2.5 text-xs"
                style={{
                  border: `1px solid ${loadError ? 'var(--mz-error)' : 'var(--mz-border-2)'}`,
                  background: loadError ? 'rgba(255,82,82,0.06)' : 'var(--mz-surface-2)',
                  color: loadError ? 'var(--mz-error)' : 'var(--mz-text-2)',
                }}
              >
                {ffmpegLoading && !loadError && (
                  <svg aria-hidden="true" className="animate-spin shrink-0" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" strokeOpacity="0.3" /><path d="M12 2a10 10 0 0 1 10 10" />
                  </svg>
                )}
                {loadError ?? 'Loading FFmpeg WASM engine...'}
              </div>
            )}
            <DropZone
              accept={['video/*', '.mp4', '.webm', '.mov', '.avi', '.mkv']}
              onFile={handleFile}
              label="Drop a video here"
              sublabel="MP4, WebM, MOV, AVI, MKV"
            />
          </div>
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          {/* Preview column */}
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
                <video key={previewUrl ?? ''} ref={videoRef} controls
                  poster={poster ?? undefined}
                  className="block w-full rounded-sm" style={{ maxHeight: '58vh', background: '#000' }}
                  onLoadedMetadata={() => {
                    if (!videoRef.current) return
                    const dur = videoRef.current.duration
                    if (Number.isFinite(dur) && dur > 0) {
                      setVideoDuration(dur)
                      setTrimStart(0)
                      setTrimEnd(dur)
                    }
                  }}
                  onError={() => setVideoError(true)}
                >
                  {previewUrl && <source src={previewUrl} type={previewMime || undefined} />}
                </video>
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
                <span className="mz-mono truncate max-w-[200px]" style={{ color: 'var(--mz-text)', fontSize: '11px' }}>{file.name}</span>
                <span className="mz-mono" style={{ color: 'var(--mz-text-2)', fontSize: '11px' }}>{formatBytes(file.size)}</span>
                {results.length === 1 && (
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

            {/* Outputs */}
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
                  {results.length > 1 && !processing && (
                    <button type="button" onClick={handleDownloadAll}
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
                    const saved  = file.size > 0 ? Math.round((1 - r.blob.size / file.size) * 100) : 0
                    return (
                      <div key={r.format} className="flex items-center gap-3 rounded-md px-3 py-2"
                        style={{ background: 'var(--mz-surface-2)', border: '1px solid var(--mz-border)' }}>
                        <span className="font-semibold text-xs" style={{ color: 'var(--mz-text)', minWidth: 40 }}>{fmtDef.label}</span>
                        <span className="opacity-40 text-[10px]">{fmtDef.desc}</span>
                        <span className="mz-mono text-[11px]" style={{ color: 'var(--mz-text-2)' }}>{formatBytes(r.blob.size)}</span>
                        {saved > 0 && <span className="mz-badge mz-badge-amber">-{saved}%</span>}
                        <div className="flex-1" />
                        <button type="button" onClick={() => handleDownload(r)}
                          className="mz-btn mz-btn-ghost" style={{ padding: '4px 10px', fontSize: '11px', gap: 4 }}>
                          <svg aria-hidden="true" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
                          </svg>
                          .{r.ext}
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="flex w-72 shrink-0 flex-col overflow-y-auto border-l px-4 pt-4 pb-3 xl:w-80"
            style={{ borderColor: 'var(--mz-border)', background: 'var(--mz-surface)' }}>

            {!ffmpegLoaded && (
              <div className="mb-3 flex items-center gap-2 rounded-md px-3 py-2.5 text-xs"
                style={{
                  border: `1px solid ${loadError ? 'var(--mz-error)' : 'var(--mz-border-2)'}`,
                  background: loadError ? 'rgba(255,82,82,0.06)' : 'var(--mz-surface-2)',
                  color: loadError ? 'var(--mz-error)' : 'var(--mz-text-2)',
                }}>
                {ffmpegLoading && !loadError && (
                  <svg aria-hidden="true" className="animate-spin shrink-0" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" strokeOpacity="0.3" /><path d="M12 2a10 10 0 0 1 10 10" />
                  </svg>
                )}
                {loadError ?? 'Loading FFmpeg WASM...'}
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

            <Section
              title="Trim"
              badge={trimEnabled && videoDuration > 0 ? `${fmtTime(trimStart)} – ${fmtTime(trimEnd)}` : undefined}
            >
              <div className="space-y-3">
                <label className="flex cursor-pointer items-center gap-3">
                  <button type="button" onClick={() => setTrimEnabled((v) => !v)}
                    className={`mz-toggle ${trimEnabled ? 'is-on' : ''}`}>
                    <span className="mz-toggle-knob" />
                  </button>
                  <span className="text-xs font-semibold" style={{ color: 'var(--mz-text)' }}>Trim clip</span>
                </label>
                {trimEnabled && videoDuration > 0 && (
                  <>
                    <TrimBar
                      duration={videoDuration}
                      start={trimStart}
                      end={trimEnd}
                      onStartChange={setTrimStart}
                      onEndChange={setTrimEnd}
                      videoRef={videoRef as React.RefObject<HTMLVideoElement>}
                    />
                    <div className="flex items-center justify-between gap-1 mt-1">
                      <div className="flex flex-col items-start gap-0.5">
                        <span style={{ fontSize: 9, color: 'var(--mz-text-2)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Start</span>
                        <input
                          type="number" min={0} max={trimEnd - 0.25} step={0.1}
                          value={trimStart.toFixed(1)}
                          onChange={(e) => setTrimStart(Math.max(0, Math.min(+e.target.value, trimEnd - 0.25)))}
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
                          onChange={(e) => setTrimEnd(Math.min(videoDuration, Math.max(+e.target.value, trimStart + 0.25)))}
                          className="mz-mono"
                          style={{ width: 56, fontSize: 12, background: 'var(--mz-surface-2)', border: '1px solid var(--mz-border)', borderRadius: 4, padding: '3px 6px', color: 'var(--mz-amber)', textAlign: 'right' }}
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setTrimStart(0); setTrimEnd(videoDuration) }}
                      style={{ fontSize: '10px', color: 'var(--mz-text-2)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--mz-text)' }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--mz-text-2)' }}
                    >
                      Reset to full
                    </button>
                  </>
                )}
                {trimEnabled && videoDuration === 0 && (
                  <p style={{ fontSize: '10px', color: 'var(--mz-text-2)' }}>Waiting for video metadata…</p>
                )}
              </div>
            </Section>

            <div className="flex-1" />

            <div className="flex flex-col gap-1.5">
              <button type="button" onClick={handleProcess}
                disabled={processing || !ffmpegLoaded}
                className="mz-btn mz-btn-primary gap-1.5"
                style={!processing && ffmpegLoaded ? { background: 'var(--mz-amber)', borderColor: 'var(--mz-amber)', color: 'var(--mz-accent-fg)' } : {}}>
                {processing ? (
                  <>
                    <svg aria-hidden="true" className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" strokeOpacity="0.3"/><path d="M12 2a10 10 0 0 1 10 10"/>
                    </svg>
                    {overallProgress > 0 ? `${overallProgress}%` : 'Processing...'}
                  </>
                ) : !ffmpegLoaded ? 'Loading engine...' : (
                  results.length > 0
                    ? `Re-process${selectedFormats.length > 1 ? ` (${selectedFormats.length})` : ''}`
                    : `Process${selectedFormats.length > 1 ? ` ${selectedFormats.length} in parallel` : ' Video'}`
                )}
              </button>

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
                Open different file
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
