import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import FilePreview from './FilePreview.jsx'

// The file name is drawn in the bar as well as on the frame, so these look for
// the rendered element itself rather than by title.
const preview = file => render(<FilePreview file={file} onClose={vi.fn()} />)

it('always offers a way back, whatever the file is', () => {
  const onClose = vi.fn()
  render(<FilePreview file={{ url: '/api/workspace-files/9/download/', name: 'Brief.pdf' }} onClose={onClose} />)

  const back = screen.getByRole('button', { name: 'Back' })
  fireEvent.click(back)

  expect(onClose).toHaveBeenCalled()
})

it('renders an image rather than sending the reader to a new tab', () => {
  preview({ url: '/api/workspace-files/4/download/', name: 'holiday.png' })

  expect(screen.getByRole('img', { name: 'holiday.png' })).toBeInTheDocument()
  expect(screen.getByRole('dialog', { name: 'Preview of holiday.png' })).toBeInTheDocument()
})

it('renders a PDF in the browser viewer', () => {
  preview({ url: '/api/workspace-files/4/download/', name: 'Brief.pdf' })

  // The viewer portals to <body>, so it sits beside the render container.
  const frame = document.body.querySelector('iframe')
  expect(frame).toHaveAttribute('src', '/api/workspace-files/4/download/')
})

it('falls back to a download for a type the server will not serve inline', () => {
  preview({ url: '/api/workspace-files/4/download/', name: 'Plan.docx' })

  expect(screen.getByText('This file type cannot be shown inside the app.')).toBeInTheDocument()
  expect(document.body.querySelector('iframe')).toBeNull()
  // Still the reader's file, so the download has to be reachable.
  expect(screen.getAllByRole('link', { name: /Download/ })[0]).toHaveAttribute(
    'href',
    '/api/workspace-files/4/download/?download=1',
  )
})

it('refuses to load a URL whose scheme could run script', () => {
  preview({ url: 'javascript:alert(1)', name: 'holiday.png' })

  expect(screen.queryByRole('img')).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: /Download/ })).not.toBeInTheDocument()
  expect(screen.getByText('This file type cannot be shown inside the app.')).toBeInTheDocument()
})

it('closes on Escape so the reader is never stuck in the viewer', () => {
  const onClose = vi.fn()
  render(<FilePreview file={{ url: '/api/workspace-files/9/download/', name: 'Brief.pdf' }} onClose={onClose} />)

  fireEvent.keyDown(window, { key: 'Escape' })

  expect(onClose).toHaveBeenCalled()
})
