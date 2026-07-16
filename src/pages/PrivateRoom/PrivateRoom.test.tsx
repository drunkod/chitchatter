import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PropsWithChildren } from 'react'
import {
  MemoryRouter,
  Route,
  Routes,
  useNavigate,
} from 'react-router-dom'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { ShellContext, ShellContextProps } from 'contexts/ShellContext'

import { PrivateRoom } from './PrivateRoom'

const mocks = vi.hoisted(() => ({
  encodePassword: vi.fn(),
}))

vi.mock('components/Room', () => ({
  Room: ({ password, roomId }: { password?: string; roomId: string }) => (
    <div data-testid="room" data-password={password} data-room-id={roomId} />
  ),
}))

vi.mock('components/PasswordPrompt', () => ({
  PasswordPrompt: () => <div data-testid="password-prompt" />,
}))

vi.mock('components/Loading', () => ({
  WholePageLoading: () => <div data-testid="loading" />,
}))

vi.mock('components/Shell/constants', () => ({
  allowAdvancedRoomLinkSharing: true,
}))

vi.mock('hooks/useThrottledRoomMount', () => ({
  useThrottledRoomMount: () => true,
}))

vi.mock('services/Encryption', () => ({
  encryption: {
    encodePassword: mocks.encodePassword,
  },
}))

vi.mock('services/Notification', () => ({
  notification: {
    requestPermission: vi.fn(),
  },
}))

const NavigateToRoom = () => {
  const navigate = useNavigate()

  return <button onClick={() => navigate('/private/room-b')}>Next room</button>
}

const shellContextValue = {
  setTitle: vi.fn(),
} as unknown as ShellContextProps

const TestProviders = ({ children }: PropsWithChildren) => (
  <ShellContext.Provider value={shellContextValue}>
    {children}
  </ShellContext.Provider>
)

describe('PrivateRoom', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.history.replaceState(window.history.state, '', '#secret=secret-a')
  })

  test('keeps the parsed secret after clearing it from the address bar', async () => {
    render(
      <TestProviders>
        <MemoryRouter initialEntries={['/private/room-a']}>
          <Routes>
            <Route
              path="/private/:roomId"
              element={<PrivateRoom userId="user-id" />}
            />
          </Routes>
        </MemoryRouter>
      </TestProviders>
    )

    expect(await screen.findByTestId('room')).toHaveAttribute(
      'data-password',
      'secret-a'
    )
    expect(window.location.hash).toBe('')

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.getByTestId('room')).toHaveAttribute(
      'data-password',
      'secret-a'
    )
  })

  test('clears the previous secret when the room ID changes', async () => {
    render(
      <TestProviders>
        <MemoryRouter initialEntries={['/private/room-a']}>
          <NavigateToRoom />
          <Routes>
            <Route
              path="/private/:roomId"
              element={<PrivateRoom userId="user-id" />}
            />
          </Routes>
        </MemoryRouter>
      </TestProviders>
    )

    expect(await screen.findByTestId('room')).toHaveAttribute(
      'data-password',
      'secret-a'
    )

    await userEvent.click(screen.getByRole('button', { name: 'Next room' }))

    await waitFor(() => {
      expect(screen.getByTestId('password-prompt')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('room')).not.toBeInTheDocument()
  })
})
