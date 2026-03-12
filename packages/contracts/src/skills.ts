import { Option, Schema } from "effect";

import { TrimmedNonEmptyString } from "./baseSchemas";

export const SkillId = TrimmedNonEmptyString;
export type SkillId = typeof SkillId.Type;

export const SkillSearchPath = TrimmedNonEmptyString;
export type SkillSearchPath = typeof SkillSearchPath.Type;

export const SkillSearchPathList = Schema.Array(SkillSearchPath).pipe(
  Schema.withConstructorDefault(() => Option.some([])),
  Schema.withDecodingDefault(() => []),
);
export type SkillSearchPathList = typeof SkillSearchPathList.Type;

export const SkillIdList = Schema.Array(SkillId).pipe(
  Schema.withConstructorDefault(() => Option.some([])),
  Schema.withDecodingDefault(() => []),
);
export type SkillIdList = typeof SkillIdList.Type;

export const SkillReference = Schema.Struct({
  id: SkillId,
  name: TrimmedNonEmptyString,
  description: Schema.String,
  path: TrimmedNonEmptyString,
  system: Schema.Boolean,
});
export type SkillReference = typeof SkillReference.Type;

export const CodexSkillsListInput = Schema.Struct({
  homePath: Schema.optional(TrimmedNonEmptyString),
  skillPaths: Schema.optional(SkillSearchPathList),
  includeSystem: Schema.optional(Schema.Boolean),
});
export type CodexSkillsListInput = typeof CodexSkillsListInput.Type;

export const CodexSkillsListResult = Schema.Array(SkillReference);
export type CodexSkillsListResult = typeof CodexSkillsListResult.Type;
