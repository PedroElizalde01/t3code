import { ProjectId, ThreadId } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type ComposerImageAttachment,
  type PersistedComposerImageAttachment,
  createDebouncedStorage,
  useComposerDraftStore,
} from "./composerDraftStore";

function makeImage(input: {
  id: string;
  previewUrl: string;
  name?: string;
  mimeType?: string;
  sizeBytes?: number;
  lastModified?: number;
}): ComposerImageAttachment {
  const name = input.name ?? "image.png";
  const mimeType = input.mimeType ?? "image/png";
  const sizeBytes = input.sizeBytes ?? 4;
  const lastModified = input.lastModified ?? 1_700_000_000_000;
  const file = new File([new Uint8Array(sizeBytes).fill(1)], name, {
    type: mimeType,
    lastModified,
  });
  return {
    type: "image",
    id: input.id,
    name,
    mimeType,
    sizeBytes: file.size,
    previewUrl: input.previewUrl,
    file,
  };
}

function makePersistedAttachment(image: ComposerImageAttachment): PersistedComposerImageAttachment {
  return {
    id: image.id,
    name: image.name,
    mimeType: image.mimeType,
    sizeBytes: image.sizeBytes,
    dataUrl: `data:${image.mimeType};base64,${btoa("\x01".repeat(image.sizeBytes))}`,
  };
}

type MockBrowserStorage = {
  clear: ReturnType<typeof vi.fn<() => void>>;
  getItem: ReturnType<typeof vi.fn<(name: string) => string | null>>;
  removeItem: ReturnType<typeof vi.fn<(name: string) => void>>;
  setItem: ReturnType<typeof vi.fn<(name: string, value: string) => void>>;
};

function createMockBrowserStorage(): {
  backingStore: Map<string, string>;
  storage: MockBrowserStorage;
} {
  const backingStore = new Map<string, string>();
  const storage: MockBrowserStorage = {
    getItem: vi.fn((name: string) => backingStore.get(name) ?? null),
    setItem: vi.fn((name: string, value: string) => {
      backingStore.set(name, value);
    }),
    removeItem: vi.fn((name: string) => {
      backingStore.delete(name);
    }),
    clear: vi.fn(() => {
      backingStore.clear();
    }),
  };
  return { backingStore, storage };
}

describe("composerDraftStore addImages", () => {
  const threadId = ThreadId.makeUnsafe("thread-dedupe");
  let originalRevokeObjectUrl: typeof URL.revokeObjectURL;
  let revokeSpy: ReturnType<typeof vi.fn<(url: string) => void>>;

  beforeEach(() => {
    useComposerDraftStore.setState({
      draftsByThreadId: {},
      draftThreadsByThreadId: {},
      projectDraftThreadIdByProjectId: {},
    });
    originalRevokeObjectUrl = URL.revokeObjectURL;
    revokeSpy = vi.fn();
    URL.revokeObjectURL = revokeSpy;
  });

  afterEach(() => {
    URL.revokeObjectURL = originalRevokeObjectUrl;
  });

  it("deduplicates identical images in one batch by file signature", () => {
    const first = makeImage({
      id: "img-1",
      previewUrl: "blob:first",
      name: "same.png",
      mimeType: "image/png",
      sizeBytes: 12,
      lastModified: 12345,
    });
    const duplicate = makeImage({
      id: "img-2",
      previewUrl: "blob:duplicate",
      name: "same.png",
      mimeType: "image/png",
      sizeBytes: 12,
      lastModified: 12345,
    });

    useComposerDraftStore.getState().addImages(threadId, [first, duplicate]);

    const draft = useComposerDraftStore.getState().draftsByThreadId[threadId];
    expect(draft?.images.map((image) => image.id)).toEqual(["img-1"]);
    expect(revokeSpy).toHaveBeenCalledWith("blob:duplicate");
  });

  it("deduplicates against existing images across calls by file signature", () => {
    const first = makeImage({
      id: "img-a",
      previewUrl: "blob:a",
      name: "same.png",
      mimeType: "image/png",
      sizeBytes: 9,
      lastModified: 777,
    });
    const duplicateLater = makeImage({
      id: "img-b",
      previewUrl: "blob:b",
      name: "same.png",
      mimeType: "image/png",
      sizeBytes: 9,
      lastModified: 999,
    });

    useComposerDraftStore.getState().addImage(threadId, first);
    useComposerDraftStore.getState().addImage(threadId, duplicateLater);

    const draft = useComposerDraftStore.getState().draftsByThreadId[threadId];
    expect(draft?.images.map((image) => image.id)).toEqual(["img-a"]);
    expect(revokeSpy).toHaveBeenCalledWith("blob:b");
  });

  it("does not revoke blob URLs that are still used by an accepted duplicate image", () => {
    const first = makeImage({
      id: "img-shared",
      previewUrl: "blob:shared",
    });
    const duplicateSameUrl = makeImage({
      id: "img-shared",
      previewUrl: "blob:shared",
    });

    useComposerDraftStore.getState().addImages(threadId, [first, duplicateSameUrl]);

    const draft = useComposerDraftStore.getState().draftsByThreadId[threadId];
    expect(draft?.images.map((image) => image.id)).toEqual(["img-shared"]);
    expect(revokeSpy).not.toHaveBeenCalledWith("blob:shared");
  });
});

