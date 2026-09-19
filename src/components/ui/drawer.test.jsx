import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  Drawer, DrawerBody, DrawerContent, DrawerDangerZone, DrawerField, DrawerFooter, DrawerHeader, DrawerTitle,
} from './drawer.jsx'

// The sheet is portalled, so it lands on document.body rather than in the
// render container. Every query below goes through document for that reason.
const slot = name => document.querySelector(`[data-slot="${name}"]`)

function renderDrawer(props) {
  return render(
    <Drawer open>
      <DrawerContent {...props}>
        <DrawerHeader><DrawerTitle>Task details</DrawerTitle></DrawerHeader>
        <DrawerBody>
          <DrawerField label="Status">In progress</DrawerField>
        </DrawerBody>
        <DrawerFooter><button type="button">Save</button></DrawerFooter>
      </DrawerContent>
    </Drawer>,
  )
}

describe('Drawer', () => {
  it('labels the sheet with its title and keeps the bands separate', () => {
    renderDrawer()

    expect(screen.getByRole('dialog', { name: 'Task details' })).toBeInTheDocument()
    expect(slot('drawer-header')).toBeInTheDocument()
    expect(slot('drawer-body')).toBeInTheDocument()
    expect(slot('drawer-footer')).toBeInTheDocument()
  })

  it('defaults to the right-hand side', () => {
    renderDrawer()
    expect(slot('drawer-content')).toHaveAttribute('data-side', 'right')
  })

  it('renders every band asked for, and the close control', () => {
    render(
      <Drawer open>
        <DrawerContent side="bottom">
          <DrawerHeader><DrawerTitle>Filters</DrawerTitle></DrawerHeader>
          <DrawerBody>Body</DrawerBody>
          <DrawerDangerZone><button type="button">Delete</button></DrawerDangerZone>
        </DrawerContent>
      </Drawer>,
    )

    expect(slot('drawer-content')).toHaveAttribute('data-side', 'bottom')
    expect(slot('drawer-danger-zone')).toBeInTheDocument()
    expect(slot('drawer-close')).toBeInTheDocument()
  })

  it('hides the close control when the caller supplies its own', () => {
    renderDrawer({ showCloseButton: false })
    expect(slot('drawer-content')).toBeInTheDocument()
    expect(slot('drawer-close')).not.toBeInTheDocument()
  })

  it('closes on escape', async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(
      <Drawer open onOpenChange={onOpenChange}>
        <DrawerContent><DrawerHeader><DrawerTitle>Task details</DrawerTitle></DrawerHeader></DrawerContent>
      </Drawer>,
    )

    await user.keyboard('{Escape}')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
