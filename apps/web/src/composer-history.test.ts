import { MessageId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  EMPTY_COMPOSER_HISTORY_STATE,
  collectComposerHistoryEntries,
  isComposerHistoryBoundary,
  navigateComposerHistory,
} from "./composer-history";
import { type ChatMessage } from "./types";

function makeMessage(input: { id: string; role: ChatMessage["role"]; text: string }): ChatMessage {
  return {
    id: MessageId.makeUnsafe(input.id),
    role: input.role,
    text: input.text,
    createdAt: "2026-03-09T00:00:00.000Z",
    streaming: false,
  };
}

describe("collectComposerHistoryEntries", () => {
  it("keeps only non-empty user messages in send order", () => {
    const messages: ChatMessage[] = [
      makeMessage({ id: "a", role: "assistant", text: "ignored" }),
      makeMessage({ id: "b", role: "user", text: "first" }),
      makeMessage({ id: "c", role: "user", text: "   " }),
      makeMessage({ id: "d", role: "user", text: "second\nline" }),
    ];

    expect(collectComposerHistoryEntries(messages)).toEqual(["first", "second\nline"]);
  });
});

describe("isComposerHistoryBoundary", () => {
  it("only treats ArrowUp as history navigation on the first line", () => {
    expect(isComposerHistoryBoundary({ value: "one\ntwo", cursor: 2 }, "previous")).toBe(true);
    expect(isComposerHistoryBoundary({ value: "one\ntwo", cursor: 5 }, "previous")).toBe(false);
  });

  it("only treats ArrowDown as history navigation on the last line", () => {
    expect(isComposerHistoryBoundary({ value: "one\ntwo", cursor: 0 }, "next")).toBe(false);
    expect(isComposerHistoryBoundary({ value: "one\ntwo", cursor: 5 }, "next")).toBe(true);
  });
});

describe("navigateComposerHistory", () => {
  const entries = ["first", "second", "third"] as const;

  it("starts from the newest entry and stores the current draft", () => {
    const result = navigateComposerHistory({
      direction: "previous",
      entries,
      snapshot: { value: "draft", cursor: 2 },
      state: EMPTY_COMPOSER_HISTORY_STATE,
    });

    expect(result).toEqual({
      state: {
        index: 2,
        draft: {
          value: "draft",
          cursor: 2,
        },
      },
      snapshot: {
        value: "third",
        cursor: 5,
      },
    });
  });

  it("walks backward through older entries", () => {
    const result = navigateComposerHistory({
      direction: "previous",
      entries,
      snapshot: { value: "third", cursor: 5 },
      state: {
        index: 2,
        draft: {
          value: "",
          cursor: 0,
        },
      },
    });

    expect(result).toEqual({
      state: {
        index: 1,
        draft: {
          value: "",
          cursor: 0,
        },
      },
      snapshot: {
        value: "second",
        cursor: 6,
      },
    });
  });

  it("restores the saved draft after moving past the newest entry", () => {
    const result = navigateComposerHistory({
      direction: "next",
      entries,
      snapshot: { value: "third", cursor: 5 },
      state: {
        index: 2,
        draft: {
          value: "draft",
          cursor: 3,
        },
      },
    });

    expect(result).toEqual({
      state: EMPTY_COMPOSER_HISTORY_STATE,
      snapshot: {
        value: "draft",
        cursor: 3,
      },
    });
  });

  it("returns null when there is no history to navigate", () => {
    expect(
      navigateComposerHistory({
        direction: "previous",
        entries: [],
        snapshot: { value: "", cursor: 0 },
        state: EMPTY_COMPOSER_HISTORY_STATE,
      }),
    ).toBeNull();
    expect(
      navigateComposerHistory({
        direction: "next",
        entries,
        snapshot: { value: "", cursor: 0 },
        state: EMPTY_COMPOSER_HISTORY_STATE,
      }),
    ).toBeNull();
  });
});
