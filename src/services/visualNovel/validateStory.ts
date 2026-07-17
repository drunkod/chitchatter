import {
  allowedVisualNovelAssetExtensions,
  visualNovelLimits,
} from "../../config/visualNovel";
import type {
  VisualNovelCharacterPlacement,
  VisualNovelChoice,
  VisualNovelCondition,
  VisualNovelDialogueEntry,
  VisualNovelEffect,
  VisualNovelManifest,
  VisualNovelScene,
  VisualNovelTransition,
} from "../../models/visualNovel";
import type { ValidationResult } from "./VisualNovelValidator";
import {
  isId,
  isRecord,
  isString,
  isValue,
  isVersion,
  utf8ByteLength,
} from "./validationUtils";

const operators = new Set<VisualNovelCondition["operator"]>([
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
]);

export const validateAssetPath = (
  input: unknown,
  applicationOrigin: string,
): ValidationResult<string> => {
  const warnings: string[] = [];
  if (!isString(input, 1024)) {
    return { ok: false, errors: ["Invalid asset path"], warnings };
  }
  if (input.includes("..") || input.startsWith("//")) {
    return {
      ok: false,
      errors: ["Asset path escapes its story root"],
      warnings,
    };
  }
  try {
    const expectedOrigin = new URL(applicationOrigin).origin;
    const url = new URL(input, expectedOrigin);
    const extension = url.pathname
      .slice(url.pathname.lastIndexOf("."))
      .toLowerCase();
    if (url.origin !== expectedOrigin) {
      return {
        ok: false,
        errors: ["Cross-origin story assets are disabled"],
        warnings,
      };
    }
    if (!allowedVisualNovelAssetExtensions.has(extension)) {
      return {
        ok: false,
        errors: ["Unsupported asset extension"],
        warnings,
      };
    }
    return { ok: true, value: input, warnings };
  } catch {
    return { ok: false, errors: ["Malformed asset URL"], warnings };
  }
};

const placement = (
  input: unknown,
  path: string,
  errors: string[],
): VisualNovelCharacterPlacement | null => {
  if (!isRecord(input)) {
    errors.push(`${path} must be an object`);
    return null;
  }
  if (
    !isId(input.characterId) ||
    !isId(input.sprite) ||
    !["left", "center", "right"].includes(String(input.position)) ||
    (input.expression !== undefined && !isId(input.expression))
  ) {
    errors.push(`${path} is invalid`);
    return null;
  }
  return {
    characterId: input.characterId,
    sprite: input.sprite,
    position: input.position as VisualNovelCharacterPlacement["position"],
    ...(isId(input.expression) ? { expression: input.expression } : {}),
  };
};

const condition = (
  input: unknown,
  path: string,
  errors: string[],
): VisualNovelCondition | null => {
  if (
    !isRecord(input) ||
    !isId(input.variable) ||
    !operators.has(input.operator as VisualNovelCondition["operator"]) ||
    !isValue(input.value)
  ) {
    errors.push(`${path} is invalid`);
    return null;
  }
  return {
    variable: input.variable,
    operator: input.operator as VisualNovelCondition["operator"],
    value: input.value,
  };
};

const effect = (
  input: unknown,
  path: string,
  errors: string[],
): VisualNovelEffect | null => {
  if (!isRecord(input) || !isId(input.variable)) {
    errors.push(`${path} is invalid`);
    return null;
  }
  if (input.type === "set" && isValue(input.value)) {
    return { type: "set", variable: input.variable, value: input.value };
  }
  if (
    input.type === "increment" &&
    typeof input.amount === "number" &&
    Number.isFinite(input.amount)
  ) {
    return {
      type: "increment",
      variable: input.variable,
      amount: input.amount,
    };
  }
  errors.push(`${path} is invalid`);
  return null;
};

const transition = (
  input: unknown,
  path: string,
  errors: string[],
): VisualNovelTransition | null => {
  if (!isRecord(input)) {
    errors.push(`${path} is invalid`);
    return null;
  }
  const sceneId = isId(input.sceneId) ? input.sceneId : undefined;
  const dialogueEntryId = isId(input.dialogueEntryId)
    ? input.dialogueEntryId
    : undefined;
  if (!sceneId && !dialogueEntryId) {
    errors.push(`${path} must select a scene or entry`);
    return null;
  }
  return {
    ...(sceneId ? { sceneId } : {}),
    ...(dialogueEntryId ? { dialogueEntryId } : {}),
  };
};

