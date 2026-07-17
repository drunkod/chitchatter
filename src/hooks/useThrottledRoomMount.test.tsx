import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import {
  BACKOFF_KEY,
  backoffMultiplier,
  backoffResetPeriod,
  baseBackoff,
  LAST_MOUNT_TIME_KEY,
  useThrottledRoomMount,
} from './useThrottledRoomMount'

let sessionStorageStore: Record<string, string> = {}

const mockSessionStorage = {
  getItem: vi.fn((key: string) => sessionStorageStore[key] || null),
  setItem: vi.fn((key: string, value: string) => {
    sessionStorageStore[key] = value
  }),
  clear: vi.fn(() => {
    sessionStorageStore = {}
  }),
}

const resetSessionStorageMock = (): void => {
  sessionStorageStore = {}
  mockSessionStorage.getItem.mockReset()
  mockSessionStorage.getItem.mockImplementation(
    (key: string) => sessionStorageStore[key] || null
  )
  mockSessionStorage.setItem.mockReset()
  mockSessionStorage.setItem.mockImplementation(
    (key: string, value: string) => {
      sessionStorageStore[key] = value
    }
  )
  mockSessionStorage.clear.mockReset()
  mockSessionStorage.clear.mockImplementation(() => {
    sessionStorageStore = {}
  })
}

Object.defineProperty(window, 'sessionStorage', {
  value: mockSessionStorage,
})

