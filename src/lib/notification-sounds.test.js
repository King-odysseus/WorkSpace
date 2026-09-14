import { afterEach, expect, it, vi } from 'vitest'
import { playNotificationSound } from './notification-sounds.js'

afterEach(() => {
  delete window.AudioContext
  delete window.webkitAudioContext
})

it('schedules the selected tone at the requested volume', async () => {
  const oscillators = []
  const gains = []
  let context
  class FakeAudioContext {
    constructor() {
      context = this
      this.state = 'running'
      this.currentTime = 0
      this.destination = {}
    }

    createOscillator() {
      const oscillator = {
        type: 'sine',
        frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      }
      oscillators.push(oscillator)
      return oscillator
    }

    createGain() {
      const gain = {
        gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: vi.fn(),
      }
      gains.push(gain)
      return gain
    }

    resume = vi.fn(async () => { this.state = 'running' })
  }
  window.AudioContext = FakeAudioContext

  await playNotificationSound('chime', 50)
  await playNotificationSound('bell', 50)
  await playNotificationSound('pop', 50)
  await playNotificationSound('pulse', 50)

  expect(oscillators).toHaveLength(8)
  expect(gains).toHaveLength(8)
  expect(gains[0].gain.setValueAtTime).toHaveBeenCalledWith(0.06, 0)
  expect(oscillators[2].frequency.setValueAtTime).toHaveBeenCalledWith(880, 0)

  context.state = 'interrupted'
  context.resume.mockClear()
  await expect(playNotificationSound('pop', 50)).resolves.toBe(true)
  expect(context.resume).toHaveBeenCalledOnce()

  await expect(playNotificationSound('bell', 0)).resolves.toBe(false)
})
