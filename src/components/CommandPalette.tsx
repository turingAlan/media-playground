/**
 * Global Cmd+K command palette.
 * Mount once at the root — reads route context via useRouterState.
 */
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  clearHistory,
  emitLoadImagePreset,
  emitLoadQRPreset,
  emitLoadVideoPreset,
  type HistoryEntry,
  useHistory,
  useImagePresets,
  useQRPresets,
  useVideoPresets,
} from '#/lib/store'

// ─── Types ────────────────────────────────────────────────────────────────────

type CommandGroup = {
  title: string
  commands: Command[]
}

type Command = {
  id: string
  icon?: React.ReactNode
  label: string
  detail?: string
  accent?: 'green' | 'amber' | 'red'
  onSelect: () => void
}

// ─── Small icon helpers ───────────────────────────────────────────────────────

function NavIcon({ d }: { d: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  )
}

function ClockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  )
}

function PresetIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v14a2 2 0 0 1-2 2z"/>
      <polyline points="17 21 17 13 7 13 7 21"/>
      <polyline points="7 3 7 8 15 8"/>
    </svg>
  )
}

function kindBadge(kind: HistoryEntry['kind']) {
  if (kind === 'image') return { label: 'IMG', color: 'var(--mz-accent)' }
  if (kind === 'video') return { label: 'VID', color: 'var(--mz-amber)' }
  return { label: 'QR', color: 'var(--mz-text-2)' }
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

// ─── CommandPalette ───────────────────────────────────────────────────────────

export default function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const routerState = useRouterState()

  const currentPath = routerState.location.pathname

  // live data
  const history       = useHistory()
  const imagePresets  = useImagePresets()
  const videoPresets  = useVideoPresets()
  const qrPresets     = useQRPresets()

  const isImageRoute = currentPath === '/image'
  const isVideoRoute = currentPath === '/video'
  const isQRRoute    = currentPath === '/qr'

  // ── Open / close ──────────────────────────────────────────────────────────
  const handleOpen = useCallback(() => {
    setOpen(true)
    setQuery('')
    setActiveIdx(0)
    setTimeout(() => inputRef.current?.focus(), 0)
  }, [])

  const handleClose = useCallback(() => {
    setOpen(false)
    setQuery('')
  }, [])

  // Cmd+K / Ctrl+K global listener
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        if (open) handleClose()
        else handleOpen()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, handleOpen, handleClose])

  // ── Build commands ────────────────────────────────────────────────────────
  const groups = useMemo<CommandGroup[]>(() => {
    const groups: CommandGroup[] = []

    // ── Navigate
    groups.push({
      title: 'Navigate',
      commands: [
        {
          id: 'nav-hub',
          icon: <NavIcon d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
          label: 'Media Hub',
          detail: 'All tools',
          onSelect: () => { navigate({ to: '/' }); handleClose() },
        },
        {
          id: 'nav-image',
          icon: <NavIcon d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5z M8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z M21 15l-5-5L5 21" />,
          label: 'Image Studio',
          detail: 'Convert · Crop · Compress',
          accent: 'green',
          onSelect: () => { navigate({ to: '/image' }); handleClose() },
        },
        {
          id: 'nav-video',
          icon: <NavIcon d="M15 10l4.553-2.276A1 1 0 0 1 21 8.723v6.554a1 1 0 0 1-1.447.894L15 14M2 8h13v8H2z" />,
          label: 'Video Studio',
          detail: 'Convert · Compress · Trim',
          accent: 'amber',
          onSelect: () => { navigate({ to: '/video' }); handleClose() },
        },
        {
          id: 'nav-qr',
          icon: <NavIcon d="M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M5 5h3v3H5z M16 5h3v3h-3z M5 16h3v3H5z M14 14h3v3h-3z M17 17h3v3h-3z M14 17h3v3h-3z M17 14h3v3h-3z" />,
          label: 'QR Studio',
          detail: 'Styled QR codes',
          onSelect: () => { navigate({ to: '/qr' }); handleClose() },
        },
      ],
    })

    // ── Current-route presets (shown prominently when on that route)
    if (isImageRoute && imagePresets.length > 0) {
      groups.push({
        title: 'Image Presets',
        commands: imagePresets.map((p) => ({
          id: `img-preset-${p.id}`,
          icon: <PresetIcon />,
          label: p.name,
          detail: `${p.format.replace('image/', '').toUpperCase()} · Q${Math.round(p.quality * 100)}`,
          accent: 'green' as const,
          onSelect: () => { emitLoadImagePreset(p); handleClose() },
        })),
      })
    }

    if (isVideoRoute && videoPresets.length > 0) {
      groups.push({
        title: 'Video Presets',
        commands: videoPresets.map((p) => ({
          id: `vid-preset-${p.id}`,
          icon: <PresetIcon />,
          label: p.name,
          detail: `${p.formats.map((f) => f.toUpperCase()).join('+')} · CRF${p.crf} · ${p.encodingPreset}`,
          accent: 'amber' as const,
          onSelect: () => { emitLoadVideoPreset(p); handleClose() },
        })),
      })
    }

    if (isQRRoute && qrPresets.length > 0) {
      groups.push({
        title: 'QR Presets',
        commands: qrPresets.map((p) => ({
          id: `qr-preset-${p.id}`,
          icon: <PresetIcon />,
          label: p.name,
          detail: `${String(p.settings.dotType)} · ${p.settings.exportFormat.toUpperCase()} · ${p.settings.exportSize}px`,
          onSelect: () => { emitLoadQRPreset(p); handleClose() },
        })),
      })
    }

    // ── All presets cross-route (when not on that route)
    const crossImagePresets: Command[] = !isImageRoute ? imagePresets.map((p) => ({
      id: `cross-img-${p.id}`,
      icon: <PresetIcon />,
      label: p.name,
      detail: `Image · ${p.format.replace('image/', '').toUpperCase()} · Q${Math.round(p.quality * 100)}`,
      accent: 'green' as const,
      onSelect: () => {
        navigate({ to: '/image' })
        // emit after navigation settles
        setTimeout(() => emitLoadImagePreset(p), 400)
        handleClose()
      },
    })) : []

    const crossVideoPresets: Command[] = !isVideoRoute ? videoPresets.map((p) => ({
      id: `cross-vid-${p.id}`,
      icon: <PresetIcon />,
      label: p.name,
      detail: `Video · CRF${p.crf} · ${p.encodingPreset}`,
      accent: 'amber' as const,
      onSelect: () => {
        navigate({ to: '/video' })
        setTimeout(() => emitLoadVideoPreset(p), 400)
        handleClose()
      },
    })) : []

    const crossQRPresets: Command[] = !isQRRoute ? qrPresets.map((p) => ({
      id: `cross-qr-${p.id}`,
      icon: <PresetIcon />,
      label: p.name,
      detail: `QR · ${p.settings.dotType} · ${p.settings.exportFormat.toUpperCase()}`,
      onSelect: () => {
        navigate({ to: '/qr' })
        setTimeout(() => emitLoadQRPreset(p), 400)
        handleClose()
      },
    })) : []

    const crossPresets = [...crossImagePresets, ...crossVideoPresets, ...crossQRPresets]
    if (crossPresets.length > 0) {
      groups.push({ title: 'All Presets', commands: crossPresets })
    }

    // ── Recent history (last 8)
    const recent = history.slice(0, 8)
    if (recent.length > 0) {
      groups.push({
        title: 'Recent Activity',
        commands: recent.map((h) => {
          const badge = kindBadge(h.kind)
          const routeMap = { image: '/image', video: '/video', qr: '/qr' } as const
          return {
            id: `hist-${h.id}`,
            icon: <ClockIcon />,
            label: h.label,
            detail: `${h.detail} · ${relativeTime(h.timestamp)}`,
            accent: h.kind === 'image' ? 'green' : h.kind === 'video' ? 'amber' : undefined,
            _badge: badge,
            onSelect: () => { navigate({ to: routeMap[h.kind] }); handleClose() },
          }
        }),
      })
    }

    // ── Actions
    const actionCmds: Command[] = [
      {
        id: 'action-clear-history',
        icon: <NavIcon d="M3 6h18M8 6V4h8v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />,
        label: 'Clear history',
        detail: `${history.length} entries`,
        accent: 'red',
        onSelect: () => { clearHistory(); handleClose() },
      },
    ]
    groups.push({ title: 'Actions', commands: actionCmds })

    return groups
  }, [
    isImageRoute, isVideoRoute, isQRRoute,
    imagePresets, videoPresets, qrPresets,
    history, navigate, handleClose,
  ])

  // ── Filter by query ───────────────────────────────────────────────────────
  const filtered = useMemo<CommandGroup[]>(() => {
    if (!query.trim()) return groups
    const q = query.toLowerCase()
    return groups
      .map((g) => ({
        ...g,
        commands: g.commands.filter(
          (c) =>
            c.label.toLowerCase().includes(q) ||
            c.detail?.toLowerCase().includes(q) ||
            g.title.toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.commands.length > 0)
  }, [groups, query])

  // Flat list for keyboard nav
  const flatCommands = useMemo(() => filtered.flatMap((g) => g.commands), [filtered])
  const clampedIdx = Math.min(activeIdx, flatCommands.length - 1)

  // ── Keyboard nav inside palette ───────────────────────────────────────────
  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { handleClose(); return }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => Math.min(i + 1, flatCommands.length - 1))
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(i - 1, 0))
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      flatCommands[clampedIdx]?.onSelect()
    }
  }

  // Scroll active item into view
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLButtonElement>('[data-active="true"]')
    el?.scrollIntoView({ block: 'nearest' })
  }, [])

  if (!open) return null

  let globalIdx = 0

  return (
    /* Backdrop */
    <div
      className="mz-palette-backdrop"
      onClick={handleClose}
    >
      {/* Panel */}
      <div
        className="mz-palette-panel"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        {/* Search */}
        <div className="mz-palette-search-row">
          <svg
            aria-hidden="true"
            width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
            style={{ color: 'var(--mz-text-2)', flexShrink: 0 }}
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref={inputRef}
            className="mz-palette-input"
            placeholder="Search commands…"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActiveIdx(0) }}
          />
          <kbd className="mz-kbd">esc</kbd>
        </div>

        {/* Command list */}
        <div ref={listRef} className="mz-palette-list">
          {filtered.length === 0 && (
            <div className="mz-palette-empty">No commands match "{query}"</div>
          )}
          {filtered.map((group) => (
            <div key={group.title}>
              <div className="mz-palette-group-title">{group.title}</div>
              {group.commands.map((cmd) => {
                const idx = globalIdx++
                const isActive = idx === clampedIdx
                const accentColor =
                  cmd.accent === 'green'
                    ? 'var(--mz-accent)'
                    : cmd.accent === 'amber'
                      ? 'var(--mz-amber)'
                      : cmd.accent === 'red'
                        ? 'var(--mz-error)'
                        : 'var(--mz-text-2)'
                return (
                  <button
                    key={cmd.id}
                    type="button"
                    data-active={isActive}
                    className={`mz-palette-cmd ${isActive ? 'is-active' : ''}`}
                    onClick={cmd.onSelect}
                    onMouseEnter={() => setActiveIdx(idx)}
                  >
                    <span className="mz-palette-cmd-icon" style={{ color: accentColor }}>
                      {cmd.icon}
                    </span>
                    <span className="mz-palette-cmd-label">{cmd.label}</span>
                    {cmd.detail && (
                      <span className="mz-palette-cmd-detail">{cmd.detail}</span>
                    )}
                    {isActive && (
                      <kbd className="mz-kbd ml-auto" style={{ flexShrink: 0 }}>↵</kbd>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        {/* Footer hint */}
        <div className="mz-palette-footer">
          <span><kbd className="mz-kbd">↑↓</kbd> navigate</span>
          <span><kbd className="mz-kbd">↵</kbd> select</span>
          <span><kbd className="mz-kbd">esc</kbd> close</span>
          <span style={{ marginLeft: 'auto' }}>
            <kbd className="mz-kbd">⌘K</kbd> toggle
          </span>
        </div>
      </div>
    </div>
  )
}

// ─── Trigger button (small topbar button) ────────────────────────────────────

export function CmdKTrigger() {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }))}
      className="mz-btn mz-btn-ghost"
      style={{ padding: '4px 10px', fontSize: 11, gap: 5 }}
      title="Command palette (⌘K)"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <span>⌘K</span>
    </button>
  )
}
