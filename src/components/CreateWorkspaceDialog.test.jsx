import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import CreateWorkspaceDialog from "./CreateWorkspaceDialog.jsx";
import { expectRequest, mockApi } from "../test/setup-tests.js";

it("creates a named workspace and returns the refreshed session payload", async () => {
  const workspace = {
    id: 8,
    name: "Second Company",
    role: "owner",
    status: "active",
    permissions: [],
  };
  const user = { id: 3, workspaces: [workspace] };
  const api = mockApi({
    "/api/workspaces/": {
      status: 201,
      body: { workspace, user },
    },
  });
  const onCreated = vi.fn();
  const onOpenChange = vi.fn();

  render(
    <CreateWorkspaceDialog
      open
      onOpenChange={onOpenChange}
      onCreated={onCreated}
    />,
  );

  fireEvent.change(screen.getByLabelText("Company or workspace name"), {
    target: { value: "Second Company" },
  });
  fireEvent.submit(screen.getByRole("form", { name: "Create workspace" }));

  await waitFor(() =>
    expect(onCreated).toHaveBeenCalledWith({ workspace, user }),
  );
  const [, request] = expectRequest(api, "/api/workspaces/", "POST");
  expect(JSON.parse(request.body)).toEqual({ name: "Second Company" });
  expect(onOpenChange).toHaveBeenCalledWith(false);
});