describe("composerDraftStore clearComposerContent", () => {
  const threadId = ThreadId.makeUnsafe("thread-clear");
  let originalRevokeObjectUrl: typeof URL.revokeObjectURL;
  let revokeSpy: ReturnType<typeof vi.fn<(url: string) => void>>;

  beforeEach(() => {
    useComposerDraftStore.setState({
      draftsByThreadId: {},
      draftThreadsByThreadId: {},
      projectDraftThreadIdByProjectId: {},
    });
    originalRevokeObjectUrl = URL.revokeObjectURL;
    revokeSpy = vi.fn();
    URL.revokeObjectURL = revokeSpy;
  });

  afterEach(() => {
    URL.revokeObjectURL = originalRevokeObjectUrl;
  });

  it("does not revoke blob preview URLs when clearing composer content", () => {
    const first = makeImage({
      id: "img-optimistic",
      previewUrl: "blob:optimistic",
    });
    useComposerDraftStore.getState().addImage(threadId, first);

    useComposerDraftStore.getState().clearComposerContent(threadId);

    const draft = useComposerDraftStore.getState().draftsByThreadId[threadId];
    expect(draft).toBeUndefined();
    expect(revokeSpy).not.toHaveBeenCalledWith("blob:optimistic");
  });
});

describe("composerDraftStore project draft thread mapping", () => {
  const projectId = ProjectId.makeUnsafe("project-a");
  const otherProjectId = ProjectId.makeUnsafe("project-b");
  const threadId = ThreadId.makeUnsafe("thread-a");
  const otherThreadId = ThreadId.makeUnsafe("thread-b");

  beforeEach(() => {
    useComposerDraftStore.setState({
      draftsByThreadId: {},
      draftThreadsByThreadId: {},
      projectDraftThreadIdByProjectId: {},
    });
  });

  it("stores and reads project draft thread ids via actions", () => {
    const store = useComposerDraftStore.getState();
    expect(store.getDraftThreadByProjectId(projectId)).toBeNull();
    expect(store.getDraftThread(threadId)).toBeNull();

    store.setProjectDraftThreadId(projectId, threadId, {
      branch: "feature/test",
      worktreePath: "/tmp/worktree-test",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(useComposerDraftStore.getState().getDraftThreadByProjectId(projectId)).toEqual({
      threadId,
      projectId,
      branch: "feature/test",
      worktreePath: "/tmp/worktree-test",
      envMode: "worktree",
      runtimeMode: "full-access",
      interactionMode: "default",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(useComposerDraftStore.getState().getDraftThread(threadId)).toEqual({
      projectId,
      branch: "feature/test",
      worktreePath: "/tmp/worktree-test",
      envMode: "worktree",
      runtimeMode: "full-access",
      interactionMode: "default",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("clears only matching project draft mapping entries", () => {
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(projectId, threadId);
    store.setPrompt(threadId, "hello");

    store.clearProjectDraftThreadById(projectId, otherThreadId);
    expect(useComposerDraftStore.getState().getDraftThreadByProjectId(projectId)?.threadId).toBe(
      threadId,
    );

    store.clearProjectDraftThreadById(projectId, threadId);
    expect(useComposerDraftStore.getState().getDraftThreadByProjectId(projectId)).toBeNull();
    expect(useComposerDraftStore.getState().getDraftThread(threadId)).toBeNull();
    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]).toBeUndefined();
  });

  it("clears project draft mapping by project id", () => {
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(projectId, threadId);
    store.setPrompt(threadId, "hello");
    store.clearProjectDraftThreadId(projectId);
    expect(useComposerDraftStore.getState().getDraftThreadByProjectId(projectId)).toBeNull();
    expect(useComposerDraftStore.getState().getDraftThread(threadId)).toBeNull();
    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]).toBeUndefined();
  });

  it("clears orphaned composer drafts when remapping a project to a new draft thread", () => {
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(projectId, threadId);
    store.setPrompt(threadId, "orphan me");

    store.setProjectDraftThreadId(projectId, otherThreadId);

    expect(useComposerDraftStore.getState().getDraftThreadByProjectId(projectId)?.threadId).toBe(
      otherThreadId,
    );
    expect(useComposerDraftStore.getState().getDraftThread(threadId)).toBeNull();
    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]).toBeUndefined();
  });

  it("keeps composer drafts when the thread is still mapped by another project", () => {
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(projectId, threadId);
    store.setProjectDraftThreadId(otherProjectId, threadId);
    store.setPrompt(threadId, "keep me");

    store.clearProjectDraftThreadId(projectId);

    expect(useComposerDraftStore.getState().getDraftThreadByProjectId(projectId)).toBeNull();
    expect(
      useComposerDraftStore.getState().getDraftThreadByProjectId(otherProjectId)?.threadId,
    ).toBe(threadId);
    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]?.prompt).toBe("keep me");
  });

  it("clears draft registration independently", () => {
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(projectId, threadId);
    store.clearDraftThread(threadId);
    expect(useComposerDraftStore.getState().getDraftThreadByProjectId(projectId)).toBeNull();
    expect(useComposerDraftStore.getState().getDraftThread(threadId)).toBeNull();
  });

  it("updates branch context on an existing draft thread", () => {
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(projectId, threadId, {
      branch: "main",
      worktreePath: null,
    });
    store.setDraftThreadContext(threadId, {
      branch: "feature/next",
      worktreePath: "/tmp/feature-next",
    });
    expect(useComposerDraftStore.getState().getDraftThreadByProjectId(projectId)?.threadId).toBe(
      threadId,
    );
    expect(useComposerDraftStore.getState().getDraftThread(threadId)).toMatchObject({
      projectId,
      branch: "feature/next",
      worktreePath: "/tmp/feature-next",
      envMode: "worktree",
    });
  });

  it("preserves existing branch and worktree when setProjectDraftThreadId receives undefined", () => {
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(projectId, threadId, {
      branch: "main",
      worktreePath: "/tmp/main-worktree",
    });
    const runtimeUndefinedOptions = {
      branch: undefined,
      worktreePath: undefined,
    } as unknown as {
      branch?: string | null;
      worktreePath?: string | null;
    };
    store.setProjectDraftThreadId(projectId, threadId, runtimeUndefinedOptions);

    expect(useComposerDraftStore.getState().getDraftThread(threadId)).toMatchObject({
      projectId,
      branch: "main",
      worktreePath: "/tmp/main-worktree",
      envMode: "worktree",
    });
  });

  it("preserves worktree env mode without a worktree path", () => {
    const store = useComposerDraftStore.getState();
    store.setProjectDraftThreadId(projectId, threadId, {
      branch: "feature/base",
      worktreePath: null,
      envMode: "worktree",
    });
    const runtimeUndefinedOptions = {
      branch: undefined,
      worktreePath: undefined,
      envMode: undefined,
    } as unknown as {
      branch?: string | null;
      worktreePath?: string | null;
      envMode?: "local" | "worktree";
    };
    store.setProjectDraftThreadId(projectId, threadId, runtimeUndefinedOptions);

    expect(useComposerDraftStore.getState().getDraftThread(threadId)).toMatchObject({
      projectId,
      branch: "feature/base",
      worktreePath: null,
      envMode: "worktree",
    });
  });
});

