import { useState } from 'react'
import { Download, FileSpreadsheet, Upload } from 'lucide-react'
import { Card } from './ui/card.jsx'
import { WorkspaceViewHeading } from './workspace-ui.jsx'
import { getCsrfToken } from '../lib/workspace-format.js'

const IMPORT_TYPES = {
  tasks: { label: 'Tasks', description: 'Import task ownership, planning, execution, and status data.' },
  projects: { label: 'Projects', description: 'Create or update project dates, status, timezone, and configuration.' },
  stakeholders: { label: 'Stakeholders', description: 'Create or update stakeholder influence, interest, role, and notes.' },
}

export default function ImportView({ workspaceId, role }) {
  const [kind, setKind] = useState('tasks')
  const [format, setFormat] = useState('xlsx')
  const [file, setFile] = useState(null)
  const [columnMap, setColumnMap] = useState('')
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const canCommit = ['owner', 'manager'].includes(role)

  const templateUrl = `/api/workspaces/${workspaceId}/imports/templates/${kind}.${format}`
  const previewImport = async event => {
    event.preventDefault()
    if (!file) return setError('Choose a CSV or Excel file first.')
    setBusy(true); setError(''); setPreview(null)
    const form = new FormData()
    form.append('workbook', file); form.append('import_type', kind)
    if (columnMap.trim()) form.append('column_map', columnMap)
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/imports/preview/`, { method: 'POST', credentials: 'include', headers: { 'X-CSRFToken': await getCsrfToken() }, body: form })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Preview failed.')
      setPreview(data.preview)
    } catch (requestError) { setError(requestError.message) } finally { setBusy(false) }
  }

  const commitImport = async () => {
    if (!preview || !file || !canCommit) return
    setBusy(true); setError('')
    const form = new FormData()
    form.append('workbook', file); form.append('import_type', kind); form.append('preview_id', preview.preview_id); form.append('preview_checksum', preview.checksum)
    if (columnMap.trim()) form.append('column_map', columnMap)
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/imports/commit/`, { method: 'POST', credentials: 'include', headers: { 'X-CSRFToken': await getCsrfToken() }, body: form })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Commit failed.')
      setPreview(null); setFile(null)
      window.dispatchEvent(new CustomEvent('workspace:notice', { detail: { message: `Import complete: ${data.result.created} created, ${data.result.updated} updated.` } }))
    } catch (requestError) { setError(requestError.message) } finally { setBusy(false) }
  }

  const downloadErrors = () => {
    if (!preview?.exceptions?.length) return
    const escape = value => `"${String(value ?? '').replaceAll('"', '""')}"`
    const csv = ['Row,Field,Message', ...preview.exceptions.map(item => [item.row, item.field, item.message].map(escape).join(','))].join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a'); link.href = url; link.download = `${kind}-import-errors.csv`; link.click(); URL.revokeObjectURL(url)
  }

  return <section className="workspace-view import-view">
    <WorkspaceViewHeading title="Import data" subtitle="Use a template, preview every change, then commit a validated workspace import." />
    {error && <p className="auth-error" role="alert">{error}</p>}
    <Card className="import-panel">
      <div className="import-type-grid">{Object.entries(IMPORT_TYPES).map(([value, option]) => <button type="button" key={value} className={`import-type-option${kind === value ? ' is-selected' : ''}`} onClick={() => { setKind(value); setPreview(null) }}><FileSpreadsheet size={20} /><strong>{option.label}</strong><span>{option.description}</span></button>)}</div>
      <div className="import-template-actions"><span>Start with a template:</span><a className="secondary-button" href={`${templateUrl}`}><Download size={15} /> Download {IMPORT_TYPES[kind].label} {format.toUpperCase()} template</a><label>Format<select value={format} onChange={event => setFormat(event.target.value)}><option value="xlsx">Excel</option><option value="csv">CSV</option></select></label></div>
      <form className="import-upload-form" onSubmit={previewImport}><label className="import-file-input">Upload {IMPORT_TYPES[kind].label}<input type="file" accept=".xlsx,.csv" onChange={event => { setFile(event.target.files?.[0] || null); setPreview(null) }} /></label><label>Optional column map (JSON)<textarea rows="3" value={columnMap} onChange={event => setColumnMap(event.target.value)} placeholder='{"name":"Project name"}' /></label><button className="primary-button" disabled={busy || !file}><Upload size={15} /> {busy ? 'Working…' : 'Preview import'}</button></form>
    </Card>
    {preview && <Card className="import-preview-panel"><div className="drawer-section-heading"><h3>Preview results</h3><span>{preview.summary.total_rows} rows · checksum {preview.checksum.slice(0, 12)}…</span></div><div className="import-summary"><strong>{preview.summary.creates || 0} creates</strong><strong>{preview.summary.updates || 0} updates</strong><strong className={preview.summary.exceptions ? 'has-errors' : ''}>{preview.summary.exceptions || 0} exceptions</strong></div>{preview.exceptions?.length > 0 && <><div className="import-errors">{preview.exceptions.map((item, index) => <p key={`${item.row}-${item.field}-${index}`}>Row {item.row} · {item.field}: {item.message}</p>)}</div><button type="button" className="secondary-button" onClick={downloadErrors}><Download size={15} /> Download error report</button></>}<div className="import-preview-actions"><p>{preview.summary.exceptions ? 'Rows with exceptions will be skipped. Review them before committing.' : 'No validation exceptions found.'}</p>{canCommit ? <button type="button" className="primary-button" disabled={busy} onClick={commitImport}>Commit reviewed import</button> : <span>Only owners and managers can commit imports.</span>}</div></Card>}
  </section>
}
