import { Trash2, X } from 'lucide-react'
import { AppSelect } from './ui/select.jsx'
import { Button } from './ui/button.jsx'

/**
 * The bar that appears while cards are selected on a board.
 *
 * Both boards select the same thing - tasks - and offer the same three actions,
 * so the bar is shared and only the destination list differs: buckets on the
 * planner, statuses on the project kanban.
 *
 * It renders nothing when the selection is empty, which is what keeps the
 * boards unchanged until someone turns selection on and picks a card.
 */
export default function BulkActionBar({
  selectedCount,
  destinations = [],
  destinationLabel = 'Move to',
  onMove,
  onArchive,
  onDelete,
  onClear,
  busy = false,
}) {
  const countLabel = selectedCount ? `${selectedCount} ${selectedCount === 1 ? 'card' : 'cards'} selected` : ''
  return (
    <>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{countLabel}</p>
      {selectedCount > 0 && (
        <div className="bulk-action-bar" role="region" aria-label="Bulk actions">
          <strong className="bulk-action-count">{countLabel}</strong>
          {destinations.length > 0 && (
            <AppSelect
              className="bulk-action-move"
              value=""
              disabled={busy}
              aria-label={destinationLabel}
              // A command, not a stored value: `value` stays empty so the control
              // keeps showing its placeholder and the same destination can be
              // chosen twice running.
              onChange={event => { if (event.target.value) onMove?.(event.target.value) }}
            >
              <option value="">{destinationLabel}</option>
              {destinations.map(destination => (
                <option key={destination.value} value={destination.value}>{destination.label}</option>
              ))}
            </AppSelect>
          )}
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => onArchive?.()}>
            Archive
          </Button>
          {onDelete && (
            <Button type="button" variant="outline" size="sm" className="bulk-action-delete" disabled={busy} onClick={() => onDelete()}>
              <Trash2 size={14} aria-hidden="true" /> Delete
            </Button>
          )}
          <button type="button" className="bulk-action-clear" onClick={() => onClear?.()} aria-label="Clear selection">
            <X size={16} />
          </button>
        </div>
      )}
    </>
  )
}
