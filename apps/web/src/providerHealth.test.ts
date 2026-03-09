import { describe, expect, it } from "vitest";

import { resolveVisibleProviderHealthStatus } from "./providerHealth";
import { type ThreadSession } from "./types";

const pathStatus = {
  provider: "codex" as const,
  status: "error" as const,
  available: false,
  authStatus: "unknown" as const,
  checkedAt: "2026-03-09T00:00:00.000Z",
  message: "Codex CLI (`codex`) is not installed or not on PATH.",
};

const healthySession: ThreadSession = {
  provider: "codex",
  status: "ready",
  orchestrationStatus: "ready",
  createdAt: "2026-03-09T00:00:00.000Z",
  updatedAt: "2026-03-09T00:00:00.000Z",
};

describe("resolveVisibleProviderHealthStatus", () => {
  it("hides stale Codex health warnings once the current session proves Codex works", () => {
    expect(
      resolveVisibleProviderHealthStatus({
        status: pathStatus,
        activeSession: healthySession,
        codexBinaryPath: "",
      }),
    ).toBeNull();
  });

  it("hides PATH probe failures when a custom Codex binary path is configured", () => {
    expect(
      resolveVisibleProviderHealthStatus({
        status: pathStatus,
        activeSession: null,
        codexBinaryPath: "/custom/bin/codex",
      }),
    ).toBeNull();
  });

  it("keeps unrelated Codex warnings visible when runtime is not proven healthy", () => {
    const status = {
      ...pathStatus,
      status: "warning" as const,
      available: true,
      message: "Could not verify Codex authentication status.",
    };

    expect(
      resolveVisibleProviderHealthStatus({
        status,
        activeSession: null,
        codexBinaryPath: "",
      }),
    ).toEqual(status);
  });
});
