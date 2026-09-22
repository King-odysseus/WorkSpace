import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Info,
  Upload,
  X,
} from 'lucide-react'

import { Card } from './ui/card.jsx'
import { WorkspaceViewHeading } from './workspace-ui.jsx'
import { getCsrfToken, readJsonResponse } from '../lib/workspace-format.js'

const IMPORT_TYPES = {
  tasks: {
    label: 'Tasks',
    description: 'Import task ownership, planning, execution, and status data.',
  },
  projects: {
    label: 'Projects',
    description: 'Create or update project dates, status, timezone, and configuration.',
  },
  stakeholders: {
    label: 'Stakeholders',
    description: 'Create or update stakeholder influence, interest, role, and notes.',
  },
}

const SOURCE_OPTIONS = [
  {
    id: 'spreadsheet',
    label: 'CSV or spreadsheet',
    description: 'Tasks, projects and members from a table or Google Sheet.',
    badge: 'Recommended',
    supported: true,
  },
  {
    id: 'trello-asana',
    label: 'Trello or Asana',
    description: 'Lists and columns become Planner buckets.',
    supported: false,
  },
  {
    id: 'json',
    label: 'JSON export',
    description: 'A full backup from another workspace tool.',
    supported: false,
  },
  {
    id: 'archive',
    label: 'Workspace archive',
    description: 'Restore a previous Workspace export.',
    supported: false,
  },
]

const STEP_LABELS = ['Choose source', 'Upload file', 'Map fields', 'Preview and import']

