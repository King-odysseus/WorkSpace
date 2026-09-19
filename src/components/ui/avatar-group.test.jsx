import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AvatarGroup } from './avatar-group.jsx'

const people = [
  { id: '1', name: 'Amara Okafor' },
  { id: '2', name: 'Ravi Shah' },
  { id: '3', name: 'Lena Fischer' },
  { id: '4', name: 'Tomas Neri' },
  { id: '5', name: 'Yuki Sato' },
]

describe('AvatarGroup', () => {
  it('shows the first four and counts the remainder', () => {
    render(<AvatarGroup people={people} />)

    expect(screen.getByText('+1')).toBeInTheDocument()
    expect(screen.queryByTitle('Yuki Sato')).not.toBeInTheDocument()
    expect(screen.getAllByTitle(/Amara Okafor|Ravi Shah|Lena Fischer|Tomas Neri/)).toHaveLength(4)
  })

  it('reports the caller-supplied total when only a page was fetched', () => {
    render(<AvatarGroup people={people.slice(0, 2)} total={20} />)
    expect(screen.getByText('+18')).toBeInTheDocument()
  })

  it('drops the overflow chip when everyone fits', () => {
    render(<AvatarGroup people={people.slice(0, 3)} />)
    expect(screen.queryByText(/^\+/)).not.toBeInTheDocument()
  })

  it('prefers a photo over initials', () => {
    render(<AvatarGroup people={[{ id: '1', name: 'Amara Okafor', avatarUrl: '/amara.png' }]} />)
    const group = screen.getByTitle('Amara Okafor')
    expect(group.querySelector('img')).toHaveAttribute('src', '/amara.png')
  })
})
