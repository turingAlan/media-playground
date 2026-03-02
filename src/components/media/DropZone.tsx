import { useCallback, useRef, useState } from 'react'

type DropZoneProps = {
  accept: string[]
  /** Called with the first accepted file (single-file mode) */
  onFile?: (file: File) => void
  /** Called with all accepted files (multi-file mode) */
  onFiles?: (files: File[]) => void
  /** Allow selecting/dropping multiple files at once */
  multiple?: boolean
  label?: string
  sublabel?: string
  className?: string
}

export default function DropZone({
  accept,
  onFile,
  onFiles,
  multiple = false,
  label = 'Drop a file here',
  sublabel,
  className = '',
}: DropZoneProps) {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const isAccepted = (f: File) =>
    accept.some((a) => f.type.startsWith(a.replace('/*', '')) || f.name.endsWith(a.replace('*.', '.')))

  const emit = useCallback(
    (raw: File[]) => {
      const files = raw.filter(isAccepted)
      if (files.length === 0) return
      if (onFiles) onFiles(files)
      else if (onFile) onFile(files[0])
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accept, onFile, onFiles],
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragging(false)
      emit(Array.from(e.dataTransfer.files))
    },
    [emit],
  )

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      emit(Array.from(e.target.files ?? []))
      // reset so same file can be re-selected
      e.target.value = ''
    },
    [emit],
  )

  return (
    <button
      type="button"
      className={`mz-dropzone ${dragging ? 'is-dragging' : ''} ${className}`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
    >
      {/* Upload icon */}
      <span
        className="flex h-10 w-10 items-center justify-center rounded-md transition-transform duration-150"
        style={{ background: 'var(--mz-surface-2)', border: '1px solid var(--mz-border-2)', color: dragging ? 'var(--mz-accent)' : 'var(--mz-text-2)' }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
      </span>

      <div>
        <p className="text-sm font-medium" style={{ color: 'var(--mz-text)' }}>{label}</p>
        {sublabel && <p className="mt-0.5 text-xs" style={{ color: 'var(--mz-text-2)' }}>{sublabel}</p>}
      </div>

      <p style={{ fontSize: '11px', color: 'var(--mz-text-2)' }}>
        {multiple ? 'or click to browse · multiple files ok' : 'or click to browse'}
      </p>

      <input
        ref={inputRef}
        type="file"
        accept={accept.join(',')}
        multiple={multiple}
        className="sr-only"
        onChange={handleChange}
        tabIndex={-1}
      />
    </button>
  )
}
