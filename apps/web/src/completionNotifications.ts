import { ThreadId } from "@t3tools/contracts";
import { getModelOptions, normalizeModelSlug } from "@t3tools/shared/model";

import type { Thread } from "./types";
import { hasVisibleCompletedStatus } from "./threadStatus";

export interface CompletionNotificationSnapshot {
  threadId: ThreadId;
  title: string;
  model: string;
  provider: Thread["session"] extends infer T
    ? T extends { provider: infer Provider }
      ? Provider | null
      : null
    : null;
  turnId: Thread["latestTurn"] extends infer T
    ? T extends { turnId: infer TurnId }
      ? TurnId | null
      : null
    : null;
  completedAt: string | null;
  completedStatusVisible: boolean;
}

export interface CodexCompletionNotification {
  threadId: ThreadId;
  title: string;
  completedAt: string;
}

export interface CompletionNotificationSummary {
  title: string;
  body: string;
  threadId: ThreadId | null;
}

const CODEX_MODEL_SLUGS = new Set<string>(getModelOptions("codex").map((option) => option.slug));

export function buildCompletionNotificationSnapshot(
  threads: readonly Thread[],
): Map<ThreadId, CompletionNotificationSnapshot> {
  return new Map(
    threads.map((thread) => [
      thread.id,
      {
        threadId: thread.id,
        title: thread.title,
        model: thread.model,
        provider: thread.session?.provider ?? null,
        turnId: thread.latestTurn?.turnId ?? null,
        completedAt: thread.latestTurn?.completedAt ?? null,
        completedStatusVisible: hasVisibleCompletedStatus(thread),
      },
    ]),
  );
}

function isCodexSnapshot(snapshot: CompletionNotificationSnapshot): boolean {
  const normalizedModel = normalizeModelSlug(snapshot.model, "codex");
  return (
    snapshot.provider === "codex" ||
    (normalizedModel !== null && CODEX_MODEL_SLUGS.has(normalizedModel))
  );
}

export function detectNewCodexCompletions(
  previous: ReadonlyMap<ThreadId, CompletionNotificationSnapshot> | null,
  current: ReadonlyMap<ThreadId, CompletionNotificationSnapshot>,
): CodexCompletionNotification[] {
  if (previous === null) {
    return [];
  }

  const completions: CodexCompletionNotification[] = [];
  for (const [threadId, snapshot] of current) {
    if (
      !isCodexSnapshot(snapshot) ||
      snapshot.turnId === null ||
      snapshot.completedAt === null ||
      !snapshot.completedStatusVisible
    ) {
      continue;
    }

    const before = previous.get(threadId);
    if (!before) {
      continue;
    }

    const sameTurn = before.turnId === snapshot.turnId;
    const justBecameCompletedForCurrentTurn =
      sameTurn && !before.completedStatusVisible && snapshot.completedStatusVisible;
    const newlyVisibleCompletedDifferentTurn = !sameTurn;
    if (!justBecameCompletedForCurrentTurn && !newlyVisibleCompletedDifferentTurn) {
      continue;
    }

    completions.push({
      threadId,
      title: snapshot.title.trim(),
      completedAt: snapshot.completedAt,
    });
  }

  return completions.toSorted(
    (left, right) => Date.parse(right.completedAt) - Date.parse(left.completedAt),
  );
}

export function summarizeCodexCompletions(
  completions: readonly CodexCompletionNotification[],
): CompletionNotificationSummary | null {
  if (completions.length === 0) {
    return null;
  }

  const completion = completions[0];
  if (!completion) {
    return null;
  }

  if (completions.length === 1) {
    return {
      title: "Codex finished",
      body:
        completion.title.length > 0
          ? `Thread "${completion.title}" is ready.`
          : "Your latest Codex thread is ready.",
      threadId: completion.threadId,
    };
  }

  const firstTitle = completion.title;
  const remainingCount = completions.length - 1;
  return {
    title: `Codex finished ${completions.length} threads`,
    body:
      firstTitle && firstTitle.length > 0
        ? `"${firstTitle}" and ${remainingCount} more thread${remainingCount === 1 ? "" : "s"} are ready.`
        : `${completions.length} Codex threads are ready.`,
    threadId: null,
  };
}

let audioContextSingleton: AudioContext | null = null;

function focusNotificationWindow(): void {
  window.focus();
}

export async function playCompletionNotificationSound(): Promise<void> {
  if (typeof window === "undefined") {
    return;
  }

  const AudioContextCtor = window.AudioContext;
  if (!AudioContextCtor) {
    return;
  }

  const audioContext = (audioContextSingleton ??= new AudioContextCtor());
  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }

  const durationSeconds = 0.24;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const startAt = audioContext.currentTime;

  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(880, startAt);
  oscillator.frequency.exponentialRampToValueAtTime(660, startAt + durationSeconds);

  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(0.06, startAt + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + durationSeconds);

  oscillator.connect(gain);
  gain.connect(audioContext.destination);

  oscillator.start(startAt);
  oscillator.stop(startAt + durationSeconds);
}

export function showDesktopCompletionNotification(
  summary: CompletionNotificationSummary,
  onClick?: (threadId: ThreadId | null) => void,
): Notification | null {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") {
    return null;
  }

  const notification = new Notification(summary.title, {
    body: summary.body,
    silent: true,
    tag: summary.threadId ? `codex-finished:${summary.threadId}` : "codex-finished:multi",
  });

  let handledClick = false;

  notification.addEventListener("click", (event) => {
    if (handledClick) {
      return;
    }
    handledClick = true;
    event.preventDefault();
    notification.close();
    onClick?.(summary.threadId);
    focusNotificationWindow();
    window.setTimeout(focusNotificationWindow, 0);
  });

  return notification;
}
