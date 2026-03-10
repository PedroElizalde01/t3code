import { ProjectId, ThreadId, TurnId } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import {
  buildCompletionNotificationSnapshot,
  detectNewCodexCompletions,
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
