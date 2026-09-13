import { useEffect, useState } from "react";
import { Building2 } from "lucide-react";

import { Button } from "./ui/button.jsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog.jsx";
import { getCsrfToken, readJsonResponse } from "../lib/workspace-format.js";

export default function CreateWorkspaceDialog({
  open,
  onOpenChange,
  onCreated,
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName("");
    setError("");
    setSubmitting(false);
  }, [open]);

  const submit = async (event) => {
    event.preventDefault();
    const workspaceName = name.trim();
    if (!workspaceName || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/workspaces/", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": await getCsrfToken(),
        },
        body: JSON.stringify({ name: workspaceName }),
      });
      const data = await readJsonResponse(
        response,
        "Workspace could not be created.",
      );
      if (!response.ok) {
        throw new Error(data.error || "Workspace could not be created.");
      }
      onCreated?.(data);
      setName("");
      onOpenChange?.(false);
    } catch (submitError) {
      setError(submitError.message || "Workspace could not be created.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!submitting) onOpenChange?.(nextOpen);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <div className="mb-1 grid size-10 place-items-center rounded-xl bg-info/10 text-info">
            <Building2 size={19} />
          </div>
          <DialogTitle>Create a workspace</DialogTitle>
          <DialogDescription>
            Set up a separate space for another company. Its members, tasks,
            projects, and settings stay independent.
          </DialogDescription>
        </DialogHeader>
        <form
          aria-label="Create workspace"
          className="grid gap-4"
          onSubmit={submit}
        >
          <label className="grid gap-1.5 text-xs font-bold text-foreground">
            Company or workspace name
            <input
              autoFocus
              maxLength={120}
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Acme Consulting"
              className="h-10 rounded-xl border border-border bg-surface px-3 text-sm font-normal text-foreground outline-none transition-colors placeholder:text-text-muted focus:border-info focus:ring-[3px] focus:ring-info/20"
            />
          </label>
          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              disabled={submitting}
              onClick={() => onOpenChange?.(false)}
            >
              Cancel
            </Button>
            <Button type="submit" loading={submitting} disabled={!name.trim()}>
              Create workspace
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