describe("composerDraftStore codex fast mode", () => {
  const threadId = ThreadId.makeUnsafe("thread-service-tier");

  beforeEach(() => {
    useComposerDraftStore.setState({
      draftsByThreadId: {},
      draftThreadsByThreadId: {},
      projectDraftThreadIdByProjectId: {},
    });
  });

  it("stores codex fast mode in the draft", () => {
    const store = useComposerDraftStore.getState();
    store.setCodexFastMode(threadId, true);

    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]?.codexFastMode).toBe(true);
  });

  it("clears codex fast mode when reset to the default", () => {
    const store = useComposerDraftStore.getState();
    store.setCodexFastMode(threadId, true);
    store.setCodexFastMode(threadId, false);

    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]).toBeUndefined();
  });
});

describe("composerDraftStore setModel", () => {
  const threadId = ThreadId.makeUnsafe("thread-model");

  beforeEach(() => {
    useComposerDraftStore.setState({
      draftsByThreadId: {},
      draftThreadsByThreadId: {},
      projectDraftThreadIdByProjectId: {},
    });
  });

  it("keeps explicit DEFAULT_MODEL overrides instead of coercing to null", () => {
    const store = useComposerDraftStore.getState();

    store.setModel(threadId, "gpt-5.3-codex");

    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]?.model).toBe(
      "gpt-5.3-codex",
    );
  });
});