function fileSizeLabel(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function importSummary(preview, kind, file, format) {
  if (!preview) {
    return {
      source: file ? file.name : 'No file selected',
      rows: 0,
      creates: 0,
      updates: 0,
      exceptions: 0,
      metrics: [],
    }
  }
  const previewSummary = preview.summary || {}
  const rows = preview.rows || []
  const unique = (values) => new Set(values.filter(Boolean)).size
  const totalRows = previewSummary.total_rows || 0
  const extension = file?.name?.split('.').pop()?.toLowerCase()
  const sourceFormat = extension === 'xlsx' ? 'Excel' : extension?.toUpperCase() || format.toUpperCase()
  const metrics = kind === 'tasks'
    ? [
        { label: 'Tasks detected', value: totalRows },
        { label: 'Projects detected', value: unique(rows.map((item) => item.project_name)) },
        { label: 'Members matched', value: unique(rows.map((item) => item.assignee_name)) },
      ]
    : kind === 'projects'
      ? [
          { label: 'Projects detected', value: totalRows },
          { label: 'New projects', value: previewSummary.creates || 0 },
          { label: 'Updates', value: previewSummary.updates || 0 },
        ]
      : [
          { label: 'Stakeholders detected', value: totalRows },
          { label: 'New stakeholders', value: previewSummary.creates || 0 },
          { label: 'Updates', value: previewSummary.updates || 0 },
        ]
  return {
    source: `${sourceFormat} - ${totalRows} rows`,
    rows: totalRows,
    creates: previewSummary.creates || 0,
    updates: previewSummary.updates || 0,
    exceptions: previewSummary.exceptions || 0,
    metrics,
  }
}

export default function ImportView({ workspaceId, role }) {
  const [kind, setKind] = useState('tasks')
  const [format, setFormat] = useState('xlsx')
  const [source, setSource] = useState('spreadsheet')
  const [file, setFile] = useState(null)
  const [columnMap, setColumnMap] = useState('')
  const [preview, setPreview] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [dragActive, setDragActive] = useState(false)

  const canCommit = ['owner', 'manager'].includes(role)
  const templateUrl = `/api/workspaces/${workspaceId}/imports/templates/${kind}.${format}`
  const summary = useMemo(() => importSummary(preview, kind, file, format), [file, format, kind, preview])
  const currentStep = preview ? 4 : file ? 3 : 1

  const chooseFile = (nextFile) => {
    setFile(nextFile || null)
    setPreview(null)
    setResult(null)
    setError('')
  }

  const previewImport = async (event) => {
    event.preventDefault()
    if (!file) {
      setError('Choose a CSV or Excel file first.')
      return
    }
    setBusy(true)
    setError('')
    setPreview(null)
    setResult(null)
    const form = new FormData()
    form.append('workbook', file)
    form.append('import_type', kind)
    if (columnMap.trim()) form.append('column_map', columnMap)
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/imports/preview/`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'X-CSRFToken': await getCsrfToken() },
        body: form,
      })
      const data = await readJsonResponse(response, 'Preview failed.')
      if (!response.ok) throw new Error(data.error || 'Preview failed.')
      setPreview(data.preview)
    } catch (requestError) {
      setError(requestError.message || 'Preview failed.')
    } finally {
      setBusy(false)
    }
  }

  const commitImport = async () => {
    if (!preview || !file || !canCommit) return
    setBusy(true)
    setError('')
    const form = new FormData()
    form.append('workbook', file)
    form.append('import_type', kind)
    form.append('preview_id', preview.preview_id)
    form.append('preview_checksum', preview.checksum)
    if (columnMap.trim()) form.append('column_map', columnMap)
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/imports/commit/`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'X-CSRFToken': await getCsrfToken() },
        body: form,
      })
      const data = await readJsonResponse(response, 'Commit failed.')
      if (!response.ok) throw new Error(data.error || 'Commit failed.')
      setResult(data.result)
      setPreview(null)
      setFile(null)
      window.dispatchEvent(new CustomEvent('workspace:notice', {
        detail: `Import complete: ${data.result.created} created, ${data.result.updated} updated.`,
      }))
    } catch (requestError) {
      setError(requestError.message || 'Commit failed.')
    } finally {
      setBusy(false)
    }
  }

  const downloadErrors = () => {
    if (!preview?.exceptions?.length) return
    const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`
    const csv = [
      'Row,Field,Message',
      ...preview.exceptions.map((item) => [item.row, item.field, item.message].map(escape).join(',')),
    ].join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${kind}-import-errors.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  const updateKind = (nextKind) => {
    setKind(nextKind)
    setPreview(null)
    setResult(null)
    setError('')
  }

  return (
    <section className="workspace-view import-view">
      <WorkspaceViewHeading
        title="Import data"
        subtitle="Bring tasks, projects and people in from another tool."
      />

      <div className="import-stepper" role="group" aria-label="Import progress">
        {STEP_LABELS.map((label, index) => {
          const number = index + 1
          const complete = number < currentStep
          const current = number === currentStep
          return (
            <div className={`import-step${complete ? ' is-complete' : ''}${current ? ' is-current' : ''}`} key={label}>
              <span aria-hidden="true">{complete ? <Check size={14} /> : number}</span>
              <strong>{label}</strong>
            </div>
          )
        })}
      </div>

      <div className="import-layout">
        <div className="import-main-column">
          <Card className="import-section">
            <header className="import-section-heading">
              <h2>Choose what to import</h2>
              <span>Source type</span>
            </header>
            <div className="import-source-grid">
              {SOURCE_OPTIONS.map((option) => {
                const selected = source === option.id
                return (
                  <button
                    type="button"
                    className={`import-source-card${selected ? ' is-selected' : ''}`}
                    key={option.id}
                    onClick={() => {
                      if (!option.supported) return
                      setSource(option.id)
                      setPreview(null)
                      setResult(null)
                    }}
                    disabled={!option.supported}
                    aria-pressed={selected}
                  >
                    <span className="import-source-radio" aria-hidden="true">
                      {selected && <span />}
                    </span>
                    <span className="import-source-copy">
                      <strong>{option.label}</strong>
                      <small>{option.description}</small>
                      {option.badge && <em>{option.badge}</em>}
                      {!option.supported && <em className="is-muted">Not available in this build</em>}
                    </span>
                  </button>
                )
              })}
            </div>
          </Card>

          <Card className="import-section">
            <header className="import-section-heading">
              <h2>Upload your file</h2>
              <label className="import-format-select">
                <span>Template</span>
                <select value={format} onChange={(event) => setFormat(event.target.value)}>
                  <option value="xlsx">Excel</option>
                  <option value="csv">CSV</option>
                </select>
              </label>
            </header>

            <div className="import-kind-tabs" role="tablist" aria-label="What to import">
              {Object.entries(IMPORT_TYPES).map(([value, option]) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={kind === value}
                  className={kind === value ? 'active' : ''}
                  key={value}
                  onClick={() => updateKind(value)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <p className="import-kind-description">{IMPORT_TYPES[kind].description}</p>

            <label
              className={`import-dropzone${dragActive ? ' is-dragging' : ''}${file ? ' has-file' : ''}`}
              onDragEnter={(event) => { event.preventDefault(); setDragActive(true) }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setDragActive(false)}
              onDrop={(event) => {
                event.preventDefault()
                setDragActive(false)
                chooseFile(event.dataTransfer?.files?.[0])
              }}
            >
              <input
                type="file"
                accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(event) => chooseFile(event.target.files?.[0])}
              />
              <span className="import-dropzone-icon" aria-hidden="true"><Upload size={20} /></span>
              <strong>{file ? 'Choose a different file' : 'Drag a file here, or choose from your computer'}</strong>
              <small>CSV or Excel, up to the workspace upload limit</small>
            </label>

            {file && (
              <div className="import-selected-file">
                <span className="import-file-icon" aria-hidden="true"><FileSpreadsheet size={18} /></span>
                <span className="import-file-copy">
                  <strong>{file.name}</strong>
                  <small>
                    {fileSizeLabel(file.size)}
                    {preview ? ` - ${summary.rows} rows - ready to import` : ' - ready to preview'}
                  </small>
                </span>
                <span className="import-file-ready"><CheckCircle2 size={15} /> Selected</span>
                <button type="button" onClick={() => chooseFile(null)} aria-label={`Remove ${file.name}`} title="Remove file"><X size={16} /></button>
              </div>
            )}

            <div className="import-upload-actions">
              <a className="secondary-button" href={templateUrl}>
                <Download size={15} /> Download {IMPORT_TYPES[kind].label} template
              </a>
              <details className="import-map-fields">
                <summary>Map fields (optional)</summary>
                <label>
                  <span>Column map JSON</span>
                  <textarea
                    rows="3"
                    value={columnMap}
                    onChange={(event) => setColumnMap(event.target.value)}
                    placeholder='{"name":"Project name"}'
                  />
                </label>
              </details>
              <button type="button" className="primary-button" disabled={busy || !file} onClick={previewImport}>
                <Upload size={15} /> {busy && !preview ? 'Checking file...' : 'Preview import'}
              </button>
            </div>
          </Card>

          {preview && (
            <Card className="import-section import-preview-panel">
              <header className="import-section-heading">
                <div>
                  <p className="eyebrow">Step 4</p>
                  <h2>Preview results</h2>
                </div>
                <span>{summary.rows} rows - checksum {preview.checksum.slice(0, 12)}...</span>
              </header>
              <div className="import-summary-grid">
                <div><strong>{summary.creates}</strong><span>New records</span></div>
                <div><strong>{summary.updates}</strong><span>Updates</span></div>
                <div className={summary.exceptions ? 'has-errors' : ''}><strong>{summary.exceptions}</strong><span>Need review</span></div>
              </div>
              {preview.exceptions?.length > 0 ? (
                <div className="import-exceptions">
                  <div className="import-inline-alert warning">
                    <AlertTriangle size={17} />
                    <span>Rows with exceptions will be skipped. Review them before committing.</span>
                  </div>
                  <div className="import-error-list">
                    {preview.exceptions.slice(0, 8).map((item, index) => (
                      <p key={`${item.row}-${item.field}-${index}`}>
                        <strong>Row {item.row} - {item.field}</strong>
                        <span>{item.message}</span>
                      </p>
                    ))}
                  </div>
                  {preview.exceptions.length > 8 && <small>Showing 8 of {preview.exceptions.length} exceptions.</small>}
                  <button type="button" className="secondary-button" onClick={downloadErrors}>
                    <Download size={15} /> Download error report
                  </button>
                </div>
              ) : (
                <div className="import-inline-alert success">
                  <CheckCircle2 size={17} />
                  <span>No validation exceptions found. The file is ready to import.</span>
                </div>
              )}
              <div className="import-preview-actions">
                <p>
                  {canCommit
                    ? 'Commit is final for the rows shown in this preview.'
                    : 'Only owners and managers can commit imports.'}
                </p>
                {canCommit ? (
                  <button type="button" className="primary-button" disabled={busy} onClick={commitImport}>
                    {busy ? 'Importing...' : 'Commit reviewed import'}
                  </button>
                ) : (
                  <span className="import-permission-note"><Info size={15} /> Preview only</span>
                )}
              </div>
            </Card>
          )}

          {error && <div className="import-inline-alert danger" role="alert"><AlertTriangle size={17} /><span>{error}</span></div>}
        </div>

        <aside className="import-side-column">
          <Card className="import-side-card">
            <header className="import-side-heading">
              <h2>Import summary</h2>
              <span>{preview ? 'Ready' : 'Waiting'}</span>
            </header>
            <dl className="import-summary-list">
              <div><dt>Source</dt><dd>{summary.source}</dd></div>
              {summary.metrics.map((metric) => (
                <div key={metric.label}><dt>{metric.label}</dt><dd>{metric.value}</dd></div>
              ))}
              <div><dt>Rows needing review</dt><dd className={summary.exceptions ? 'is-warning' : ''}>{summary.exceptions}</dd></div>
            </dl>
            <p className="import-side-note">
              {preview
                ? 'The preview checks ownership, dates, statuses and references before anything is written.'
                : 'Choose a supported file to see the exact records Workspace will create or update.'}
            </p>
          </Card>

          <Card className="import-side-card import-progress-card">
            <h2>{busy ? 'Working' : preview ? 'Ready to import' : 'Import progress'}</h2>
            <p>
              {busy
                ? 'Workspace is validating or importing the file. Keep this screen open until the request finishes.'
                : preview
                  ? 'Review the summary before committing the validated rows.'
                  : 'The preview and commit requests run synchronously through the existing import API.'}
            </p>
            <div className="import-progress-track" aria-hidden="true">
              <span style={{ width: busy ? '62%' : preview ? '100%' : '0%' }} />
            </div>
            <small>Live background progress and cancellation are not supported by the current API.</small>
          </Card>

          <Card className="import-side-card">
            <h2>Outcomes</h2>
            <div className="import-outcome-list">
              <div className={result ? 'is-complete' : ''}>
                <CheckCircle2 size={17} />
                <span><strong>Import complete</strong><small>{result ? `${result.created} created, ${result.updated} updated.` : 'Appears after a successful commit.'}</small></span>
              </div>
              <div className={result?.exceptions?.length ? 'is-warning' : ''}>
                <AlertTriangle size={17} />
                <span><strong>Completed with warnings</strong><small>{result?.exceptions?.length ? `${result.exceptions.length} rows skipped.` : 'Shown when rows are skipped.'}</small></span>
              </div>
              <div>
                <X size={17} />
                <span><strong>Import failed</strong><small>Fix invalid rows or references, then retry.</small></span>
              </div>
            </div>
          </Card>

          {!canCommit && (
            <div className="import-inline-alert warning">
              <Info size={17} />
              <span>Your role can preview files but cannot commit changes.</span>
            </div>
          )}
        </aside>
      </div>
    </section>
  )
}
