import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import userEvent from '@testing-library/user-event'
import { AuthScreen, InvitationReview, NoWorkspaceScreen } from './AuthScreen.jsx'
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

  it('does not require a workspace name when joining solely via an invitation', async () => {
    const fetchMock = mockApi({ '/api/auth/csrf/': { status: 'ok' }, '/api/auth/me/': { user } })
    renderScreen({ inviteInfo })

    await userEvent.click(screen.getByRole('button', { name: /create an account/i }))
    expect(screen.queryByLabelText(/workspace name/i)).not.toBeInTheDocument()
    await userEvent.type(screen.getByLabelText(/first name/i), 'Ada')
    await userEvent.type(screen.getByLabelText(/password/i), 'secure-pass-123')
    await userEvent.click(screen.getByRole('button', { name: /create workspace/i }))

    const [, init] = await waitFor(() => expectRequest(fetchMock, '/api/auth/me/', 'POST'))
    expect(JSON.parse(init.body)).toMatchObject({ join_only: true, email: 'invitee@example.com' })
  })
})

describe('InvitationReview', () => {
  const invitation = { id: 7, email: 'invitee@example.com', workspace_name: 'Northstar', role: 'member', status: 'pending', invited_by_name: 'Ada Lovelace', expires_at: '2026-09-12T00:00:00Z' }

  it('lets the matching account accept the invitation', async () => {
    const onAccept = vi.fn()
    render(<InvitationReview invitation={invitation} currentUserEmail="invitee@example.com" onAccept={onAccept} onDecline={vi.fn()} onDismiss={vi.fn()} onSignOut={vi.fn()} />)
    expect(screen.getByText('Northstar')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /accept invitation/i }))
    expect(onAccept).toHaveBeenCalled()
  })

  it('lets the matching account decline the invitation', async () => {
    const onDecline = vi.fn()
    render(<InvitationReview invitation={invitation} currentUserEmail="invitee@example.com" onAccept={vi.fn()} onDecline={onDecline} onDismiss={vi.fn()} onSignOut={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /decline/i }))
    expect(onDecline).toHaveBeenCalled()
  })

  it('blocks acceptance and offers sign-out when the signed-in account does not match', () => {
    render(<InvitationReview invitation={invitation} currentUserEmail="someone-else@example.com" onAccept={vi.fn()} onDecline={vi.fn()} onDismiss={vi.fn()} onSignOut={vi.fn()} />)
    expect(screen.getByRole('alert')).toHaveTextContent('does not match the account')
    expect(screen.queryByRole('button', { name: /accept invitation/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument()
  })

  it('shows an expired invitation as unactionable', () => {
    render(<InvitationReview invitation={{ ...invitation, status: 'expired' }} currentUserEmail="invitee@example.com" onAccept={vi.fn()} onDecline={vi.fn()} onDismiss={vi.fn()} onSignOut={vi.fn()} />)
    expect(screen.getByRole('alert')).toHaveTextContent('expired')
    expect(screen.queryByRole('button', { name: /accept invitation/i })).not.toBeInTheDocument()
  })
})

describe('NoWorkspaceScreen', () => {
  it('lists pending invitations for a user with no memberships', async () => {
    const onReview = vi.fn()
    const invitation = { id: 9, workspace_name: 'Northstar', role: 'member', invited_by_name: 'Ada Lovelace' }
    render(<NoWorkspaceScreen pendingInvitations={[invitation]} onReview={onReview} onSignOut={vi.fn()} />)
    expect(screen.getByText(/Northstar/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /review invitation/i }))
    expect(onReview).toHaveBeenCalledWith(invitation)
  })

  it('explains there is nothing to review when there are no invitations', () => {
    render(<NoWorkspaceScreen pendingInvitations={[]} onReview={vi.fn()} onSignOut={vi.fn()} />)
    expect(screen.getByText(/no pending workspace invitations/i)).toBeInTheDocument()
  })
})

describe('AuthScreen Google sign-in', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    document.querySelectorAll('script[src="https://accounts.google.com/gsi/client"]').forEach(script => script.remove())
  })

  const googleMock = () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id')
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 358 })
    const id = { initialize: vi.fn(), renderButton: vi.fn() }
    vi.stubGlobal('google', { accounts: { id } })
    return id
  }

  it('is hidden when no Google client id is configured', () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', '')
    // VITE_GOOGLE_CLIENT_ID is unset in the test env, matching a deployment that
    // has not enabled Google sign-in - the button must not render at all.
    const { container } = render(
      <AuthScreen theme="light" onToggleTheme={() => {}} onAuthenticated={vi.fn()} connectionError={false} />,
    )
    expect(container.querySelector('.auth-google-button')).toBeNull()
  })

  it('fits the form and updates the theme and signup label', async () => {
    const id = googleMock()
    const props = { theme: 'light', onToggleTheme: vi.fn(), onAuthenticated: vi.fn() }
    const { rerender } = render(<AuthScreen {...props} />)
    expect(id.renderButton).toHaveBeenLastCalledWith(expect.any(HTMLElement), expect.objectContaining({ width: 358, theme: 'outline', text: 'signin_with' }))
    await userEvent.click(screen.getByRole('button', { name: /create an account/i }))
    rerender(<AuthScreen {...props} theme="dark" />)
    expect(id.renderButton).toHaveBeenLastCalledWith(expect.any(HTMLElement), expect.objectContaining({ theme: 'filled_black', text: 'signup_with' }))
  })

  it('exchanges the Google credential and establishes the app session', async () => {
    const id = googleMock()
    const fetchMock = mockApi({ '/api/auth/google/': { user } })
    const { onAuthenticated } = renderScreen()
    await act(async () => id.initialize.mock.calls[0][0].callback({ credential: 'google-id-token' }))
    expect(onAuthenticated).toHaveBeenCalledWith(user)
    const [, init] = expectRequest(fetchMock, '/api/auth/google/', 'POST')
    expect(init.credentials).toBe('include')
    expect(JSON.parse(init.body).credential).toBe('google-id-token')
  })

  it('shows Google verification errors without authenticating', async () => {
    const id = googleMock()
    mockApi({ '/api/auth/google/': { status: 401, body: { error: 'Google sign-in could not be verified.' } } })
    const { onAuthenticated } = renderScreen()
    await act(async () => id.initialize.mock.calls[0][0].callback({ credential: 'invalid-token' }))
    expect(screen.getByText('Google sign-in could not be verified.')).toBeInTheDocument()
    expect(onAuthenticated).not.toHaveBeenCalled()
  })

  it('reuses the script in StrictMode and allows retry after a load failure', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id')
    vi.stubGlobal('google', undefined)
    // Keep Google's script inert; this test dispatches its load/error events.
    const appendChild = document.head.appendChild.bind(document.head)
    vi.spyOn(document.head, 'appendChild').mockImplementation(node => {
      if (node.tagName === 'SCRIPT') node.type = 'application/json'
      return appendChild(node)
    })
    render(<StrictMode><AuthScreen theme="light" onAuthenticated={vi.fn()} /></StrictMode>)
    const selector = 'script[src="https://accounts.google.com/gsi/client"]'
    expect(document.querySelectorAll(selector)).toHaveLength(1)
    fireEvent.error(document.querySelector(selector))
    expect(screen.getByRole('alert')).toHaveTextContent('Google sign-in could not load')
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    const id = googleMock()
    fireEvent.load(document.querySelector(selector))
    expect(id.initialize).toHaveBeenCalledTimes(1)
    expect(id.renderButton).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
