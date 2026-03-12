import { queryOptions } from "@tanstack/react-query";
import type { ServerListSkillsInput } from "@t3tools/contracts";
import { ensureNativeApi } from "~/nativeApi";

export const serverQueryKeys = {
  all: ["server"] as const,
  config: () => ["server", "config"] as const,
  skills: (input: ServerListSkillsInput) => ["server", "skills", input] as const,
};

export function serverConfigQueryOptions() {
  return queryOptions({
    queryKey: serverQueryKeys.config(),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.server.getConfig();
    },
    staleTime: Infinity,
  });
}

export function serverSkillsQueryOptions(input: ServerListSkillsInput) {
  return queryOptions({
    queryKey: serverQueryKeys.skills(input),
    queryFn: async () => {
      const api = ensureNativeApi();
      return api.server.listSkills(input);
    },
    staleTime: 30_000,
  });
}
