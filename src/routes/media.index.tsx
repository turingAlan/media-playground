import { createFileRoute, Link } from '@tanstack/react-router'

export const Route = createFileRoute('/media/')({ component: MediaHub })

const tools = [
  {
    to: '/media/image' as const,
    label: 'Image Studio',
    description: 'Convert, compress, crop, rotate, resize. Multi-format output with estimated size reduction.',
    tag: 'Canvas · Web Worker',
    tagClass: 'mz-badge-accent',
    cardClass: '',
    formats: ['JPEG', 'PNG', 'WebP', 'AVIF'],
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" stroke="currentColor">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <polyline points="21 15 16 10 5 21" />
      </svg>
    ),
  },
  {
    to: '/media/video' as const,
    label: 'Video Studio',
    description: 'Format conversion, CRF compression, audio removal, bitrate control, aspect ratio & resolution scaling.',
    tag: 'FFmpeg · WASM',
    tagClass: 'mz-badge-amber',
    cardClass: 'mz-amber-card',
    formats: ['MP4', 'WebM', 'MOV', 'MKV', 'GIF'],
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" stroke="currentColor">
        <path d="M15 10l4.553-2.276A1 1 0 0 1 21 8.723v6.554a1 1 0 0 1-1.447.894L15 14" />
        <rect x="2" y="6" width="13" height="12" rx="2" />
      </svg>
    ),
  },
]

function MediaHub() {
  return (
    <div className="mz-app flex flex-col min-h-screen">
      {/* Top bar */}
      <div className="mz-topbar">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-50" style={{ background: 'var(--mz-accent)' }} />
          <span className="relative inline-flex h-2 w-2 rounded-full" style={{ background: 'var(--mz-accent)' }} />
        </span>
        <span className="text-xs font-medium" style={{ color: 'var(--mz-text)' }}>Media Playground</span>
        <div className="flex-1" />
        <span className="mz-badge">No uploads · 100% local</span>
      </div>

      {/* Hero */}
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-16">
        <div className="mb-10 text-center">
          <p className="mz-label mb-4">WASM + Web Workers · Zero server</p>
          <h1
            className="text-[48px] font-light tracking-[-0.04em] leading-none"
            style={{ color: 'var(--mz-text)' }}
          >
            Media Studio
          </h1>
          <p className="mt-3 text-sm" style={{ color: 'var(--mz-text-2)' }}>
            Your files never leave the browser tab.
          </p>
        </div>

        <div className="grid w-full max-w-xl gap-2 sm:grid-cols-2">
          {tools.map((tool) => (
            <Link
              key={tool.to}
              to={tool.to}
              className={`mz-tool-card group ${tool.cardClass}`}
            >
              <div className="mz-tool-card-accent-line" />

              <div
                className="mb-4 inline-flex h-8 w-8 items-center justify-center rounded-md"
                style={{ background: 'var(--mz-surface-2)', border: '1px solid var(--mz-border-2)', color: 'var(--mz-text-2)' }}
              >
                {tool.icon}
              </div>

              <div className="mb-2 flex items-center gap-2">
                <span className="text-sm font-semibold" style={{ color: 'var(--mz-text)' }}>{tool.label}</span>
                <span className={`mz-badge ${tool.tagClass}`}>{tool.tag}</span>
              </div>

              <p className="mb-5 text-xs leading-relaxed" style={{ color: 'var(--mz-text-2)' }}>
                {tool.description}
              </p>

              <div className="mt-auto flex flex-wrap gap-1">
                {tool.formats.map((f) => (
                  <span key={f} className="mz-badge">{f}</span>
                ))}
              </div>

              <div
                className="absolute bottom-5 right-5 transition-transform duration-150 group-hover:translate-x-0.5"
                style={{ color: 'var(--mz-text-2)' }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="5" y1="12" x2="19" y2="12" />
                  <polyline points="12 5 19 12 12 19" />
                </svg>
              </div>
            </Link>
          ))}
        </div>
      </div>

      <div className="border-t px-6 py-3 text-center" style={{ borderColor: 'var(--mz-border)' }}>
        <p className="mz-label">Open source · zero telemetry · runs in your browser</p>
      </div>
    </div>
  )
}
