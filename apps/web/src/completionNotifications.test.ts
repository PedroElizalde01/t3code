import { ProjectId, ThreadId, TurnId } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildCompletionNotificationSnapshot,
  detectNewCodexCompletions,
  showDesktopCompletionNotification,
  summarizeCodexCompletions,
} from "./completionNotifications";
import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE, type Thread } from "./types";

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: ThreadId.makeUnsafe("thread-1"),
    codexThreadId: null,
    projectId: ProjectId.makeUnsafe("project-1"),
    title: "Thread One",
    model: "gpt-5.3-codex",
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    selectedSkillIds: [],
    session: {
      provider: "codex",
      status: "ready",
      createdAt: "2026-03-10T10:00:00.000Z",
      updatedAt: "2026-03-10T10:01:00.000Z",
      orchestrationStatus: "ready",
    },
    messages: [],
    turnDiffSummaries: [],
    activities: [],
    proposedPlans: [],
    error: null,
    createdAt: "2026-03-10T10:00:00.000Z",
    latestTurn: null,
    branch: null,
    worktreePath: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("detectNewCodexCompletions", () => {
  it("emits a completion when a codex thread gains a completed latest turn", () => {
    const previous = buildCompletionNotificationSnapshot([
      makeThread({
        latestTurn: {
          turnId: TurnId.makeUnsafe("turn-1"),
          state: "running",
          requestedAt: "2026-03-10T10:00:00.000Z",
          startedAt: "2026-03-10T10:00:01.000Z",
          completedAt: null,
          assistantMessageId: null,
        },
      }),
    ]);

    const current = buildCompletionNotificationSnapshot([
      makeThread({
        latestTurn: {
          turnId: TurnId.makeUnsafe("turn-1"),
          state: "completed",
          requestedAt: "2026-03-10T10:00:00.000Z",
          startedAt: "2026-03-10T10:00:01.000Z",
          completedAt: "2026-03-10T10:00:05.000Z",
          assistantMessageId: null,
        },
      }),
    ]);

    expect(detectNewCodexCompletions(previous, current)).toMatchObject([
      {
        threadId: ThreadId.makeUnsafe("thread-1"),
        title: "Thread One",
        completedAt: "2026-03-10T10:00:05.000Z",
      },
    ]);
  });

  it("ignores the initial snapshot", () => {
    const current = buildCompletionNotificationSnapshot([
      makeThread({
        latestTurn: {
          turnId: TurnId.makeUnsafe("turn-1"),
          state: "completed",
          requestedAt: "2026-03-10T10:00:00.000Z",
          startedAt: "2026-03-10T10:00:01.000Z",
          completedAt: "2026-03-10T10:00:05.000Z",
          assistantMessageId: null,
        },
      }),
    ]);

    expect(detectNewCodexCompletions(null, current)).toEqual([]);
  });

  it("ignores non-codex threads", () => {
    const previous = buildCompletionNotificationSnapshot([
      makeThread({
        model: "claude-opus-4-6",
        session: null,
      }),
    ]);
    const current = buildCompletionNotificationSnapshot([
      makeThread({
        model: "claude-opus-4-6",
        session: null,
        latestTurn: {
          turnId: TurnId.makeUnsafe("turn-2"),
          state: "completed",
          requestedAt: "2026-03-10T10:00:00.000Z",
          startedAt: "2026-03-10T10:00:01.000Z",
          completedAt: "2026-03-10T10:00:05.000Z",
          assistantMessageId: null,
        },
      }),
    ]);

    expect(detectNewCodexCompletions(previous, current)).toEqual([]);
  });

  it("does not notify twice when the same completed turn gets a later completedAt timestamp", () => {
    const previous = buildCompletionNotificationSnapshot([
      makeThread({
        latestTurn: {
          turnId: TurnId.makeUnsafe("turn-1"),
          state: "completed",
          requestedAt: "2026-03-10T10:00:00.000Z",
          startedAt: "2026-03-10T10:00:01.000Z",
          completedAt: "2026-03-10T10:00:05.000Z",
          assistantMessageId: null,
        },
      }),
    ]);

    const current = buildCompletionNotificationSnapshot([
      makeThread({
        latestTurn: {
          turnId: TurnId.makeUnsafe("turn-1"),
          state: "completed",
          requestedAt: "2026-03-10T10:00:00.000Z",
          startedAt: "2026-03-10T10:00:01.000Z",
          completedAt: "2026-03-10T10:00:06.000Z",
          assistantMessageId: null,
        },
      }),
    ]);

    expect(detectNewCodexCompletions(previous, current)).toEqual([]);
  });

  it("waits until the completed status becomes visible", () => {
    const completedTurn = {
      turnId: TurnId.makeUnsafe("turn-1"),
      state: "completed" as const,
      requestedAt: "2026-03-10T10:00:00.000Z",
      startedAt: "2026-03-10T10:00:01.000Z",
      completedAt: "2026-03-10T10:00:05.000Z",
      assistantMessageId: null,
    };

    const previous = buildCompletionNotificationSnapshot([
      makeThread({
        latestTurn: {
          ...completedTurn,
          completedAt: null,
          state: "running",
        },
        session: {
          provider: "codex",
          status: "running",
          createdAt: "2026-03-10T10:00:00.000Z",
          updatedAt: "2026-03-10T10:00:04.000Z",
          orchestrationStatus: "running",
        },
      }),
    ]);

    const completedButStillWorking = buildCompletionNotificationSnapshot([
      makeThread({
        latestTurn: completedTurn,
        session: {
          provider: "codex",
          status: "running",
          createdAt: "2026-03-10T10:00:00.000Z",
          updatedAt: "2026-03-10T10:00:05.000Z",
          orchestrationStatus: "running",
        },
      }),
    ]);

    expect(detectNewCodexCompletions(previous, completedButStillWorking)).toEqual([]);

    const completedAndVisible = buildCompletionNotificationSnapshot([
      makeThread({
        latestTurn: completedTurn,
      }),
    ]);

    expect(detectNewCodexCompletions(completedButStillWorking, completedAndVisible)).toMatchObject([
      {
        threadId: ThreadId.makeUnsafe("thread-1"),
        title: "Thread One",
        completedAt: "2026-03-10T10:00:05.000Z",
      },
    ]);
  });
});