describe("composerDraftStore setProvider", () => {
  const threadId = ThreadId.makeUnsafe("thread-provider");

  beforeEach(() => {
    useComposerDraftStore.setState({
      draftsByThreadId: {},
      draftThreadsByThreadId: {},
      projectDraftThreadIdByProjectId: {},
    });
  });

  it("persists provider-only selection even when prompt/model are empty", () => {
    const store = useComposerDraftStore.getState();

    store.setProvider(threadId, "codex");

    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]?.provider).toBe("codex");
  });

  it("removes empty provider-only draft when provider is reset", () => {
    const store = useComposerDraftStore.getState();

    store.setProvider(threadId, "codex");
    store.setProvider(threadId, null);

    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]).toBeUndefined();
  });
});

describe("composerDraftStore runtime and interaction settings", () => {
  const threadId = ThreadId.makeUnsafe("thread-settings");

  beforeEach(() => {
    useComposerDraftStore.setState({
      draftsByThreadId: {},
      draftThreadsByThreadId: {},
      projectDraftThreadIdByProjectId: {},
    });
  });

  it("stores runtime mode overrides in the composer draft", () => {
    const store = useComposerDraftStore.getState();

    store.setRuntimeMode(threadId, "approval-required");

    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]?.runtimeMode).toBe(
      "approval-required",
    );
  });

  it("stores interaction mode overrides in the composer draft", () => {
    const store = useComposerDraftStore.getState();

    store.setInteractionMode(threadId, "plan");

    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]?.interactionMode).toBe(
      "plan",
    );
  });

  it("removes empty settings-only drafts when overrides are cleared", () => {
    const store = useComposerDraftStore.getState();

    store.setRuntimeMode(threadId, "approval-required");
    store.setInteractionMode(threadId, "plan");
    store.setRuntimeMode(threadId, null);
    store.setInteractionMode(threadId, null);

    expect(useComposerDraftStore.getState().draftsByThreadId[threadId]).toBeUndefined();
  });
});

