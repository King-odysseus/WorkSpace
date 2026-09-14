export const NOTIFICATION_SOUND_OPTIONS = [
  { value: 'chime', label: 'Chime', description: 'A soft two-note alert.' },
  { value: 'bell', label: 'Bell', description: 'A brighter bell with a longer tail.' },
  { value: 'pop', label: 'Pop', description: 'A short, quiet pop.' },
  { value: 'pulse', label: 'Pulse', description: 'Three quick neutral pulses.' },
]

let audioContext = null

function getAudioContext() {
  if (typeof window === 'undefined') return null
  const AudioContext = window.AudioContext || window.webkitAudioContext
  if (!AudioContext) return null
  if (!audioContext || audioContext.state === 'closed') audioContext = new AudioContext({ latencyHint: 'interactive' })
  return audioContext
}

async function resumeAudioContext(context) {
  if (!context) return false
  if (context.state === 'running') return true
  try {
    // Safari reports 'interrupted' as well as 'suspended', so checking for one
    // specific state leaves the context permanently silent after a phone call
    // or another interruption.
    await context.resume()
  } catch {
    return false
  }
  return context.state === 'running'
}

// Browsers only allow an AudioContext to start from a user gesture. Call this
// from the first pointer/key event so later notification polling can actually
// make a sound instead of hitting a suspended context.
export async function primeNotificationAudio() {
  return resumeAudioContext(getAudioContext())
}

function scheduleTone(context, { frequency, duration, type = 'sine', at = 0, level = 0.12, endFrequency }) {
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  const start = context.currentTime + at
  const end = start + duration
  oscillator.type = type
  oscillator.frequency.setValueAtTime(frequency, start)
  if (endFrequency) oscillator.frequency.exponentialRampToValueAtTime(endFrequency, end)
  gain.gain.setValueAtTime(level, start)
  gain.gain.exponentialRampToValueAtTime(0.001, end)
  oscillator.connect(gain)
  gain.connect(context.destination)
  oscillator.start(start)
  oscillator.stop(end + 0.02)
}

export async function playNotificationSound(name = 'chime', volume = 70) {
  const context = getAudioContext()
  const normalizedVolume = Math.max(0, Math.min(100, Number(volume) || 0)) / 100
  if (!context || normalizedVolume === 0) return false
  if (!(await resumeAudioContext(context))) return false

  if (name === 'bell') {
    scheduleTone(context, { frequency: 880, duration: 0.42, type: 'triangle', level: 0.10 * normalizedVolume })
    scheduleTone(context, { frequency: 1320, duration: 0.34, type: 'sine', at: 0.04, level: 0.05 * normalizedVolume })
  } else if (name === 'pop') {
    scheduleTone(context, { frequency: 620, endFrequency: 230, duration: 0.11, level: 0.16 * normalizedVolume })
  } else if (name === 'pulse') {
    ;[0, 0.13, 0.26].forEach(at => scheduleTone(context, { frequency: 560, duration: 0.07, type: 'square', at, level: 0.055 * normalizedVolume }))
  } else {
    scheduleTone(context, { frequency: 660, duration: 0.14, level: 0.12 * normalizedVolume })
    scheduleTone(context, { frequency: 880, duration: 0.18, at: 0.10, level: 0.10 * normalizedVolume })
  }
  return true
}
