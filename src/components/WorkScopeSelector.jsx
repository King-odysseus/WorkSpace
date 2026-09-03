import React from 'react'
import { BriefcaseBusiness, Layers3 } from 'lucide-react'

export function taskMatchesScope(task, scope) {
  if (!scope || scope === 'all') return true
  if (scope === 'operations') return !task.project_id
  return String(task.project_id || '') === String(scope)
}

export default function WorkScopeSelector({ value = 'all', onChange, projects = [], label = 'Work scope', compact = false }) {
  const selectedProject = projects.find(project => String(project.id) === String(value))
  return <label className={`work-scope-selector ${compact ? 'is-compact' : ''}`}>
    <span><Layers3 size={13} /> {label}</span>
    <span className="work-scope-control">
      <BriefcaseBusiness size={15} aria-hidden="true" />
      <select value={value} onChange={event => onChange(event.target.value)} aria-label={label}>
        <option value="all">All work</option>
        <option value="operations">Operations only</option>
        <optgroup label="Projects">
          {projects.map(project => <option key={project.id} value={String(project.id)}>{project.name}</option>)}
        </optgroup>
      </select>
    </span>
    {!compact && <small>{value === 'operations' ? 'Ongoing work not linked to a project' : selectedProject ? `Project: ${selectedProject.name}` : 'Operations and every project'}</small>}
  </label>
}