describe('useThrottledRoomMount', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetSessionStorageMock()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  test('allows immediate mount when no previous mount exists', () => {
    const { result } = renderHook(() => useThrottledRoomMount('room1'))

    expect(result.current).toBe(true)
    expect(mockSessionStorage.setItem).toHaveBeenCalledWith(
      'room-mount-throttle:last-mount-time',
      expect.any(String)
    )
    expect(mockSessionStorage.setItem).toHaveBeenCalledWith(BACKOFF_KEY, '0')
  })

  test('applies throttling when mounting within backoff reset period', () => {
    const baseTime = 1000000

    vi.setSystemTime(baseTime)

    mockSessionStorage.getItem
      .mockReturnValueOnce((baseTime - 1000).toString())
      .mockReturnValueOnce('0')

    const { result } = renderHook(() => useThrottledRoomMount('room1'))

    expect(result.current).toBe(false)
    expect(mockSessionStorage.setItem).toHaveBeenCalledWith(
      BACKOFF_KEY,
      String(baseBackoff)
    )

    act(() => {
      vi.advanceTimersByTime(baseBackoff)
    })

    expect(result.current).toBe(true)
  })

  test('resets backoff when sufficient time has passed', () => {
    const baseTime = 1000000

    vi.setSystemTime(baseTime)

    mockSessionStorage.getItem
      .mockReturnValueOnce((baseTime - baseBackoff * 3).toString())
      .mockReturnValueOnce(String(baseBackoff))

    const { result } = renderHook(() => useThrottledRoomMount('room1'))

    expect(result.current).toBe(true)
    expect(mockSessionStorage.setItem).toHaveBeenCalledWith(BACKOFF_KEY, '0')
  })

  test('multiplies backoff when mounting repeatedly within reset period', () => {
    const baseTime = 1000000

    vi.setSystemTime(baseTime)

    mockSessionStorage.getItem
      .mockReturnValueOnce(
        (baseTime - baseBackoff / backoffMultiplier).toString()
      )
      .mockReturnValueOnce(String(baseBackoff))

    const { result } = renderHook(() => useThrottledRoomMount('room1'))

    expect(result.current).toBe(false)
    expect(mockSessionStorage.setItem).toHaveBeenCalledWith(
      BACKOFF_KEY,
      String(baseBackoff * backoffMultiplier)
    )

    act(() => {
      vi.advanceTimersByTime(baseBackoff * backoffMultiplier)
    })

    expect(result.current).toBe(true)
  })

  test('continues multiplying backoff with each rapid mount attempt', () => {
    const baseTime = 1000000

    vi.setSystemTime(baseTime)

    mockSessionStorage.getItem
      .mockReturnValueOnce(
        (baseTime - baseBackoff / backoffMultiplier).toString()
      )
      .mockReturnValueOnce(String(baseBackoff * backoffMultiplier))

    const { result } = renderHook(() => useThrottledRoomMount('room1'))

    expect(result.current).toBe(false)
    expect(mockSessionStorage.setItem).toHaveBeenCalledWith(
      BACKOFF_KEY,
      String(baseBackoff * 4)
    )
  })

  test('handles invalid sessionStorage values gracefully', () => {
    mockSessionStorage.getItem
      .mockReturnValueOnce('invalid')
      .mockReturnValueOnce('not-a-number')

    const { result } = renderHook(() => useThrottledRoomMount('room1'))

    expect(result.current).toBe(true)
    expect(mockSessionStorage.setItem).toHaveBeenCalledWith(BACKOFF_KEY, '0')
  })

  test('handles null sessionStorage values gracefully', () => {
    mockSessionStorage.getItem.mockReturnValue(null)

    const { result } = renderHook(() => useThrottledRoomMount('room1'))

    expect(result.current).toBe(true)
    expect(mockSessionStorage.setItem).toHaveBeenCalledWith(BACKOFF_KEY, '0')
  })

  test('cleans up timeout on unmount', () => {
    const baseTime = 1000000

    vi.setSystemTime(baseTime)

    mockSessionStorage.getItem
      .mockReturnValueOnce(
        (baseTime - baseBackoff / backoffMultiplier).toString()
      )
      .mockReturnValueOnce('0')

    const { result, unmount } = renderHook(() => useThrottledRoomMount('room1'))

    expect(result.current).toBe(false)

    unmount()

    expect(result.current).toBe(false)
  })

  test('disables mounting until the backoff expires when roomId changes', () => {
    const baseTime = 1000000

    vi.setSystemTime(baseTime)

    const { result, rerender } = renderHook(
      ({ roomId }) => useThrottledRoomMount(roomId),
      { initialProps: { roomId: 'room1' } }
    )

    expect(result.current).toBe(true)

    rerender({ roomId: 'room2' })

    expect(result.current).toBe(false)
    expect(mockSessionStorage.setItem).toHaveBeenCalledWith(
      LAST_MOUNT_TIME_KEY,
      expect.any(String)
    )

    act(() => {
      vi.advanceTimersByTime(baseBackoff)
    })

    expect(result.current).toBe(true)
  })

  test('schedules backoff reset after successful mount', async () => {
    const { result } = renderHook(() => useThrottledRoomMount('room1'))

    expect(result.current).toBe(true)

    act(() => {
      vi.advanceTimersByTime(backoffResetPeriod)
    })

    expect(mockSessionStorage.setItem).toHaveBeenCalledWith(BACKOFF_KEY, '0')
  })

  test('uses correct sessionStorage keys', () => {
    renderHook(() => useThrottledRoomMount('room1'))

    expect(mockSessionStorage.getItem).toHaveBeenCalledWith(
      'room-mount-throttle:last-mount-time'
    )
    expect(mockSessionStorage.getItem).toHaveBeenCalledWith(BACKOFF_KEY)
    expect(mockSessionStorage.setItem).toHaveBeenCalledWith(
      'room-mount-throttle:last-mount-time',
      expect.any(String)
    )
    expect(mockSessionStorage.setItem).toHaveBeenCalledWith(
      BACKOFF_KEY,
      expect.any(String)
    )
  })

  test('correctly calculates time since last mount', () => {
    const baseTime = 1000000
    const lastMountTime = baseTime - 3000

    vi.setSystemTime(baseTime)

    mockSessionStorage.getItem
      .mockReturnValueOnce(lastMountTime.toString())
      .mockReturnValueOnce('0')

    renderHook(() => useThrottledRoomMount('room1'))

    expect(mockSessionStorage.setItem).toHaveBeenCalledWith(
      'room-mount-throttle:last-mount-time',
      baseTime.toString()
    )
  })

  test('handles concurrent timeout and cleanup properly', () => {
    const baseTime = 1000000
    const timePassed = 1000

    vi.setSystemTime(baseTime)

    mockSessionStorage.getItem
      .mockReturnValueOnce((baseTime - timePassed).toString())
      .mockReturnValueOnce('0')

    const { result, unmount } = renderHook(() => useThrottledRoomMount('room1'))

    expect(result.current).toBe(false)

    act(() => {
      vi.advanceTimersByTime(timePassed)
    })

    unmount()

    act(() => {
      vi.advanceTimersByTime(timePassed)
    })

    expect(result.current).toBe(false)
  })
})
