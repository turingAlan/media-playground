import { createFileRoute } from '@tanstack/react-router'
import type {
  CornerDotType,
  CornerSquareType,
  DotType,
  ErrorCorrectionLevel,
} from 'qr-code-styling'
import QRCodeStyling from 'qr-code-styling'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CmdKTrigger } from '#/components/CommandPalette'
import PresetsPanel from '#/components/PresetsPanel'
import {
  addHistory,
  deleteQRPreset,
  LOAD_QR_PRESET_EVENT,
  type QRPreset,
  renameQRPreset,
  saveQRPreset,
  useHistory,
  useQRPresets,
} from '#/lib/store'

export const Route = createFileRoute('/qr')({ component: QRStudio })

// ─── Types ────────────────────────────────────────────────────────────────────

type GradientConfig = {
  type: 'linear' | 'radial'
  rotation: number
  color1: string
  color2: string
}

type ColorConfig =
  | { mode: 'solid'; color: string }
  | { mode: 'gradient'; gradient: GradientConfig }

type QRSettings = {
  data: string
  errorLevel: ErrorCorrectionLevel
  margin: number
  shape: 'square' | 'circle'

  dotType: DotType
  dotColor: ColorConfig

  bgTransparent: boolean
  bgColor: string

  csType: CornerSquareType | ''
  csColorInherit: boolean
  csColor: ColorConfig

  cdType: CornerDotType | ''
  cdColorInherit: boolean
  cdColor: ColorConfig

  logoDataUrl: string | null
  logoSize: number
  logoMargin: number
  logoHideDots: boolean

  exportFormat: 'png' | 'svg' | 'jpeg' | 'webp'
  exportSize: number
}

// ─── Default settings ─────────────────────────────────────────────────────────

const DEFAULT: QRSettings = {
  data: 'https://example.com',
  errorLevel: 'M',
  margin: 16,
  shape: 'square',
  dotType: 'square',
  dotColor: { mode: 'solid', color: '#1CE8B5' },
  bgTransparent: false,
  bgColor: '#0B0C11',
  csType: '',
  csColorInherit: true,
  csColor: { mode: 'solid', color: '#DDE2EA' },
  cdType: '',
  cdColorInherit: true,
  cdColor: { mode: 'solid', color: '#DDE2EA' },
  logoDataUrl: null,
  logoSize: 0.3,
  logoMargin: 8,
  logoHideDots: true,
  exportFormat: 'png',
  exportSize: 1024,
}

// ─── Helpers: color config → qr-code-styling format ──────────────────────────

function toQRColor(c: ColorConfig): { color?: string; gradient?: { type: 'linear' | 'radial'; rotation?: number; colorStops: { offset: number; color: string }[] } } {
  if (c.mode === 'solid') return { color: c.color }
  return {
    gradient: {
      type: c.gradient.type,
      rotation: c.gradient.rotation,
      colorStops: [
        { offset: 0, color: c.gradient.color1 },
        { offset: 1, color: c.gradient.color2 },
      ],
    },
  }
}

function buildOptions(s: QRSettings, overrideSize?: number): ConstructorParameters<typeof QRCodeStyling>[0] {
  const size = overrideSize ?? 320
  return {
    width: size,
    height: size,
    type: 'canvas',
    shape: s.shape,
    data: s.data || 'https://example.com',
    image: s.logoDataUrl ?? undefined,
    margin: s.margin,
    qrOptions: { errorCorrectionLevel: s.errorLevel },
    imageOptions: {
      hideBackgroundDots: s.logoHideDots,
      imageSize: s.logoSize,
      margin: s.logoMargin,
      crossOrigin: 'anonymous',
    },
    dotsOptions: {
      type: s.dotType,
      ...toQRColor(s.dotColor),
    },
    backgroundOptions: s.bgTransparent
      ? { color: '#00000000' }
      : { color: s.bgColor },
    cornersSquareOptions: {
      type: s.csType || undefined,
      ...(s.csColorInherit ? toQRColor(s.dotColor) : toQRColor(s.csColor)),
    },
    cornersDotOptions: {
      type: s.cdType || undefined,
      ...(s.cdColorInherit ? toQRColor(s.dotColor) : toQRColor(s.cdColor)),
    },
  }
}

