import {
  visualNovelLimits,
  visualNovelProtocolVersion,
} from "../../config/visualNovel";
import type {
  VisualNovelHistoryEntry,
  VisualNovelManifest,
  VisualNovelSessionState,
  VisualNovelValue,
} from "../../models/visualNovel";
import {
  isId,
  isRecord,
  isRevision,
  isValue,
  utf8ByteLength,
} from "./validationUtils";

export { validateAssetPath, validateStory } from "./validateStory";

export type ValidationResult<T> =
  | { ok: true; value: T; warnings: string[] }
  | { ok: false; errors: string[]; warnings: string[] };

const historyEntry = (
  input: unknown,
  index: number,
  errors: string[],
): VisualNovelHistoryEntry | null => {
  if (
    !isRecord(input) ||
    !isRevision(input.revision) ||
    !isId(input.sceneId) ||
    !isId(input.dialogueEntryId) ||
    (input.choiceId !== undefined && !isId(input.choiceId))
  ) {
    errors.push(`history[${index}] is invalid`);
    return null;
  }
  return {
    revision: input.revision,
    sceneId: input.sceneId,
    dialogueEntryId: input.dialogueEntryId,
    ...(isId(input.choiceId) ? { choiceId: input.choiceId } : {}),
  };
};

export const validateSessionState = (
  input: unknown,
  story?: VisualNovelManifest,
): ValidationResult<VisualNovelSessionState> => {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!isRecord(input)) {
    return { ok: false, errors: ["State must be an object"], warnings };
  }
  if (input.protocolVersion !== visualNovelProtocolVersion) {
    errors.push("Unsupported state protocol");
  }
  for (const key of [
    "storyId",
    "storyVersion",
    "sessionId",
    "sceneId",
    "dialogueEntryId",
    "controllerPeerId",
  ] as const) {
    if (!isId(input[key])) errors.push(`Invalid state.${key}`);
  }
  if (!isRevision(input.revision)) errors.push("Invalid state.revision");
  if (
    typeof input.updatedAt !== "number" ||
    !Number.isFinite(input.updatedAt)
  ) {
    errors.push("Invalid state.updatedAt");
  }

  const variables: Record<string, VisualNovelValue> = {};
  if (!isRecord(input.variables)) {
    errors.push("Invalid state.variables");
  } else if (
    Object.keys(input.variables).length > visualNovelLimits.maxVariables
  ) {
    errors.push("Too many variables");
  } else {
    Object.entries(input.variables).forEach(([key, value]) => {
      if (!isId(key) || !isValue(value)) {
        errors.push(`Invalid variable ${key}`);
      } else {
        variables[key] = value;
      }
    });
  }

  const history: VisualNovelHistoryEntry[] = [];
  if (!Array.isArray(input.history)) {
    errors.push("Invalid state.history");
  } else if (input.history.length > visualNovelLimits.maxHistoryEntries) {
    errors.push("State history exceeds the limit");
  } else {
    input.history.forEach((item, index) => {
      const normalized = historyEntry(item, index, errors);
      if (normalized) history.push(normalized);
    });
    if (
      history.some(
        (item, index) =>
          index > 0 && item.revision <= history[index - 1].revision,
      )
    ) {
      errors.push("State history revisions must increase");
    }
  }

  if (story) {
    if (input.storyId !== story.id || input.storyVersion !== story.version) {
      errors.push("State story is incompatible");
    }
    const currentScene = isId(input.sceneId)
      ? story.scenes[input.sceneId]
      : undefined;
    if (!currentScene) {
      errors.push("State scene does not exist");
    } else if (
      isId(input.dialogueEntryId) &&
      !currentScene.dialogue.some((item) => item.id === input.dialogueEntryId)
    ) {
      errors.push("State dialogue entry does not exist");
    }
    history.forEach((item) => {
      const priorScene = story.scenes[item.sceneId];
      if (
        !priorScene ||
        !priorScene.dialogue.some((entry) => entry.id === item.dialogueEntryId)
      ) {
        errors.push("State history references an unknown entry");
      }
    });
  }

  if (
    utf8ByteLength({
      ...input,
      history: history.slice(-visualNovelLimits.maxSnapshotHistoryEntries),
    }) > visualNovelLimits.maxSnapshotBytes
  ) {
    errors.push("State snapshot is too large");
  }

  if (
    errors.length ||
    input.protocolVersion !== visualNovelProtocolVersion ||
    !isId(input.storyId) ||
    !isId(input.storyVersion) ||
    !isId(input.sessionId) ||
    !isId(input.sceneId) ||
    !isId(input.dialogueEntryId) ||
    !isId(input.controllerPeerId) ||
    !isRevision(input.revision) ||
    typeof input.updatedAt !== "number" ||
    !Number.isFinite(input.updatedAt)
  ) {
    return { ok: false, errors, warnings };
  }

  return {
    ok: true,
    value: {
      protocolVersion: visualNovelProtocolVersion,
      storyId: input.storyId,
      storyVersion: input.storyVersion,
      sessionId: input.sessionId,
      sceneId: input.sceneId,
      dialogueEntryId: input.dialogueEntryId,
      variables,
      history,
      controllerPeerId: input.controllerPeerId,
      revision: input.revision,
      updatedAt: input.updatedAt,
    },
    warnings,
  };
};

export const toSnapshotState = (
  state: VisualNovelSessionState,
): VisualNovelSessionState => ({
  ...state,
  variables: { ...state.variables },
  history: state.history
    .slice(-visualNovelLimits.maxSnapshotHistoryEntries)
    .map((item) => ({ ...item })),
});