const choice = (
  input: unknown,
  path: string,
  errors: string[],
): VisualNovelChoice | null => {
  if (
    !isRecord(input) ||
    !isId(input.id) ||
    !isString(input.label, visualNovelLimits.maxLabelLength) ||
    !isId(input.nextSceneId)
  ) {
    errors.push(`${path} is invalid`);
    return null;
  }
  const conditions = Array.isArray(input.conditions)
    ? input.conditions
        .map((item, index) =>
          condition(item, `${path}.conditions[${index}]`, errors),
        )
        .filter((item): item is VisualNovelCondition => item !== null)
    : [];
  const effects = Array.isArray(input.effects)
    ? input.effects
        .map((item, index) => effect(item, `${path}.effects[${index}]`, errors))
        .filter((item): item is VisualNovelEffect => item !== null)
    : [];
  if (input.conditions !== undefined && !Array.isArray(input.conditions)) {
    errors.push(`${path}.conditions must be an array`);
  }
  if (input.effects !== undefined && !Array.isArray(input.effects)) {
    errors.push(`${path}.effects must be an array`);
  }
  return {
    id: input.id,
    label: input.label,
    nextSceneId: input.nextSceneId,
    ...(input.conditions !== undefined ? { conditions } : {}),
    ...(input.effects !== undefined ? { effects } : {}),
  };
};

const entry = (
  input: unknown,
  path: string,
  errors: string[],
): VisualNovelDialogueEntry | null => {
  if (
    !isRecord(input) ||
    !isId(input.id) ||
    !isString(input.text, visualNovelLimits.maxTextLength)
  ) {
    errors.push(`${path} is invalid`);
    return null;
  }
  if (input.speaker !== undefined && !isString(input.speaker, 256)) {
    errors.push(`${path}.speaker is invalid`);
  }
  const choices = Array.isArray(input.choices)
    ? input.choices
        .slice(0, visualNovelLimits.maxChoicesPerEntry + 1)
        .map((item, index) => choice(item, `${path}.choices[${index}]`, errors))
        .filter((item): item is VisualNovelChoice => item !== null)
    : [];
  if (choices.length > visualNovelLimits.maxChoicesPerEntry) {
    errors.push(`${path}.choices exceeds the limit`);
  }
  const characterChanges = Array.isArray(input.characterChanges)
    ? input.characterChanges
        .map((item, index) =>
          placement(item, `${path}.characterChanges[${index}]`, errors),
        )
        .filter((item): item is VisualNovelCharacterPlacement => item !== null)
    : [];
  const next =
    input.next === undefined
      ? undefined
      : (transition(input.next, `${path}.next`, errors) ?? undefined);
  return {
    id: input.id,
    ...(isString(input.speaker, 256) ? { speaker: input.speaker } : {}),
    text: input.text,
    ...(isId(input.portrait) ? { portrait: input.portrait } : {}),
    ...(input.characterChanges !== undefined ? { characterChanges } : {}),
    ...(isId(input.soundEffect) ? { soundEffect: input.soundEffect } : {}),
    ...(next ? { next } : {}),
    ...(input.choices !== undefined ? { choices } : {}),
  };
};

const scene = (
  input: unknown,
  path: string,
  errors: string[],
): VisualNovelScene | null => {
  if (!isRecord(input) || !isId(input.id) || !Array.isArray(input.dialogue)) {
    errors.push(`${path} is invalid`);
    return null;
  }
  if (
    input.dialogue.length === 0 ||
    input.dialogue.length > visualNovelLimits.maxDialogueEntriesPerScene
  ) {
    errors.push(`${path}.dialogue has an invalid length`);
  }
  const dialogue = input.dialogue
    .map((item, index) => entry(item, `${path}.dialogue[${index}]`, errors))
    .filter((item): item is VisualNovelDialogueEntry => item !== null);
  if (
    Array.isArray(input.characters) &&
    input.characters.length > visualNovelLimits.maxCharactersPerScene
  ) {
    errors.push(`${path}.characters exceeds the limit`);
  }
  const characters = Array.isArray(input.characters)
    ? input.characters
        .slice(0, visualNovelLimits.maxCharactersPerScene + 1)
        .map((item, index) =>
          placement(item, `${path}.characters[${index}]`, errors),
        )
        .filter((item): item is VisualNovelCharacterPlacement => item !== null)
    : [];
  return {
    id: input.id,
    ...(isId(input.background) ? { background: input.background } : {}),
    ...(isId(input.music) ? { music: input.music } : {}),
    ...(input.characters !== undefined ? { characters } : {}),
    dialogue,
  };
};