// ─── Tiny UI primitives ───────────────────────────────────────────────────────

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
    <div style={{ borderBottom: '1px solid var(--mz-border)', paddingBottom: 14, marginBottom: 14 }}>
      <div className="flex items-center justify-between mb-2.5">
        <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: accent ? 'var(--mz-accent)' : 'var(--mz-text-2)' }}>
          {title}
        </span>
        {badge && <span className={`mz-badge ${accent ? 'mz-badge-accent' : ''}`}>{badge}</span>}
      </div>
      {children}
    </div>
  )
}

function ChipGroup<T extends string>({
  options,
  value,
  onChange,
  cols = 3,
}: {
  options: { label: string; value: T }[]
  value: T
  onChange: (v: T) => void
  cols?: number
}) {
  return (
    <div className={`grid gap-1`} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`mz-chip justify-center ${value === o.value ? 'is-active' : ''}`}
          style={{ fontSize: '11px', padding: '5px 4px' }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function ColorSection({
  label,
  config,
  onChange,
}: {
  label?: string
  config: ColorConfig
  onChange: (c: ColorConfig) => void
}) {
  return (
    <div className="space-y-2">
      {label && <span className="mz-label">{label}</span>}
      {/* Mode toggle */}
      <div className="flex gap-1">
        {(['solid', 'gradient'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() =>
              onChange(
                m === 'solid'
                  ? { mode: 'solid', color: config.mode === 'solid' ? config.color : '#1CE8B5' }
                  : {
                      mode: 'gradient',
                      gradient: {
                        type: 'linear',
                        rotation: 0,
                        color1: config.mode === 'solid' ? config.color : '#1CE8B5',
                        color2: config.mode === 'gradient' ? config.gradient.color2 : '#0B0C11',
                      },
                    },
              )
            }
            className={`mz-chip flex-1 justify-center ${config.mode === m ? 'is-active' : ''}`}
            style={{ fontSize: '11px' }}
          >
            {m === 'solid' ? 'Solid' : 'Gradient'}
          </button>
        ))}
      </div>

      {config.mode === 'solid' ? (
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={config.color}
            onChange={(e) => onChange({ mode: 'solid', color: e.target.value })}
            className="h-8 w-10 rounded cursor-pointer border-0 bg-transparent p-0"
            style={{ minWidth: 40 }}
          />
          <input
            type="text"
            value={config.color}
            onChange={(e) => onChange({ mode: 'solid', color: e.target.value })}
            className="mz-input font-mono"
            style={{ fontSize: 12 }}
            maxLength={9}
          />
        </div>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-1">
            {(['linear', 'radial'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => onChange({ mode: 'gradient', gradient: { ...config.gradient, type: t } })}
                className={`mz-chip justify-center ${config.gradient.type === t ? 'is-active' : ''}`}
                style={{ fontSize: '11px' }}
              >
                {t === 'linear' ? 'Linear' : 'Radial'}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <div className="mz-label mb-1">Color 1</div>
              <div className="flex items-center gap-1.5">
                <input
                  type="color"
                  value={config.gradient.color1}
                  onChange={(e) => onChange({ mode: 'gradient', gradient: { ...config.gradient, color1: e.target.value } })}
                  className="h-7 w-8 rounded cursor-pointer border-0 bg-transparent p-0"
                />
                <input
                  type="text"
                  value={config.gradient.color1}
                  onChange={(e) => onChange({ mode: 'gradient', gradient: { ...config.gradient, color1: e.target.value } })}
                  className="mz-input font-mono"
                  style={{ fontSize: 11 }}
                  maxLength={9}
                />
              </div>
            </div>
            <div className="flex-1">
              <div className="mz-label mb-1">Color 2</div>
              <div className="flex items-center gap-1.5">
                <input
                  type="color"
                  value={config.gradient.color2}
                  onChange={(e) => onChange({ mode: 'gradient', gradient: { ...config.gradient, color2: e.target.value } })}
                  className="h-7 w-8 rounded cursor-pointer border-0 bg-transparent p-0"
                />
                <input
                  type="text"
                  value={config.gradient.color2}
                  onChange={(e) => onChange({ mode: 'gradient', gradient: { ...config.gradient, color2: e.target.value } })}
                  className="mz-input font-mono"
                  style={{ fontSize: 11 }}
                  maxLength={9}
                />
              </div>
            </div>
          </div>
          {config.gradient.type === 'linear' && (
            <div>
              <div className="flex justify-between mb-1">
                <span className="mz-label">Rotation</span>
                <span className="mz-mono" style={{ color: 'var(--mz-text-2)', fontSize: 11 }}>{config.gradient.rotation}°</span>
              </div>
              <input
                type="range"
                min={0}
                max={360}
                step={5}
                value={config.gradient.rotation}
                onChange={(e) => onChange({ mode: 'gradient', gradient: { ...config.gradient, rotation: Number(e.target.value) } })}
                className="mz-slider w-full"
              />
            </div>
          )}
          {/* Gradient preview */}
          <div
            className="h-5 w-full rounded"
            style={{
              background: config.gradient.type === 'linear'
                ? `linear-gradient(${config.gradient.rotation}deg, ${config.gradient.color1}, ${config.gradient.color2})`
                : `radial-gradient(circle, ${config.gradient.color1}, ${config.gradient.color2})`,
              border: '1px solid var(--mz-border)',
            }}
          />
        </div>
      )}
    </div>
  )
}

// ─── Toggle ───────────────────────────────────────────────────────────────────

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      className={`mz-toggle ${on ? 'is-on' : ''}`}
    >
      <span className="mz-toggle-knob" />
    </button>
  )
}

// ─── Dot shape preview ────────────────────────────────────────────────────────

const DOT_TYPES: { label: string; value: DotType }[] = [
  { label: 'Square', value: 'square' },
  { label: 'Dots', value: 'dots' },
  { label: 'Rounded', value: 'rounded' },
  { label: 'Extra', value: 'extra-rounded' },
  { label: 'Classy', value: 'classy' },
  { label: 'Classy+', value: 'classy-rounded' },
]

const CORNER_SQ_TYPES: { label: string; value: CornerSquareType | '' }[] = [
  { label: 'Inherit', value: '' },
  { label: 'Square', value: 'square' },
  { label: 'Dot', value: 'dot' },
  { label: 'Rounded', value: 'extra-rounded' },
]

const CORNER_DOT_TYPES: { label: string; value: CornerDotType | '' }[] = [
  { label: 'Inherit', value: '' },
  { label: 'Square', value: 'square' },
  { label: 'Dot', value: 'dot' },
]

const ERROR_LEVELS: { label: string; value: ErrorCorrectionLevel; desc: string }[] = [
  { label: 'L', value: 'L', desc: '7%' },
  { label: 'M', value: 'M', desc: '15%' },
  { label: 'Q', value: 'Q', desc: '25%' },
  { label: 'H', value: 'H', desc: '30%' },
]

const EXPORT_FORMATS: { label: string; value: 'png' | 'svg' | 'jpeg' | 'webp' }[] = [
  { label: 'PNG', value: 'png' },
  { label: 'SVG', value: 'svg' },
  { label: 'WebP', value: 'webp' },
  { label: 'JPEG', value: 'jpeg' },
]

const CONTENT_TEMPLATES: { label: string; hint: string; value: string }[] = [
  { label: 'Website', hint: 'Open a URL', value: 'https://example.com' },
  { label: 'Email', hint: 'Compose mail', value: 'mailto:hello@example.com' },
  { label: 'Phone', hint: 'Call number', value: 'tel:+1234567890' },
  { label: 'Wi-Fi', hint: 'Connect network', value: 'WIFI:T:WPA;S:MyWiFi;P:password123;;' },
  { label: 'Text', hint: 'Plain message', value: 'Hello from Media Playground 👋' },
]

const STYLE_PRESETS: {
  id: 'classic' | 'modern' | 'mono' | 'vivid'
  label: string
  desc: string
}[] = [
  { id: 'classic', label: 'Classic', desc: 'Simple square code' },
  { id: 'modern', label: 'Modern', desc: 'Rounded gradient style' },
  { id: 'mono', label: 'Mono', desc: 'High contrast print' },
  { id: 'vivid', label: 'Vivid', desc: 'Colorful display look' },
]

function getRecommendedErrorLevel(data: string, hasLogo: boolean): ErrorCorrectionLevel {
  if (hasLogo) return 'H'
  const len = data.trim().length
  if (len > 240) return 'Q'
  if (len > 100) return 'M'
  return 'L'
}

// ─── Main component ───────────────────────────────────────────────────────────

function QRStudio() {
  const [s, setS] = useState<QRSettings>(DEFAULT)
  const [downloading, setDownloading] = useState(false)
  const [templateCopied, setTemplateCopied] = useState(false)

  // ── Presets & History ────────────────────────────────────────────────────
  const qrPresets = useQRPresets()
  const history = useHistory()
  const qrHistory = history.filter((h) => h.kind === 'qr').slice(0, 6)

  useEffect(() => {
    function onLoadPreset(e: Event) {
      const preset = (e as CustomEvent<QRPreset>).detail
      setS((prev) => ({ ...prev, ...preset.settings }))
    }
    window.addEventListener(LOAD_QR_PRESET_EVENT, onLoadPreset)
    return () => window.removeEventListener(LOAD_QR_PRESET_EVENT, onLoadPreset)
  }, [])
  const previewRef = useRef<HTMLDivElement>(null)
  const qrRef = useRef<InstanceType<typeof QRCodeStyling> | null>(null)
  const logoInputRef = useRef<HTMLInputElement>(null)

  const up = useCallback(<K extends keyof QRSettings>(patch: Pick<QRSettings, K>) => {
    setS((prev) => ({ ...prev, ...patch }))
  }, [])

  const dataLength = s.data.trim().length
  const recommendedErrorLevel = useMemo(
    () => getRecommendedErrorLevel(s.data, Boolean(s.logoDataUrl)),
    [s.data, s.logoDataUrl],
  )

  function applyStylePreset(id: 'classic' | 'modern' | 'mono' | 'vivid') {
    setS((prev) => {
      if (id === 'classic') {
        return {
          ...prev,
          shape: 'square',
          dotType: 'square',
          dotColor: { mode: 'solid', color: '#1CE8B5' },
          bgTransparent: false,
          bgColor: '#0B0C11',
          csType: '',
          cdType: '',
          csColorInherit: true,
          cdColorInherit: true,
        }
      }
      if (id === 'modern') {
        return {
          ...prev,
          shape: 'square',
          dotType: 'rounded',
          dotColor: {
            mode: 'gradient',
            gradient: { type: 'linear', rotation: 45, color1: '#5EF2D1', color2: '#1D8FFF' },
          },
          bgTransparent: false,
          bgColor: '#0B0C11',
          csType: 'extra-rounded',
          cdType: 'dot',
          csColorInherit: true,
          cdColorInherit: true,
        }
      }
      if (id === 'mono') {
        return {
          ...prev,
          shape: 'square',
          dotType: 'square',
          dotColor: { mode: 'solid', color: '#000000' },
          bgTransparent: false,
          bgColor: '#FFFFFF',
          csType: 'square',
          cdType: 'square',
          csColorInherit: true,
          cdColorInherit: true,
        }
      }
      return {
        ...prev,
        shape: 'circle',
        dotType: 'extra-rounded',
        dotColor: {
          mode: 'gradient',
          gradient: { type: 'radial', rotation: 0, color1: '#FF58A5', color2: '#7A5CFF' },
        },
        bgTransparent: false,
        bgColor: '#0E1020',
        csType: 'dot',
        cdType: 'dot',
        csColorInherit: true,
        cdColorInherit: true,
      }
    })
  }

  async function handleCopyTemplate() {
    if (!s.data.trim()) return
    try {
      await navigator.clipboard.writeText(s.data)
      setTemplateCopied(true)
      window.setTimeout(() => setTemplateCopied(false), 1000)
    } catch {
      setTemplateCopied(false)
    }
  }

  // Build preview options (always 320px canvas)
  const previewOpts = useMemo(() => buildOptions(s, 320), [s])

  // Recreate preview instance on settings change.
  // Some nested style transitions (gradient -> solid) are not reliably reset by update().
  useEffect(() => {
    if (!previewRef.current) return
    previewRef.current.innerHTML = ''
    const instance = new QRCodeStyling(previewOpts)
    qrRef.current = instance
    instance.append(previewRef.current)
  }, [previewOpts])

  // ── Logo upload ─────────────────────────────────────────────────────────
  function handleLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      up({ logoDataUrl: ev.target?.result as string })
    }
    reader.readAsDataURL(f)
    e.target.value = ''
  }

  // ── Export ───────────────────────────────────────────────────────────────
  async function handleExport() {
    setDownloading(true)
    try {
      const exportOpts = buildOptions(s, s.exportSize)

      if (s.exportFormat === 'svg') {
        // Create SVG instance for export
        const svgInst = new QRCodeStyling({ ...exportOpts, type: 'svg' })
        await svgInst.download({ name: 'qr-code', extension: 'svg' })
      } else if (s.exportFormat === 'png') {
        const inst = new QRCodeStyling(exportOpts)
        await inst.download({ name: 'qr-code', extension: 'png' })
      } else {
        // For webp/jpeg: get raw canvas data and convert
        const inst = new QRCodeStyling(exportOpts)
        const rawData = await inst.getRawData('png')
        if (!(rawData instanceof Blob)) return

        // Load into a canvas for conversion
        const url = URL.createObjectURL(rawData)
        await new Promise<void>((resolve) => {
          const img = new Image()
          img.onload = () => {
            const canvas = document.createElement('canvas')
            canvas.width = s.exportSize
            canvas.height = s.exportSize
            const ctx = canvas.getContext('2d')
            if (!ctx) {
              URL.revokeObjectURL(url)
              resolve()
              return
            }
            if (!s.bgTransparent && s.exportFormat === 'jpeg') {
              ctx.fillStyle = s.bgColor
              ctx.fillRect(0, 0, s.exportSize, s.exportSize)
            }
            ctx.drawImage(img, 0, 0)
            canvas.toBlob(
              (b) => {
                if (b) {
                  const a = document.createElement('a')
                  a.href = URL.createObjectURL(b)
                  a.download = `qr-code.${s.exportFormat}`
                  a.click()
                }
                resolve()
              },
              `image/${s.exportFormat}`,
              0.95,
            )
            URL.revokeObjectURL(url)
          }
          img.src = url
        })
      }
    } finally {
      setDownloading(false)
      if (s.data.trim()) {
        addHistory({
          kind: 'qr',
          label: s.data.trim().slice(0, 40) + (s.data.trim().length > 40 ? '…' : ''),
          detail: `${s.exportFormat.toUpperCase()} · ${s.exportSize}px · ${s.dotType}`,
        })
      }
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="mz-app flex flex-col min-h-screen">
      {/* ── Top bar ── */}
      <div className="mz-topbar">
        <a
          href="/"
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
        <span className="text-xs font-semibold" style={{ color: 'var(--mz-text)' }}>QR Studio</span>
        <div className="flex-1" />
        <CmdKTrigger />
        <span className="mz-badge mz-badge-accent">Fully local · no tracking</span>
      </div>

      {/* ── Body ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Preview column ── */}
        <div className="flex min-w-0 flex-1 flex-col overflow-y-auto p-4 gap-3">
          <div className="mz-well overflow-hidden">
            <div
              className="flex items-center justify-center rounded-sm p-4"
              style={{
                minHeight: '58vh',
                background: s.bgTransparent
                  ? 'repeating-conic-gradient(rgba(255,255,255,0.05) 0% 25%, transparent 0% 50%) 0 0 / 16px 16px'
                  : 'var(--mz-surface)',
              }}
            >
              <div ref={previewRef} style={{ lineHeight: 0 }} />
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="mz-badge">{s.errorLevel} error correction</span>
              <span className="mz-badge">{s.dotType} dots</span>
              <span className="mz-mono" style={{ color: 'var(--mz-text-2)', fontSize: '11px' }}>
                {s.exportFormat.toUpperCase()}
                {s.exportFormat !== 'svg' ? ` · ${s.exportSize}×${s.exportSize}` : ''}
              </span>
              {s.shape === 'circle' && <span className="mz-badge">circular</span>}
              {s.logoDataUrl && <span className="mz-badge mz-badge-accent">logo attached</span>}
            </div>
          </div>
        </div>

        {/* ── Settings sidebar ── */}
        <div className="flex w-72 shrink-0 flex-col overflow-y-auto border-l px-4 pt-4 pb-3 xl:w-80"
          style={{ borderColor: 'var(--mz-border)', background: 'var(--mz-surface)' }}>
          {/* ── CONTENT ── */}
          <Section title="Content">
            <textarea
              value={s.data}
              onChange={(e) => up({ data: e.target.value })}
              className="mz-input"
              rows={3}
              placeholder="URL, text, vCard, Wi-Fi…"
              style={{ resize: 'vertical', fontFamily: 'inherit', fontSize: 12 }}
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-xs" style={{ color: 'var(--mz-text-2)' }}>
                {dataLength} chars
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => up({ data: s.data.trim() })}
                  className="mz-chip"
                  style={{ fontSize: '10px' }}
                >
                  Trim
                </button>
                <button
                  type="button"
                  onClick={handleCopyTemplate}
                  disabled={!s.data.trim()}
                  className="mz-chip"
                  style={{ fontSize: '10px', opacity: !s.data.trim() ? 0.5 : 1 }}
                >
                  {templateCopied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-1">
              {CONTENT_TEMPLATES.map((t) => (
                <button
                  key={t.label}
                  type="button"
                  onClick={() => up({ data: t.value })}
                  className="mz-chip flex-col items-start gap-0.5"
                  style={{ fontSize: '10px', paddingTop: 6, paddingBottom: 6 }}
                >
                  <span>{t.label}</span>
                  <span style={{ opacity: 0.55, fontSize: 9 }}>{t.hint}</span>
                </button>
              ))}
            </div>
          </Section>

          {/* ── ERROR CORRECTION ── */}
          <Section title="Error Correction" badge={s.errorLevel}>
            <div className="grid grid-cols-4 gap-1">
              {ERROR_LEVELS.map((l) => (
                <button
                  key={l.value}
                  type="button"
                  onClick={() => up({ errorLevel: l.value })}
                  className={`mz-chip flex-col gap-0.5 py-2 ${s.errorLevel === l.value ? 'is-active' : ''}`}
                  style={{ fontSize: '11px' }}
                >
                  <span className="font-semibold">{l.label}</span>
                  <span className="opacity-40 text-[9px]">{l.desc}</span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs" style={{ color: 'var(--mz-text-2)' }}>
              Higher = more data redundancy. Use H when adding a logo.
            </p>
            {recommendedErrorLevel !== s.errorLevel && (
              <div
                className="mt-2 flex items-center justify-between gap-2 rounded-md px-2 py-2"
                style={{ border: '1px solid var(--mz-accent-border)', background: 'var(--mz-accent-dim)' }}
              >
                <span className="text-xs" style={{ color: 'var(--mz-accent)' }}>
                  Suggested: {recommendedErrorLevel}
                </span>
                <button
                  type="button"
                  onClick={() => up({ errorLevel: recommendedErrorLevel })}
                  className="mz-chip is-active"
                  style={{ fontSize: '10px' }}
                >
                  Apply
                </button>
              </div>
            )}
          </Section>

          <Section title="Style Presets">
            <div className="grid grid-cols-2 gap-1">
              {STYLE_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => applyStylePreset(p.id)}
                  className="mz-chip flex-col items-start gap-0.5"
                  style={{ fontSize: '10px', paddingTop: 6, paddingBottom: 6 }}
                >
                  <span>{p.label}</span>
                  <span style={{ opacity: 0.55, fontSize: 9 }}>{p.desc}</span>
                </button>
              ))}
            </div>
          </Section>

          {/* ── SHAPE & MARGIN ── */}
          <Section title="Shape & Spacing">
            <div className="grid grid-cols-2 gap-1 mb-3">
              {(['square', 'circle'] as const).map((sh) => (
                <button
                  key={sh}
                  type="button"
                  onClick={() => up({ shape: sh })}
                  className={`mz-chip flex items-center gap-2 justify-center ${s.shape === sh ? 'is-active' : ''}`}
                  style={{ fontSize: '11px' }}
                >
                  {sh === 'square' ? (
                    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <rect x="1" y="1" width="10" height="10" />
                    </svg>
                  ) : (
                    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <circle cx="6" cy="6" r="5" />
                    </svg>
                  )}
                  {sh.charAt(0).toUpperCase() + sh.slice(1)}
                </button>
              ))}
            </div>
            <div>
              <div className="flex justify-between mb-1">
                <span className="mz-label">Quiet Zone</span>
                <span className="mz-mono" style={{ color: 'var(--mz-text-2)', fontSize: 11 }}>{s.margin} px</span>
              </div>
              <input
                type="range" min={0} max={64} step={4} value={s.margin}
                onChange={(e) => up({ margin: Number(e.target.value) })}
                className="mz-slider w-full"
              />
            </div>
          </Section>

          {/* ── DOTS ── */}
          <Section title="Dot Style">
            <ChipGroup options={DOT_TYPES} value={s.dotType} onChange={(v) => up({ dotType: v })} cols={3} />
            <div className="mt-3">
              <ColorSection config={s.dotColor} onChange={(c) => up({ dotColor: c })} />
            </div>
          </Section>

          {/* ── BACKGROUND ── */}
          <Section title="Background">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs" style={{ color: 'var(--mz-text-2)' }}>Transparent</span>
              <Toggle on={s.bgTransparent} onToggle={() => up({ bgTransparent: !s.bgTransparent })} />
            </div>
            {!s.bgTransparent && (
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={s.bgColor}
                  onChange={(e) => up({ bgColor: e.target.value })}
                  className="h-8 w-10 rounded cursor-pointer border-0 bg-transparent p-0"
                />
                <input
                  type="text"
                  value={s.bgColor}
                  onChange={(e) => up({ bgColor: e.target.value })}
                  className="mz-input font-mono"
                  style={{ fontSize: 12 }}
                  maxLength={9}
                />
              </div>
            )}
            {s.bgTransparent && (
              <p className="text-xs" style={{ color: 'var(--mz-text-2)' }}>
                Background will be transparent. Use PNG or WebP export.
              </p>
            )}
          </Section>

          {/* ── CORNER SQUARES (Eye frame) ── */}
          <Section title="Eye Frame">
            <ChipGroup
              options={CORNER_SQ_TYPES}
              value={s.csType}
              onChange={(v) => up({ csType: v })}
              cols={4}
            />
            <div className="mt-3 flex items-center justify-between mb-2">
              <span className="text-xs" style={{ color: 'var(--mz-text-2)' }}>Inherit dot color</span>
              <Toggle on={s.csColorInherit} onToggle={() => up({ csColorInherit: !s.csColorInherit })} />
            </div>
            {!s.csColorInherit && (
              <ColorSection config={s.csColor} onChange={(c) => up({ csColor: c })} />
            )}
          </Section>

          {/* ── CORNER DOTS (Eye center) ── */}
          <Section title="Eye Center">
            <ChipGroup
              options={CORNER_DOT_TYPES}
              value={s.cdType}
              onChange={(v) => up({ cdType: v })}
              cols={3}
            />
            <div className="mt-3 flex items-center justify-between mb-2">
              <span className="text-xs" style={{ color: 'var(--mz-text-2)' }}>Inherit dot color</span>
              <Toggle on={s.cdColorInherit} onToggle={() => up({ cdColorInherit: !s.cdColorInherit })} />
            </div>
            {!s.cdColorInherit && (
              <ColorSection config={s.cdColor} onChange={(c) => up({ cdColor: c })} />
            )}
          </Section>

          {/* ── LOGO ── */}
          <Section title="Logo" badge={s.logoDataUrl ? 'attached' : undefined} accent={!!s.logoDataUrl}>
            {s.logoDataUrl ? (
              <div
                className="relative rounded-lg p-3 flex items-center gap-3 mb-3"
                style={{ background: 'var(--mz-surface-2)', border: '1px solid var(--mz-border)' }}
              >
                <img
                  src={s.logoDataUrl}
                  alt="Logo preview"
                  className="rounded"
                  style={{ width: 40, height: 40, objectFit: 'contain', background: 'white' }}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium" style={{ color: 'var(--mz-text)' }}>Logo attached</div>
                  <div className="text-xs" style={{ color: 'var(--mz-text-2)' }}>Click below to replace</div>
                </div>
                <button
                  type="button"
                  onClick={() => up({ logoDataUrl: null })}
                  className="mz-btn"
                  style={{ padding: '4px 8px', fontSize: '10px', color: 'var(--mz-error)' }}
                  title="Remove logo"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            ) : null}

            <button
              type="button"
              onClick={() => logoInputRef.current?.click()}
              className="mz-btn mz-btn-ghost w-full gap-2 mb-3"
              style={{ fontSize: '12px' }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <polyline points="21 15 16 10 5 21" />
              </svg>
              {s.logoDataUrl ? 'Replace Logo' : 'Upload Logo'}
            </button>
            <input
              ref={logoInputRef}
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={handleLogoFile}
            />

            {s.logoDataUrl && (
              <div className="space-y-3">
                <div>
                  <div className="flex justify-between mb-1">
                    <span className="mz-label">Logo Size</span>
                    <span className="mz-mono" style={{ color: 'var(--mz-text-2)', fontSize: 11 }}>
                      {Math.round(s.logoSize * 100)}%
                    </span>
                  </div>
                  <input
                    type="range" min={0.1} max={0.5} step={0.02} value={s.logoSize}
                    onChange={(e) => up({ logoSize: Number(e.target.value) })}
                    className="mz-slider w-full"
                  />
                </div>

                <div>
                  <div className="flex justify-between mb-1">
                    <span className="mz-label">Logo Margin</span>
                    <span className="mz-mono" style={{ color: 'var(--mz-text-2)', fontSize: 11 }}>{s.logoMargin} px</span>
                  </div>
                  <input
                    type="range" min={0} max={24} step={1} value={s.logoMargin}
                    onChange={(e) => up({ logoMargin: Number(e.target.value) })}
                    className="mz-slider w-full"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-xs" style={{ color: 'var(--mz-text-2)' }}>Hide dots behind logo</span>
                  <Toggle on={s.logoHideDots} onToggle={() => up({ logoHideDots: !s.logoHideDots })} />
                </div>

                <p className="text-xs" style={{ color: 'var(--mz-text-2)' }}>
                  Tip: set error correction to H when using a logo for best scan reliability.
                </p>
              </div>
            )}
          </Section>

          <Section title="Export" badge={s.exportFormat.toUpperCase()}>
            <div className="space-y-3">
              <div className="grid grid-cols-4 gap-1">
                {EXPORT_FORMATS.map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => up({ exportFormat: f.value })}
                    className={`mz-chip justify-center ${s.exportFormat === f.value ? 'is-active' : ''}`}
                    style={{ fontSize: '11px' }}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              {s.exportFormat !== 'svg' && (
                <div>
                  <div className="flex justify-between mb-1">
                    <span className="mz-label">Resolution</span>
                    <span className="mz-mono" style={{ color: 'var(--mz-accent)', fontSize: 11 }}>
                      {s.exportSize} × {s.exportSize} px
                    </span>
                  </div>
                  <input
                    type="range"
                    min={256}
                    max={4096}
                    step={128}
                    value={s.exportSize}
                    onChange={(e) => up({ exportSize: Number(e.target.value) })}
                    className="mz-slider w-full"
                  />
                  <div className="flex justify-between mt-1">
                    {[512, 1024, 2048, 4096].map((sz) => (
                      <button
                        key={sz}
                        type="button"
                        onClick={() => up({ exportSize: sz })}
                        className={`mz-chip ${s.exportSize === sz ? 'is-active' : ''}`}
                        style={{ fontSize: '9px', padding: '2px 6px' }}
                      >
                        {sz >= 1024 ? `${sz / 1024}K` : sz}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Section>

          {/* PRESETS */}
          <Section title="Presets">
            <PresetsPanel<QRPreset>
              presets={qrPresets}
              renderSummary={(p) => `${p.settings.dotType} · ${p.settings.exportFormat.toUpperCase()} · ${p.settings.exportSize}px`}
              onLoad={(p) => setS((prev) => ({ ...prev, ...p.settings }))}
              onSave={(name) => saveQRPreset(name, { errorLevel: s.errorLevel, margin: s.margin, shape: s.shape, dotType: s.dotType, dotColor: s.dotColor, bgTransparent: s.bgTransparent, bgColor: s.bgColor, csType: s.csType, csColorInherit: s.csColorInherit, csColor: s.csColor, cdType: s.cdType, cdColorInherit: s.cdColorInherit, cdColor: s.cdColor, logoSize: s.logoSize, logoMargin: s.logoMargin, logoHideDots: s.logoHideDots, exportFormat: s.exportFormat, exportSize: s.exportSize })}
              onRename={(id, name) => renameQRPreset(id, name)}
              onDelete={(id) => deleteQRPreset(id)}
              saveLabel="Save current style"
              canSave
            />
          </Section>

          {/* HISTORY */}
          {qrHistory.length > 0 && (
            <Section title="History">
              <div className="space-y-1">
                {qrHistory.map((h) => (
                  <div key={h.id} className="mz-history-item">
                    <span className="truncate text-xs" style={{ color: 'var(--mz-text)' }}>{h.label}</span>
                    <span className="mz-label shrink-0">{h.detail}</span>
                  </div>
                ))}
              </div>
            </Section>
          )}

          <div className="flex-1" />

          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              disabled={downloading || !s.data.trim()}
              onClick={handleExport}
              className="mz-btn mz-btn-primary w-full gap-2"
            >
              {downloading ? (
                <>
                  <svg aria-hidden="true" className="animate-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" strokeOpacity="0.3" />
                    <path d="M12 2a10 10 0 0 1 10 10" />
                  </svg>
                  Exporting…
                </>
              ) : (
                <>
                  <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  Download .{s.exportFormat.toUpperCase()}
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => setS(DEFAULT)}
              className="text-center transition-colors"
              style={{ fontSize: '11px', color: 'var(--mz-text-2)' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--mz-text)' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--mz-text-2)' }}
            >
              Reset to defaults
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
