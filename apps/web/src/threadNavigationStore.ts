import type { ThreadId } from "@t3tools/contracts";
import { create } from "zustand";

interface ThreadNavigationState {
  currentThreadId: ThreadId | null;
  previousThreadId: ThreadId | null;
}

interface ThreadNavigationStore extends ThreadNavigationState {
  recordVisit: (threadId: ThreadId) => void;
  clearThread: (threadId: ThreadId) => void;
  pruneThreads: (threadIds: readonly ThreadId[]) => void;
}

export const useThreadNavigationStore = create<ThreadNavigationStore>((set) => ({
  currentThreadId: null,
  previousThreadId: null,

  recordVisit: (threadId) => {
    set((state) => {
      if (state.currentThreadId === threadId) {
        return state;
      }

      return {
        currentThreadId: threadId,
        previousThreadId: state.currentThreadId,
      };
    });
  },

  clearThread: (threadId) => {
    set((state) => {
      if (state.currentThreadId !== threadId && state.previousThreadId !== threadId) {
        return state;
      }

      return {
        currentThreadId: state.currentThreadId === threadId ? null : state.currentThreadId,
        previousThreadId: state.previousThreadId === threadId ? null : state.previousThreadId,
      };
    });
  },

  pruneThreads: (threadIds) => {
    const validThreadIds = new Set(threadIds);
    set((state) => {
      const nextCurrentThreadId =
        state.currentThreadId !== null && validThreadIds.has(state.currentThreadId)
          ? state.currentThreadId
          : null;
      const nextPreviousThreadId =
        state.previousThreadId !== null && validThreadIds.has(state.previousThreadId)
          ? state.previousThreadId
          : null;

      if (
        nextCurrentThreadId === state.currentThreadId &&
        nextPreviousThreadId === state.previousThreadId
      ) {
        return state;
      }

      return {
        currentThreadId: nextCurrentThreadId,
        previousThreadId: nextPreviousThreadId,
      };
    });
  },
}));