describe("composerDraftStore attachment persistence", () => {
  const threadId = ThreadId.makeUnsafe("thread-attachment-persistence");
  let backingStore: Map<string, string>;
  let browserStorage: MockBrowserStorage;
  let composerDraftStoreModule: typeof import("./composerDraftStore");

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    ({ backingStore, storage: browserStorage } = createMockBrowserStorage());
    vi.stubGlobal("window", { addEventListener: vi.fn() });
    vi.stubGlobal("localStorage", browserStorage);
    composerDraftStoreModule = await import("./composerDraftStore");
    composerDraftStoreModule.useComposerDraftStore.setState({
      draftsByThreadId: {},
      draftThreadsByThreadId: {},
      projectDraftThreadIdByProjectId: {},
    });
    composerDraftStoreModule.useComposerDraftStore.persist.clearStorage();
  });

  afterEach(() => {
    composerDraftStoreModule.useComposerDraftStore.persist.clearStorage();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("does not mark attachments as non-persisted before the debounced write succeeds", () => {
    const image = makeImage({
      id: "img-persisted",
      previewUrl: "blob:persisted",
    });
    const attachment = makePersistedAttachment(image);
    const store = composerDraftStoreModule.useComposerDraftStore.getState();

    store.addImage(threadId, image);
    store.syncPersistedAttachments(threadId, [attachment]);

    expect(
      composerDraftStoreModule.useComposerDraftStore.getState().draftsByThreadId[threadId]
        ?.nonPersistedImageIds,
    ).toEqual([]);

    vi.advanceTimersByTime(300);

    expect(
      composerDraftStoreModule.useComposerDraftStore.getState().draftsByThreadId[threadId],
    ).toMatchObject({
      persistedAttachments: [attachment],
      nonPersistedImageIds: [],
    });
    expect(backingStore.get(composerDraftStoreModule.COMPOSER_DRAFT_STORAGE_KEY)).toContain(
      image.id,
    );
  });

  it("marks attachments as non-persisted when the debounced storage write fails", () => {
    const image = makeImage({
      id: "img-failure",
      previewUrl: "blob:failure",
    });
    const attachment = makePersistedAttachment(image);
    browserStorage.setItem.mockImplementation((name, value) => {
      if (name === composerDraftStoreModule.COMPOSER_DRAFT_STORAGE_KEY) {
        void value;
        throw new DOMException("Quota exceeded", "QuotaExceededError");
      }
      backingStore.set(name, value);
    });

    const store = composerDraftStoreModule.useComposerDraftStore.getState();
    store.addImage(threadId, image);
    store.syncPersistedAttachments(threadId, [attachment]);

    vi.advanceTimersByTime(300);

    expect(
      composerDraftStoreModule.useComposerDraftStore.getState().draftsByThreadId[threadId],
    ).toMatchObject({
      persistedAttachments: [],
      nonPersistedImageIds: [image.id],
    });
    expect(backingStore.get(composerDraftStoreModule.COMPOSER_DRAFT_STORAGE_KEY)).toBeUndefined();
  });

  it("rehydrates persisted attachments into the composer draft", async () => {
    const image = makeImage({
      id: "img-hydrated",
      previewUrl: "blob:hydrated",
    });
    const attachment = makePersistedAttachment(image);
    browserStorage.setItem(
      composerDraftStoreModule.COMPOSER_DRAFT_STORAGE_KEY,
      JSON.stringify({
        state: {
          draftsByThreadId: {
            [threadId]: {
              prompt: "restored prompt",
              attachments: [attachment],
              provider: "codex",
            },
          },
          draftThreadsByThreadId: {},
          projectDraftThreadIdByProjectId: {},
        },
        version: 1,
      }),
    );

    await composerDraftStoreModule.useComposerDraftStore.persist.rehydrate();

    expect(
      composerDraftStoreModule.useComposerDraftStore.getState().draftsByThreadId[threadId],
    ).toMatchObject({
      prompt: "restored prompt",
      persistedAttachments: [attachment],
      nonPersistedImageIds: [],
      provider: "codex",
    });
    expect(
      composerDraftStoreModule.useComposerDraftStore.getState().draftsByThreadId[threadId]?.images,
    ).toHaveLength(1);
    expect(
      composerDraftStoreModule.useComposerDraftStore.getState().draftsByThreadId[threadId]
        ?.images[0],
    ).toMatchObject({
      id: image.id,
      previewUrl: attachment.dataUrl,
      name: image.name,
      mimeType: image.mimeType,
    });
  });
});

