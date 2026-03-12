import type { Thread } from "../types";

export { hasUnseenCompletion, resolveThreadStatusPill } from "../threadStatus";

export const THREAD_SELECTION_SAFE_SELECTOR = "[data-thread-item], [data-thread-selection-safe]";

type ThreadSidebarOrderingInput = Pick<Thread, "id" | "createdAt" | "latestTurn" | "messages">;

function parseIsoOrNull(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? null : parsed;
}

export function resolveThreadLastChattedAt(thread: ThreadSidebarOrderingInput): string {
  const latestTurnRequestedAt = parseIsoOrNull(thread.latestTurn?.requestedAt);
  if (latestTurnRequestedAt !== null) {
    return new Date(latestTurnRequestedAt).toISOString();
  }

  const latestTurnCompletedAt = parseIsoOrNull(thread.latestTurn?.completedAt);
  if (latestTurnCompletedAt !== null) {
    return new Date(latestTurnCompletedAt).toISOString();
  }

  for (let index = thread.messages.length - 1; index >= 0; index -= 1) {
    const message = thread.messages[index];
    if (!message || (message.role !== "user" && message.role !== "assistant")) {
      continue;
    }

    const completedAt = parseIsoOrNull(message.completedAt);
    if (completedAt !== null) {
      return new Date(completedAt).toISOString();
    }

    const createdAt = parseIsoOrNull(message.createdAt);
    if (createdAt !== null) {
      return new Date(createdAt).toISOString();
    }
  }

  const createdAt = parseIsoOrNull(thread.createdAt);
  return createdAt !== null ? new Date(createdAt).toISOString() : thread.createdAt;
}

export function orderThreadsForSidebar<T extends ThreadSidebarOrderingInput>(
  threads: readonly T[],
  pinnedThreadIds: ReadonlySet<Thread["id"]>,
): T[] {
  return threads
    .map((thread) => ({
      thread,
      pinned: pinnedThreadIds.has(thread.id),
      lastChattedAtMs: Date.parse(resolveThreadLastChattedAt(thread)),
      createdAtMs: Date.parse(thread.createdAt),
    }))
    .toSorted((left, right) => {
      if (left.pinned !== right.pinned) {
        return left.pinned ? -1 : 1;
      }

      const byLastChattedAt = right.lastChattedAtMs - left.lastChattedAtMs;
      if (!Number.isNaN(byLastChattedAt) && byLastChattedAt !== 0) {
        return byLastChattedAt;
      }

      const byCreatedAt = right.createdAtMs - left.createdAtMs;
      if (!Number.isNaN(byCreatedAt) && byCreatedAt !== 0) {
        return byCreatedAt;
      }

      return right.thread.id.localeCompare(left.thread.id);
    })
    .map((entry) => entry.thread);
}

export function shouldClearThreadSelectionOnMouseDown(target: HTMLElement | null): boolean {
  if (target === null) return true;
  return !target.closest(THREAD_SELECTION_SAFE_SELECTOR);
}
