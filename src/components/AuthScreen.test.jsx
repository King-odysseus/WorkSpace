import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AuthScreen } from './AuthScreen.jsx'
import { mockApi, expectRequest } from '../test/setup-tests.js'

const renderScreen = (props = {}) => {
  const onAuthenticated = vi.fn()
  render(
    <AuthScreen
      theme="light"
      onToggleTheme={() => {}}
      onAuthenticated={onAuthenticated}
      connectionError={false}
      {...props}
    />,
  )
  return { onAuthenticated }
}

const user = { id: 1, email: 'ada@example.com', workspaces: [] }

describe('AuthScreen sign in', () => {
  it('posts credentials to the login endpoint and hands back the user', async () => {
    const fetchMock = mockApi({ '/api/auth/csrf/': { status: 'ok' }, '/api/auth/login/': { user } })
    const { onAuthenticated } = renderScreen()

    await userEvent.type(screen.getByLabelText(/email/i), 'ada@example.com')
    await userEvent.type(screen.getByLabelText(/password/i), 'secure-pass-123')
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }))

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith(user))
    const [, init] = expectRequest(fetchMock, '/api/auth/login/', 'POST')
    expect(JSON.parse(init.body)).toMatchObject({ email: 'ada@example.com', password: 'secure-pass-123' })
  })

  it('surfaces the server error and does not authenticate', async () => {
    mockApi({
      '/api/auth/csrf/': { status: 'ok' },
      '/api/auth/login/': { body: { error: 'Invalid email or password.' }, status: 401 },
    })
    const { onAuthenticated } = renderScreen()

    await userEvent.type(screen.getByLabelText(/email/i), 'ada@example.com')
    await userEvent.type(screen.getByLabelText(/password/i), 'wrong-password')
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }))

    expect(await screen.findByText('Invalid email or password.')).toBeInTheDocument()
    expect(onAuthenticated).not.toHaveBeenCalled()
  })
})

describe('AuthScreen sign up', () => {
  it('switches to signup and posts to the account endpoint', async () => {
    const fetchMock = mockApi({ '/api/auth/csrf/': { status: 'ok' }, '/api/auth/me/': { user } })
    renderScreen()

    await userEvent.click(screen.getByRole('button', { name: /create an account/i }))
    await userEvent.type(screen.getByLabelText(/first name/i), 'Ada')
    await userEvent.type(screen.getByLabelText(/workspace name/i), 'Analytical')
    await userEvent.type(screen.getByLabelText(/email/i), 'ada@example.com')
    await userEvent.type(screen.getByLabelText(/password/i), 'secure-pass-123')
    await userEvent.click(screen.getByRole('button', { name: /create workspace/i }))

    await waitFor(() => expectRequest(fetchMock, '/api/auth/me/', 'POST'))
  })
})

describe('AuthScreen invitation handling', () => {
  const inviteInfo = { id: 3, email: 'invitee@example.com', workspace_name: 'Northstar', role: 'member' }

  it('explains the invitation and locks the address it was sent to', () => {
    renderScreen({ inviteInfo })

    expect(screen.getByText(/invited to join/i)).toHaveTextContent('Northstar')
    const email = screen.getByLabelText(/email/i)
    expect(email).toHaveValue('invitee@example.com')
    expect(email).toHaveAttribute('readonly')
  })

  it('shows no invitation banner when there is no invitation', () => {
    renderScreen()
    expect(screen.queryByText(/invited to join/i)).not.toBeInTheDocument()
  })
})

describe('AuthScreen Google sign-in', () => {
  it('is hidden when no Google client id is configured', () => {
    // VITE_GOOGLE_CLIENT_ID is unset in the test env, matching a deployment that
    // has not enabled Google sign-in - the button must not render at all.
    const { container } = render(
      <AuthScreen theme="light" onToggleTheme={() => {}} onAuthenticated={vi.fn()} connectionError={false} />,
    )
    expect(container.querySelector('.auth-google-button')).toBeNull()
  })
})