// ---------------------------------------------------------------------------
// createDebouncedStorage
// ---------------------------------------------------------------------------

function createMockStorage() {
  const store = new Map<string, string>();
  return {
    getItem: vi.fn((name: string) => store.get(name) ?? null),
    setItem: vi.fn((name: string, value: string) => {
      store.set(name, value);
    }),
    removeItem: vi.fn((name: string) => {
      store.delete(name);
    }),
  };
}

describe("createDebouncedStorage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("delegates getItem immediately", () => {
    const base = createMockStorage();
    base.getItem.mockReturnValueOnce("value");
    const storage = createDebouncedStorage(base);

    expect(storage.getItem("key")).toBe("value");
    expect(base.getItem).toHaveBeenCalledWith("key");
  });

  it("does not write to base storage until the debounce fires", () => {
    const base = createMockStorage();
    const storage = createDebouncedStorage(base);

    storage.setItem("key", "v1");
    expect(base.setItem).not.toHaveBeenCalled();

    vi.advanceTimersByTime(299);
    expect(base.setItem).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(base.setItem).toHaveBeenCalledWith("key", "v1");
  });

  it("only writes the last value when setItem is called rapidly", () => {
    const base = createMockStorage();
    const storage = createDebouncedStorage(base);

    storage.setItem("key", "v1");
    storage.setItem("key", "v2");
    storage.setItem("key", "v3");

    vi.advanceTimersByTime(300);
    expect(base.setItem).toHaveBeenCalledTimes(1);
    expect(base.setItem).toHaveBeenCalledWith("key", "v3");
  });

  it("removeItem cancels a pending setItem write", () => {
    const base = createMockStorage();
    const storage = createDebouncedStorage(base);

    storage.setItem("key", "v1");
    storage.removeItem("key");

    vi.advanceTimersByTime(300);
    expect(base.setItem).not.toHaveBeenCalled();
    expect(base.removeItem).toHaveBeenCalledWith("key");
  });

  it("flush writes the pending value immediately", () => {
    const base = createMockStorage();
    const storage = createDebouncedStorage(base);

    storage.setItem("key", "v1");
    expect(base.setItem).not.toHaveBeenCalled();

    storage.flush();
    expect(base.setItem).toHaveBeenCalledWith("key", "v1");

    // Timer should be cancelled; no duplicate write.
    vi.advanceTimersByTime(300);
    expect(base.setItem).toHaveBeenCalledTimes(1);
  });

  it("flush is a no-op when nothing is pending", () => {
    const base = createMockStorage();
    const storage = createDebouncedStorage(base);

    storage.flush();
    expect(base.setItem).not.toHaveBeenCalled();
  });

  it("flush after removeItem is a no-op", () => {
    const base = createMockStorage();
    const storage = createDebouncedStorage(base);

    storage.setItem("key", "v1");
    storage.removeItem("key");
    storage.flush();

    expect(base.setItem).not.toHaveBeenCalled();
  });

  it("setItem works normally after removeItem cancels a pending write", () => {
    const base = createMockStorage();
    const storage = createDebouncedStorage(base);

    storage.setItem("key", "v1");
    storage.removeItem("key");
    storage.setItem("key", "v2");

    vi.advanceTimersByTime(300);
    expect(base.setItem).toHaveBeenCalledTimes(1);
    expect(base.setItem).toHaveBeenCalledWith("key", "v2");
  });
});
