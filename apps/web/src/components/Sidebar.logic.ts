import type { Thread } from "../types";
import { findLatestProposedPlan, isLatestTurnSettled } from "../session-logic";

export const THREAD_SELECTION_SAFE_SELECTOR = "[data-thread-item], [data-thread-selection-safe]";

export interface ThreadStatusPill {
  label:
    | "Working"
    | "Connecting"
    | "Completed"
    | "Pending Approval"
    | "Awaiting Input"
    | "Plan Ready";
  colorClass: string;
  dotClass: string;
  pulse: boolean;
}

type ThreadStatusInput = Pick<
  Thread,
  "interactionMode" | "latestTurn" | "lastVisitedAt" | "proposedPlans" | "session"
>;

type ThreadSidebarOrderingInput = Pick<Thread, "id" | "createdAt" | "latestTurn" | "messages">;

function parseIsoOrNull(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? null : parsed;
}

export function hasUnseenCompletion(thread: ThreadStatusInput): boolean {
  if (!thread.latestTurn?.completedAt) return false;
  const completedAt = Date.parse(thread.latestTurn.completedAt);
  if (Number.isNaN(completedAt)) return false;
  if (!thread.lastVisitedAt) return true;

  const lastVisitedAt = Date.parse(thread.lastVisitedAt);
  if (Number.isNaN(lastVisitedAt)) return true;
  return completedAt > lastVisitedAt;
}

export function shouldClearThreadSelectionOnMouseDown(target: HTMLElement | null): boolean {
  if (target === null) return true;
  return !target.closest(THREAD_SELECTION_SAFE_SELECTOR);
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
      const leftPinned = left.pinned;
      const rightPinned = right.pinned;
      if (leftPinned !== rightPinned) {
        return leftPinned ? -1 : 1;
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

export function resolveThreadStatusPill(input: {
  thread: ThreadStatusInput;
  hasPendingApprovals: boolean;
  hasPendingUserInput: boolean;
}): ThreadStatusPill | null {
  const { hasPendingApprovals, hasPendingUserInput, thread } = input;

  if (hasPendingApprovals) {
    return {
      label: "Pending Approval",
      colorClass: "text-amber-600 dark:text-amber-300/90",
      dotClass: "bg-amber-500 dark:bg-amber-300/90",
      pulse: false,
    };
  }

  if (hasPendingUserInput) {
    return {
      label: "Awaiting Input",
      colorClass: "text-indigo-600 dark:text-indigo-300/90",
      dotClass: "bg-indigo-500 dark:bg-indigo-300/90",
      pulse: false,
    };
  }

  if (thread.session?.status === "running") {
    return {
      label: "Working",
      colorClass: "text-sky-600 dark:text-sky-300/80",
      dotClass: "bg-sky-500 dark:bg-sky-300/80",
      pulse: true,
    };
  }

  if (thread.session?.status === "connecting") {
    return {
      label: "Connecting",
      colorClass: "text-sky-600 dark:text-sky-300/80",
      dotClass: "bg-sky-500 dark:bg-sky-300/80",
      pulse: true,
    };
  }

  const hasPlanReadyPrompt =
    !hasPendingUserInput &&
    thread.interactionMode === "plan" &&
    isLatestTurnSettled(thread.latestTurn, thread.session) &&
    findLatestProposedPlan(thread.proposedPlans, thread.latestTurn?.turnId ?? null) !== null;
  if (hasPlanReadyPrompt) {
    return {
      label: "Plan Ready",
      colorClass: "text-violet-600 dark:text-violet-300/90",
      dotClass: "bg-violet-500 dark:bg-violet-300/90",
      pulse: false,
    };
  }

  if (hasUnseenCompletion(thread)) {
    return {
      label: "Completed",
      colorClass: "text-emerald-600 dark:text-emerald-300/90",
      dotClass: "bg-emerald-500 dark:bg-emerald-300/90",
      pulse: false,
    };
  }

  return null;
}