describe("summarizeCodexCompletions", () => {
  it("formats a single-thread notification", () => {
    expect(
      summarizeCodexCompletions([
        {
          threadId: ThreadId.makeUnsafe("thread-1"),
          title: "Fix flaky test",
          completedAt: "2026-03-10T10:00:05.000Z",
        },
      ]),
    ).toEqual({
      title: "Codex finished",
      body: 'Thread "Fix flaky test" is ready.',
      threadId: ThreadId.makeUnsafe("thread-1"),
    });
  });

  it("formats a summary when multiple threads complete together", () => {
    expect(
      summarizeCodexCompletions([
        {
          threadId: ThreadId.makeUnsafe("thread-2"),
          title: "Second task",
          completedAt: "2026-03-10T10:00:06.000Z",
        },
        {
          threadId: ThreadId.makeUnsafe("thread-1"),
          title: "First task",
          completedAt: "2026-03-10T10:00:05.000Z",
        },
      ]),
    ).toEqual({
      title: "Codex finished 2 threads",
      body: '"Second task" and 1 more thread are ready.',
      threadId: null,
    });
  });
});

describe("showDesktopCompletionNotification", () => {
  it("opens the completed thread on a single notification click", () => {
    const focusSpy = vi.fn();
    vi.stubGlobal("window", {
      focus: focusSpy,
      setTimeout,
    });

    class MockNotification {
      static permission: NotificationPermission = "granted";

      listeners = new Map<string, Set<(event: Event) => void>>();
      closed = false;

      constructor(
        public readonly title: string,
        public readonly options?: NotificationOptions,
      ) {}

      addEventListener(type: string, listener: (event: Event) => void) {
        const listeners = this.listeners.get(type) ?? new Set<(event: Event) => void>();
        listeners.add(listener);
        this.listeners.set(type, listeners);
      }

      close() {
        this.closed = true;
      }

      dispatchClick() {
        const event = {
          preventDefault: vi.fn(),
        } as unknown as Event;
        for (const listener of this.listeners.get("click") ?? []) {
          listener(event);
        }
        return event;
      }
    }

    vi.stubGlobal("Notification", MockNotification);

    const clickSpy = vi.fn();
    const notification = showDesktopCompletionNotification(
      {
        title: "Codex finished",
        body: 'Thread "Fix flaky test" is ready.',
        threadId: ThreadId.makeUnsafe("thread-1"),
      },
      clickSpy,
    ) as unknown as MockNotification;

    expect(notification).not.toBeNull();

    const event = notification.dispatchClick() as unknown as {
      preventDefault: ReturnType<typeof vi.fn>;
    };
    notification.dispatchClick();
    vi.runAllTimers();

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledWith(ThreadId.makeUnsafe("thread-1"));
    expect(notification.closed).toBe(true);
    expect(focusSpy).toHaveBeenCalledTimes(2);
  });
});
