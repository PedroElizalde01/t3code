import { ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vitest";

import { useThreadNavigationStore } from "./threadNavigationStore";

const THREAD_A = ThreadId.makeUnsafe("thread-a");
const THREAD_B = ThreadId.makeUnsafe("thread-b");
const THREAD_C = ThreadId.makeUnsafe("thread-c");

describe("threadNavigationStore", () => {
  beforeEach(() => {
    useThreadNavigationStore.setState({
      currentThreadId: null,
      previousThreadId: null,
    });
  });

  it("records the first visited thread as current without a previous thread", () => {
    useThreadNavigationStore.getState().recordVisit(THREAD_A);

    expect(useThreadNavigationStore.getState()).toMatchObject({
      currentThreadId: THREAD_A,
      previousThreadId: null,
    });
  });

  it("tracks the previous thread when visiting a different thread", () => {
    const store = useThreadNavigationStore.getState();
    store.recordVisit(THREAD_A);
    store.recordVisit(THREAD_B);

    expect(useThreadNavigationStore.getState()).toMatchObject({
      currentThreadId: THREAD_B,
      previousThreadId: THREAD_A,
    });
  });

  it("supports toggling between two threads by recording alternating visits", () => {
    const store = useThreadNavigationStore.getState();
    store.recordVisit(THREAD_A);
    store.recordVisit(THREAD_B);
    store.recordVisit(THREAD_A);

    expect(useThreadNavigationStore.getState()).toMatchObject({
      currentThreadId: THREAD_A,
      previousThreadId: THREAD_B,
    });
  });

  it("is a no-op when recording the active thread again", () => {
    const store = useThreadNavigationStore.getState();
    store.recordVisit(THREAD_A);

    const stateBefore = useThreadNavigationStore.getState();
    store.recordVisit(THREAD_A);

    expect(useThreadNavigationStore.getState()).toBe(stateBefore);
  });

  it("clears a removed previous thread", () => {
    const store = useThreadNavigationStore.getState();
    store.recordVisit(THREAD_A);
    store.recordVisit(THREAD_B);
    store.clearThread(THREAD_A);

    expect(useThreadNavigationStore.getState()).toMatchObject({
      currentThreadId: THREAD_B,
      previousThreadId: null,
    });
  });

  it("prunes stale thread ids while preserving valid history", () => {
    const store = useThreadNavigationStore.getState();
    store.recordVisit(THREAD_A);
    store.recordVisit(THREAD_B);
    store.pruneThreads([THREAD_B, THREAD_C]);

    expect(useThreadNavigationStore.getState()).toMatchObject({
      currentThreadId: THREAD_B,
      previousThreadId: null,
    });
  });
});
