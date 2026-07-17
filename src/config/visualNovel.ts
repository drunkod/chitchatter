export const visualNovelProtocolVersion = 1 as const

export const visualNovelLimits = {
  maxStoryBytes: 512 * 1024,
  maxEnvelopeBytes: 96 * 1024,
  maxSnapshotBytes: 80 * 1024,
  maxHistoryEntries: 256,
  maxSnapshotHistoryEntries: 32,
  maxVariables: 128,
  maxVariableValueLength: 256,
  maxScenes: 256,
  maxDialogueEntriesPerScene: 512,
  maxChoicesPerEntry: 16,
  maxCharactersPerScene: 16,
  maxAssets: 256,
  maxIdLength: 128,
  maxLabelLength: 256,
  maxTextLength: 8 * 1024,
  maxSeenActionIds: 1024,
  requestTimeoutMs: 10_000,
} as const

export const allowedVisualNovelAssetExtensions = new Set([
  '.avif',
  '.gif',
  '.jpeg',
  '.jpg',
  '.mp3',
  '.ogg',
  '.png',
  '.webp',
  '.wav',
])
