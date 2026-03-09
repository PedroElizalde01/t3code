import { type ServerProviderStatus } from "@t3tools/contracts";

import { type ThreadSession } from "./types";

function isCodexRuntimeHealthy(session: ThreadSession | null | undefined): boolean {
  return (
    session?.provider === "codex" &&
    session.orchestrationStatus !== "idle" &&
    session.orchestrationStatus !== "stopped" &&
    session.orchestrationStatus !== "error"
  );
}

function isPathProbeWarning(status: ServerProviderStatus): boolean {
  const message = status.message?.toLowerCase() ?? "";
  return (
    message.includes("not installed or not on path") ||
    message.includes("failed to execute codex cli health check")
  );
}

export function resolveVisibleProviderHealthStatus(input: {
  readonly status: ServerProviderStatus | null;
  readonly activeSession: ThreadSession | null | undefined;
  readonly codexBinaryPath: string;
}): ServerProviderStatus | null {
  const { status, activeSession, codexBinaryPath } = input;
  if (!status || status.status === "ready") {
    return null;
  }
  if (status.provider !== "codex") {
    return status;
  }
  if (isCodexRuntimeHealthy(activeSession)) {
    return null;
  }
  if (codexBinaryPath.trim().length > 0 && isPathProbeWarning(status)) {
    return null;
  }
  return status;
}
