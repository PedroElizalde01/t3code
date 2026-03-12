import type { SkillId, SkillReference } from "@t3tools/contracts";
import { SparklesIcon, SearchIcon } from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";

import { cn } from "~/lib/utils";

import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";

function areSkillIdListsEqual(left: readonly SkillId[], right: readonly SkillId[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

interface ChatSkillsControlProps {
  skills: ReadonlyArray<SkillReference>;
  selectedSkillIds: SkillId[];
  loading: boolean;
  errorMessage?: string | null;
  onRefresh?: () => void;
  onSelectedSkillIdsChange: (selectedSkillIds: SkillId[]) => void;
}

const ChatSkillsControl = memo(function ChatSkillsControl(props: ChatSkillsControlProps) {
  const { onRefresh } = props;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [draftSelectedSkillIds, setDraftSelectedSkillIds] = useState<SkillId[]>(
    props.selectedSkillIds,
  );

  useEffect(() => {
    if (!open) {
      setDraftSelectedSkillIds(props.selectedSkillIds);
    }
  }, [open, props.selectedSkillIds]);

  useEffect(() => {
    if (!open) {
      return;
    }
    onRefresh?.();
  }, [onRefresh, open]);

  const visibleSkills = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return props.skills;
    }

    return props.skills.filter((skill) => {
      const searchText = `${skill.name}\n${skill.description}\n${skill.id}`.toLowerCase();
      return searchText.includes(normalizedQuery);
    });
  }, [props.skills, query]);

  const selectedCount = props.selectedSkillIds.length;
  const hasChanges = !areSkillIdListsEqual(draftSelectedSkillIds, props.selectedSkillIds);

  const toggleSkill = (skillId: SkillId) => {
    setDraftSelectedSkillIds((current) =>
      current.includes(skillId)
        ? current.filter((entry) => entry !== skillId)
        : [...current, skillId],
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        size="xs"
        variant="outline"
        className={cn(
          selectedCount > 0 &&
            "border-emerald-500/45 bg-emerald-500/8 text-emerald-700 hover:bg-emerald-500/12",
        )}
        title={selectedCount > 0 ? `${selectedCount} skills selected` : "Add skills"}
        onClick={() => setOpen(true)}
      >
        <SparklesIcon className="size-3.5" />
        <span className="sr-only @sm/header-actions:not-sr-only @sm/header-actions:ml-0.5">
          {selectedCount > 0 ? `Skills (${selectedCount})` : "Add skills"}
        </span>
      </Button>

      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SparklesIcon className="size-4 text-muted-foreground" />
            Chat Skills
          </DialogTitle>
          <DialogDescription>
            Choose which installed Codex skills this chat should keep in scope.
          </DialogDescription>
        </DialogHeader>

        <DialogPanel className="space-y-4">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium text-sm">Search</span>
              <span className="text-muted-foreground text-xs">
                {draftSelectedSkillIds.length} selected
              </span>
            </div>
            <div className="relative">
              <SearchIcon className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-3 size-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search installed skills"
                className="pl-9"
              />
            </div>
          </div>

          <div className="max-h-[min(40vh,22rem)] space-y-2 overflow-y-auto pr-1">
            {props.loading ? (
              <div className="rounded-md border border-dashed border-border/80 px-5 py-8 text-center text-muted-foreground text-sm">
                Loading Codex skills…
              </div>
            ) : props.errorMessage ? (
              <div className="rounded-md border border-dashed border-border/80 px-5 py-8 text-center">
                <p className="text-sm text-muted-foreground">{props.errorMessage}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  onClick={() => onRefresh?.()}
                >
                  Retry
                </Button>
              </div>
            ) : visibleSkills.length === 0 ? (
              <div className="rounded-md border border-dashed border-border/80 px-5 py-8 text-center text-muted-foreground text-sm">
                {props.skills.length === 0
                  ? "No installed Codex skills were found in the configured skill locations."
                  : "No skills match this search."}
              </div>
            ) : (
              <div className="space-y-2">
                {visibleSkills.map((skill) => {
                  const checked = draftSelectedSkillIds.includes(skill.id);
                  return (
                    <button
                      key={skill.id}
                      type="button"
                      className={cn(
                        "flex w-full items-start gap-3 rounded-md border px-4 py-3 text-left transition-colors",
                        checked
                          ? "border-emerald-500/45 bg-emerald-500/[0.07]"
                          : "border-border/70 bg-background hover:border-border hover:bg-muted/35",
                      )}
                      onClick={() => toggleSkill(skill.id)}
                    >
                      <Checkbox
                        checked={checked}
                        aria-label={`Select ${skill.name}`}
                        className="mt-0.5"
                        onCheckedChange={() => toggleSkill(skill.id)}
                        onClick={(event) => event.stopPropagation()}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium text-sm">{skill.name}</span>
                          <span className="shrink-0 rounded-md border border-border/80 px-2 py-0.5 text-[10px] text-muted-foreground uppercase tracking-[0.14em]">
                            {skill.id}
                          </span>
                        </div>
                        <p className="mt-1 text-muted-foreground text-sm">
                          {skill.description || "No description provided."}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <p className="text-muted-foreground text-xs">
            Installed skills are read from `CODEX_HOME/skills` and any additional skill paths in
            Settings.
          </p>
        </DialogPanel>

        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            className="mr-auto"
            onClick={() => {
              setDraftSelectedSkillIds([]);
            }}
            disabled={draftSelectedSkillIds.length === 0}
          >
            Clear
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setDraftSelectedSkillIds(props.selectedSkillIds);
              setOpen(false);
            }}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => {
              props.onSelectedSkillIdsChange(draftSelectedSkillIds);
              setOpen(false);
            }}
            disabled={!hasChanges}
          >
            Apply skills
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
});

ChatSkillsControl.displayName = "ChatSkillsControl";

export default ChatSkillsControl;
