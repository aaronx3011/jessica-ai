import { describe, it, expect, vi } from 'vitest'
import { playAudioFragment } from './audioService'

function base64Silence(samples: number): string {
  const bytes = new Uint8Array(new Int16Array(samples).buffer)
  return btoa(String.fromCharCode(...bytes))
}

function makeContext(now = 0) {
  const starts: number[] = []
  const ctx: any = {
    currentTime: now,
    state: 'running',
    destination: {},
    resume: vi.fn(async () => { ctx.state = 'running' }),
    createBuffer: vi.fn((_channels: number, length: number, sampleRate: number) => ({
      duration: length / sampleRate,
      getChannelData: vi.fn(() => new Float32Array(length)),
    })),
    createBufferSource: vi.fn(() => ({
      buffer: null,
      connect: vi.fn(),
      start: vi.fn((at: number) => { starts.push(at) }),
      stop: vi.fn(),
      disconnect: vi.fn(),
      onended: null,
    })),
  }
  return { ctx, starts }
}

const PERIOD_SAMPLES_50MS = 1200 // 0.05s at 24000 Hz

describe('playAudioFragment', () => {
  it('schedules at the queued time when on time (back-to-back buffering)', () => {
    const { ctx, starts } = makeContext(0)
    const nextStartTime = { current: 0 }

    playAudioFragment(ctx, base64Silence(PERIOD_SAMPLES_50MS), nextStartTime)
    playAudioFragment(ctx, base64Silence(PERIOD_SAMPLES_50MS), nextStartTime)

    expect(starts[0]).toBeCloseTo(0)
    expect(starts[1]).toBeCloseTo(0.05)
    expect(nextStartTime.current).toBeCloseTo(0.1)
  })

  it('resets to now+0.1s when the queue is behind real time', () => {
    const { ctx, starts } = makeContext(5)
    const nextStartTime = { current: 0 }

    playAudioFragment(ctx, base64Silence(PERIOD_SAMPLES_50MS), nextStartTime)

    expect(starts[0]).toBeCloseTo(5.1)
    expect(nextStartTime.current).toBeCloseTo(5.15)
  })

  it('clamps a backlog at least 2s ahead so audio resumes immediately', () => {
    const { ctx, starts } = makeContext(0)
    const nextStartTime = { current: 5 } // simulated backlog accumulated ahead of real time

    playAudioFragment(ctx, base64Silence(PERIOD_SAMPLES_50MS), nextStartTime)

    expect(starts[0]).toBeCloseTo(0.1)
    expect(nextStartTime.current).toBeCloseTo(0.15)
  })

  it('keeps the queue when it is only slightly ahead', () => {
    const { ctx, starts } = makeContext(0)
    const nextStartTime = { current: 0.3 } // 0.3s ahead, under the 2s clamp threshold

    playAudioFragment(ctx, base64Silence(PERIOD_SAMPLES_50MS), nextStartTime)

    expect(starts[0]).toBeCloseTo(0.3)
    expect(nextStartTime.current).toBeCloseTo(0.35)
  })

  it('resumes a suspended AudioContext before scheduling', () => {
    const { ctx, starts } = makeContext(2)
    ctx.state = 'suspended'
    const nextStartTime = { current: 0 }

    playAudioFragment(ctx, base64Silence(PERIOD_SAMPLES_50MS), nextStartTime)

    expect(ctx.resume).toHaveBeenCalled()
    expect(starts[0]).toBeCloseTo(2.1)
  })
})