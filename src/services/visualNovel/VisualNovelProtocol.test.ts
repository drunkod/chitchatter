import { getBundledStory } from '../../stories/catalog'

import { VisualNovelEngine } from './VisualNovelEngine'
import { validateVisualNovelEnvelope } from './VisualNovelProtocol'

const resolveStory = getBundledStory

const bootstrapRequest = {
  protocol: 'visual-novel',
  protocolVersion: 1,
  actionId: 'request-1',
  actionType: 'STATE_REQUEST',
  senderPeerId: 'peer-a',
  sessionId: null,
  storyId: null,
  storyVersion: null,
  revision: -1,
  timestamp: 1000,
  payload: { knownRevision: -1, reason: 'join' },
}

describe('VisualNovelProtocol', () => {
  it('accepts a normalized bootstrap state request', () => {
    const result = validateVisualNovelEnvelope(
      { ...bootstrapRequest, ignored: 'field' },
      'peer-a',
      resolveStory
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).not.toHaveProperty('ignored')
    expect(result.value).toMatchObject(bootstrapRequest)
  })

  it('accepts a no-active-session bootstrap response', () => {
    const result = validateVisualNovelEnvelope(
      {
        ...bootstrapRequest,
        actionId: 'response-1',
        actionType: 'ERROR',
        payload: {
          code: 'NO_ACTIVE_SESSION',
          requestActionId: bootstrapRequest.actionId,
        },
      },
      'peer-a',
      resolveStory
    )

    expect(result).toMatchObject({ ok: true })
  })

  it('rejects sender identity mismatches', () => {
    const result = validateVisualNovelEnvelope(
      bootstrapRequest,
      'peer-b',
      resolveStory
    )

    expect(result).toMatchObject({ ok: false })
    if (result.ok) return
    expect(result.errors).toContain(
      'Envelope sender does not match transport peer'
    )
  })

  it('rejects null identity and revision -1 outside bootstrap requests', () => {
    const result = validateVisualNovelEnvelope(
      {
        ...bootstrapRequest,
        actionType: 'ADVANCE_REQUEST',
        payload: { expectedRevision: 0 },
      },
      'peer-a',
      resolveStory
    )

    expect(result).toMatchObject({ ok: false })
    if (result.ok) return
    expect(result.errors).toContain(
      'Only bootstrap messages may omit session identity'
    )
    expect(result.errors).toContain(
      'Only bootstrap messages may use revision -1'
    )
  })

  it('rejects malformed payloads and state/envelope identity mismatch', () => {
    const story = getBundledStory('harbour-lights', '1.0.0')

    expect(story).not.toBeNull()
    if (!story) return
    const state = new VisualNovelEngine(story, { now: () => 1000 }).start(
      'session-a',
      'peer-a'
    )

    const malformed = validateVisualNovelEnvelope(
      {
        ...bootstrapRequest,
        actionType: 'CHOICE_REQUEST',
        sessionId: state.sessionId,
        storyId: state.storyId,
        storyVersion: state.storyVersion,
        revision: state.revision,
        payload: { expectedRevision: 0 },
      },
      'peer-a',
      resolveStory
    )

    expect(malformed).toMatchObject({ ok: false })

    const mismatch = validateVisualNovelEnvelope(
      {
        ...bootstrapRequest,
        actionType: 'SESSION_STARTED',
        sessionId: 'different-session',
        storyId: state.storyId,
        storyVersion: state.storyVersion,
        revision: state.revision,
        payload: { state },
      },
      'peer-a',
      resolveStory
    )

    expect(mismatch).toMatchObject({ ok: false })
    if (mismatch.ok) return
    expect(mismatch.errors).toContain(
      'Envelope identity does not match its state'
    )
  })
})
