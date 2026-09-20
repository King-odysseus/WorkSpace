import { fireEvent, render } from '@testing-library/react'
import { expect, it } from 'vitest'
import Avatar from './Avatar.jsx'

it('uses an uploaded image before initials', () => {
  const { container, queryByText } = render(
    <Avatar name="Amara Okafor" avatarUrl="/amara.png" />,
  )

  expect(container.querySelector('img')).toHaveAttribute('src', '/amara.png')
  expect(queryByText('AO')).not.toBeInTheDocument()
})

it('uses initials when a name exists without an image', () => {
  const { container, getByText } = render(<Avatar name="Amara Okafor" />)

  expect(getByText('AO')).toHaveClass('avatar-initials')
  expect(container.querySelector('img')).toBeNull()
})

it('falls back to initials when the uploaded image cannot be loaded', () => {
  const { container, getByText } = render(
    <Avatar name="Amara Okafor" avatarUrl="/broken.png" />,
  )

  fireEvent.error(container.querySelector('img'))

  expect(getByText('AO')).toHaveClass('avatar-initials')
  expect(container.querySelector('img')).toBeNull()
})

it('retries the image when a replacement avatar URL is supplied', () => {
  const { container, rerender } = render(
    <Avatar name="Amara Okafor" avatarUrl="/broken.png" />,
  )

  fireEvent.error(container.querySelector('img'))
  rerender(<Avatar name="Amara Okafor" avatarUrl="/replacement.png" />)

  expect(container.querySelector('img')).toHaveAttribute('src', '/replacement.png')
})

it('uses the neutral user icon when no name or image is available', () => {
  const { container } = render(<Avatar />)

  expect(container.querySelector('.avatar-fallback-icon')).toBeInTheDocument()
  expect(container.querySelector('.avatar-initials')).toBeNull()
})

it('renders presence as a separate status dot', () => {
  const { container } = render(<Avatar name="Amara Okafor" presence="available" />)

  expect(container.querySelector('.presence-dot.presence-available')).toHaveAttribute(
    'title',
    'Available',
  )
})
