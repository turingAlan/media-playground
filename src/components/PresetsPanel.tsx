/**
 * Generic presets panel — save, load, rename, delete.
 * Drop this anywhere in the sidebar and pass typed callbacks.
 */
import { useRef, useState } from 'react'

type Preset = { id: string; name: string }

type PresetsPanelProps<T extends Preset> = {
  presets: T[]
  /** Short summary line shown under the preset name */
  renderSummary: (p: T) => string
  onLoad: (p: T) => void
  onDelete: (id: string) => void
  onRename: (id: string, name: string) => void
  onSave: (name: string) => void
  /** Label on the "Save current" button */
  saveLabel?: string
  /** Whether currently there are settings worth saving */
  canSave?: boolean
}

export default function PresetsPanel<T extends Preset>({
  presets,
  renderSummary,
  onLoad,
  onDelete,
  onRename,
  onSave,
  saveLabel = 'Save current settings',
  canSave = true,
}: PresetsPanelProps<T>) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [saveNameMode, setSaveNameMode] = useState(false)
  const [newPresetName, setNewPresetName] = useState('')
  const editInputRef = useRef<HTMLInputElement>(null)
  const saveInputRef = useRef<HTMLInputElement>(null)

  function startEdit(p: T) {
    setEditingId(p.id)
    setEditingName(p.name)
    setTimeout(() => editInputRef.current?.select(), 0)
  }

  function confirmEdit(id: string) {
    const trimmed = editingName.trim()
    if (trimmed) onRename(id, trimmed)
    setEditingId(null)
  }

  function startSave() {
    setSaveNameMode(true)
    setNewPresetName(`Preset ${presets.length + 1}`)
    setTimeout(() => {
      saveInputRef.current?.focus()
      saveInputRef.current?.select()
    }, 0)
  }

  function confirmSave() {
    const name = newPresetName.trim()
    if (name) onSave(name)
    setSaveNameMode(false)
    setNewPresetName('')
  }

  return (
    <div>
      {/* Preset list */}
      {presets.length > 0 && (
        <div className="flex flex-col gap-1 mb-2">
          {presets.map((p) => (
            <div
              key={p.id}
              className="mz-preset-item group"
            >
              {editingId === p.id ? (
                /* Rename inline */
                <input
                  ref={editInputRef}
                  className="mz-input"
                  style={{ fontSize: 12, padding: '4px 8px', flex: 1 }}
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') confirmEdit(p.id)
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                  onBlur={() => confirmEdit(p.id)}
                  autoFocus
                />
              ) : (
                <>
                  {/* Load on click */}
                  <button
                    type="button"
                    className="flex-1 min-w-0 text-left"
                    onClick={() => onLoad(p)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                  >
                    <p
                      className="font-medium truncate"
                      style={{ fontSize: 12, color: 'var(--mz-text)', lineHeight: 1.4 }}
                    >
                      {p.name}
                    </p>
                    <p
                      className="mz-mono truncate"
                      style={{ fontSize: 9, color: 'var(--mz-text-2)', marginTop: 2 }}
                    >
                      {renderSummary(p)}
                    </p>
                  </button>

                  {/* Action buttons – visible on hover */}
                  <div className="mz-preset-actions">
                    {/* Rename */}
                    <button
                      type="button"
                      title="Rename"
                      onClick={(e) => { e.stopPropagation(); startEdit(p) }}
                      className="mz-preset-action-btn"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                      </svg>
                    </button>
                    {/* Delete */}
                    <button
                      type="button"
                      title="Delete preset"
                      onClick={(e) => { e.stopPropagation(); onDelete(p.id) }}
                      className="mz-preset-action-btn mz-preset-action-delete"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                        <path d="M10 11v6M14 11v6"/>
                        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                      </svg>
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {presets.length === 0 && !saveNameMode && (
        <p style={{ fontSize: 11, color: 'var(--mz-text-2)', marginBottom: 8 }}>
          No saved presets yet.
        </p>
      )}

      {/* Save name input */}
      {saveNameMode ? (
        <div className="flex gap-1">
          <input
            ref={saveInputRef}
            className="mz-input"
            style={{ fontSize: 12, flex: 1 }}
            placeholder="Preset name…"
            value={newPresetName}
            onChange={(e) => setNewPresetName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') confirmSave()
              if (e.key === 'Escape') setSaveNameMode(false)
            }}
            autoFocus
          />
          <button
            type="button"
            onClick={confirmSave}
            className="mz-btn mz-btn-primary"
            style={{ padding: '6px 10px', fontSize: 11 }}
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => setSaveNameMode(false)}
            className="mz-btn mz-btn-ghost"
            style={{ padding: '6px 10px', fontSize: 11 }}
          >
            ✕
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={startSave}
          disabled={!canSave}
          className="mz-btn mz-btn-ghost w-full gap-1.5"
          style={{ fontSize: 11, justifyContent: 'center' }}
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v14a2 2 0 0 1-2 2z"/>
            <polyline points="17 21 17 13 7 13 7 21"/>
            <polyline points="7 3 7 8 15 8"/>
          </svg>
          {saveLabel}
        </button>
      )}
    </div>
  )
}
