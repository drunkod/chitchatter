import { visualNovelLimits } from "../../config/visualNovel";
import type { VisualNovelValue } from "../../models/visualNovel";

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const isString = (
  value: unknown,
  maxLength: number,
  allowEmpty = false,
): value is string =>
  typeof value === "string" &&
  (allowEmpty || value.length > 0) &&
  value.length <= maxLength;

export const isId = (value: unknown): value is string =>
  isString(value, visualNovelLimits.maxIdLength) &&
  /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);

export const isVersion = (value: unknown): value is string =>
  isString(value, visualNovelLimits.maxIdLength) &&
  /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(value);

export const isRevision = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;

export const isValue = (value: unknown): value is VisualNovelValue =>
  (typeof value === "string" &&
    value.length <= visualNovelLimits.maxVariableValueLength) ||
  typeof value === "boolean" ||
  (typeof value === "number" && Number.isFinite(value));

export const utf8ByteLength = (value: unknown) => {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
};