export const validateStory = (
  input: unknown,
  applicationOrigin: string,
): ValidationResult<VisualNovelManifest> => {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (utf8ByteLength(input) > visualNovelLimits.maxStoryBytes) {
    return { ok: false, errors: ["Story is too large"], warnings };
  }
  if (!isRecord(input)) {
    return { ok: false, errors: ["Story must be an object"], warnings };
  }
  if (!isId(input.id)) errors.push("Invalid story.id");
  if (!isVersion(input.version)) errors.push("Invalid story.version");
  if (!isString(input.title, visualNovelLimits.maxLabelLength)) {
    errors.push("Invalid story.title");
  }
  if (!isId(input.startSceneId)) errors.push("Invalid story.startSceneId");

  const assets: Record<string, string> = {};
  if (isRecord(input.assets)) {
    if (Object.keys(input.assets).length > visualNovelLimits.maxAssets) {
      errors.push("Story has too many assets");
    }
    Object.entries(input.assets)
      .slice(0, visualNovelLimits.maxAssets + 1)
      .forEach(([assetId, assetPath]) => {
        const result = validateAssetPath(assetPath, applicationOrigin);
        if (!isId(assetId) || !result.ok) {
          errors.push(`Invalid asset: ${assetId}`);
        } else {
          assets[assetId] = result.value;
        }
      });
  } else if (input.assets !== undefined) {
    errors.push("Invalid story.assets");
  }

  const scenes: Record<string, VisualNovelScene> = {};
  if (!isRecord(input.scenes)) {
    errors.push("Invalid story.scenes");
  } else if (
    Object.keys(input.scenes).length === 0 ||
    Object.keys(input.scenes).length > visualNovelLimits.maxScenes
  ) {
    errors.push("Story has an invalid scene count");
  } else {
    Object.entries(input.scenes).forEach(([sceneId, value]) => {
      const normalized = scene(value, `scenes.${sceneId}`, errors);
      if (normalized?.id !== sceneId) {
        errors.push(`Scene key ${sceneId} does not match scene.id`);
      } else if (normalized) {
        scenes[sceneId] = normalized;
      }
    });
  }

  const entryIds = new Set<string>();
  const choiceIds = new Set<string>();
  const assetIds = new Set(Object.keys(assets));
  Object.values(scenes).forEach((currentScene) => {
    for (const assetId of [currentScene.background, currentScene.music]) {
      if (assetId && !assetIds.has(assetId)) {
        errors.push(
          `Scene ${currentScene.id} references unknown asset ${assetId}`,
        );
      }
    }
    currentScene.characters?.forEach((character) => {
      if (!assetIds.has(character.sprite)) {
        errors.push(
          `Scene ${currentScene.id} references unknown sprite ${character.sprite}`,
        );
      }
    });
    currentScene.dialogue.forEach((currentEntry) => {
      for (const assetId of [currentEntry.portrait, currentEntry.soundEffect]) {
        if (assetId && !assetIds.has(assetId)) {
          errors.push(
            `Entry ${currentEntry.id} references unknown asset ${assetId}`,
          );
        }
      }
      currentEntry.characterChanges?.forEach((character) => {
        if (!assetIds.has(character.sprite)) {
          errors.push(
            `Entry ${currentEntry.id} references unknown sprite ${character.sprite}`,
          );
        }
      });
      if (entryIds.has(currentEntry.id)) {
        errors.push(`Duplicate dialogue id: ${currentEntry.id}`);
      }
      entryIds.add(currentEntry.id);
      currentEntry.choices?.forEach((currentChoice) => {
        if (choiceIds.has(currentChoice.id)) {
          errors.push(`Duplicate choice id: ${currentChoice.id}`);
        }
        choiceIds.add(currentChoice.id);
        if (!scenes[currentChoice.nextSceneId]) {
          errors.push(`Choice ${currentChoice.id} targets unknown scene`);
        }
      });
      if (
        currentEntry.choices?.length &&
        currentEntry.choices.every((item) => item.conditions?.length) &&
        !currentEntry.next
      ) {
        warnings.push(
          `Entry ${currentEntry.id} may become a choice dead end at runtime`,
        );
      }
      if (currentEntry.next) {
        const targetScene = currentEntry.next.sceneId
          ? scenes[currentEntry.next.sceneId]
          : currentScene;
        if (!targetScene) {
          errors.push(`Entry ${currentEntry.id} targets unknown scene`);
        } else if (
          currentEntry.next.dialogueEntryId &&
          !targetScene.dialogue.some(
            (item) => item.id === currentEntry.next?.dialogueEntryId,
          )
        ) {
          errors.push(
            `Entry ${currentEntry.id} targets unknown dialogue entry`,
          );
        }
      }
    });
  });

  if (isId(input.startSceneId) && !scenes[input.startSceneId]) {
    errors.push("Start scene does not exist");
  }
  if (
    errors.length ||
    !isId(input.id) ||
    !isVersion(input.version) ||
    !isString(input.title, visualNovelLimits.maxLabelLength) ||
    !isId(input.startSceneId)
  ) {
    return { ok: false, errors, warnings };
  }
  return {
    ok: true,
    value: {
      id: input.id,
      version: input.version,
      title: input.title,
      ...(isString(input.description, visualNovelLimits.maxTextLength, true)
        ? { description: input.description }
        : {}),
      startSceneId: input.startSceneId,
      ...(input.assets !== undefined ? { assets } : {}),
      scenes,
    },
    warnings,
  };
};
