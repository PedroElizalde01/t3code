import { type ChatMessage } from "./types";

export interface ComposerHistorySnapshot {
  value: string;
  cursor: number;
}

export interface ComposerHistoryState {
  index: number | null;
  draft: ComposerHistorySnapshot | null;
}

export const EMPTY_COMPOSER_HISTORY_STATE: ComposerHistoryState = {
  index: null,
  draft: null,
};

function clampCursor(value: string, cursor: number): number {
  if (!Number.isFinite(cursor)) {
    return value.length;
  }
  return Math.max(0, Math.min(value.length, Math.floor(cursor)));
}

function normalizeSnapshot(snapshot: ComposerHistorySnapshot): ComposerHistorySnapshot {
  return {
    value: snapshot.value,
    cursor: clampCursor(snapshot.value, snapshot.cursor),
  };
}

function normalizedHistoryEntrySnapshot(
  entries: readonly string[],
  index: number,
): ComposerHistorySnapshot {
  const value = entries[index] ?? "";
  return {
    value,
    cursor: value.length,
  };
}

function normalizeHistoryIndex(entries: readonly string[], index: number | null): number | null {
  if (index === null || entries.length === 0) {
    return null;
  }
  return Math.max(0, Math.min(entries.length - 1, index));
}

export function collectComposerHistoryEntries(messages: readonly ChatMessage[]): string[] {
  return messages.flatMap((message) => {
    if (message.role !== "user") {
      return [];
    }
    if (message.text.trim().length === 0) {
      return [];
    }
    return [message.text];
  });
}

export function isComposerHistoryBoundary(
  snapshot: ComposerHistorySnapshot,
  direction: "previous" | "next",
): boolean {
  const normalized = normalizeSnapshot(snapshot);
  if (direction === "previous") {
    return normalized.value.lastIndexOf("\n", Math.max(0, normalized.cursor - 1)) === -1;
  }
  return normalized.value.indexOf("\n", normalized.cursor) === -1;
}

export function navigateComposerHistory(input: {
  direction: "previous" | "next";
  entries: readonly string[];
  snapshot: ComposerHistorySnapshot;
  state: ComposerHistoryState;
}): {
  state: ComposerHistoryState;
  snapshot: ComposerHistorySnapshot;
} | null {
  const snapshot = normalizeSnapshot(input.snapshot);
  const currentIndex = normalizeHistoryIndex(input.entries, input.state.index);

  if (input.direction === "previous") {
    if (input.entries.length === 0) {
      return null;
    }
    if (currentIndex === null) {
      const nextIndex = input.entries.length - 1;
      return {
        state: {
          index: nextIndex,
          draft: snapshot,
        },
        snapshot: normalizedHistoryEntrySnapshot(input.entries, nextIndex),
      };
    }

    const nextIndex = Math.max(0, currentIndex - 1);
    return {
      state: {
        index: nextIndex,
        draft: input.state.draft ?? snapshot,
      },
      snapshot: normalizedHistoryEntrySnapshot(input.entries, nextIndex),
    };
  }

  if (currentIndex === null || input.entries.length === 0) {
    return null;
  }

  if (currentIndex >= input.entries.length - 1) {
    const draft = normalizeSnapshot(input.state.draft ?? { value: "", cursor: 0 });
    return {
      state: EMPTY_COMPOSER_HISTORY_STATE,
      snapshot: draft,
    };
  }

  const nextIndex = currentIndex + 1;
  return {
    state: {
      index: nextIndex,
      draft: input.state.draft,
    },
    snapshot: normalizedHistoryEntrySnapshot(input.entries, nextIndex),
  };
}
