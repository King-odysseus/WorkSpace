import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import { expectRequest, mockApi } from "./test/setup-tests.js";

const session = {
  user: {
    id: 7,
    email: "nate@example.com",
    first_name: "Nate",
    last_name: "Foster",
    default_workspace_id: 1,
    workspaces: [{ id: 1, name: "Northstar", role: "owner", permissions: [] }],
  },
};

const task = {
  id: 91,
  title: "Review onboarding copy",
  description: "",
  assignee_id: 7,
  assignee_ids: [7],
  status: "todo",
  priority: "normal",
  due_date: "2026-09-25",
  bucket: "Backlog",
  recurrence: "none",
  progress_percent: 0,
  can_edit: true,
};

it("saves a percent picked on a planner card, and moves a not-started task to In progress", async () => {
  const fetchMock = mockApi({
    "/api/auth/me/": session,
    "/api/tasks/?page=1&page_size=200": { tasks: [task], pagination: { has_next: false } },
    "/api/workspaces/1/projects/?page_size=500": { projects: [] },
    "/api/workspaces/1/members/?page_size=500": {
      members: [{ id: 7, first_name: "Nate", last_name: "Foster", email: "nate@example.com", role: "owner" }],
    },
    "/api/workspaces/1/plan-buckets/": { buckets: [{ id: 1, name: "Backlog", position: 0 }] },
    "/api/tasks/91/": { task: { ...task, status: "in_progress", progress_percent: 30 } },
  });
  document.body.innerHTML = '<div id="root"></div>';
  await import("./main.jsx");

  await waitFor(
    () => expect(screen.getAllByRole("button", { name: "Planner" }).length).toBeGreaterThan(0),
    { timeout: 20000 },
  );
  fireEvent.click(screen.getAllByRole("button", { name: "Planner" })[0]);

  const dropdown = await screen.findByRole(
    "combobox",
    { name: "Percent complete for Review onboarding copy" },
    { timeout: 20000 },
  );
  fireEvent.change(dropdown, { target: { value: "30" } });

  await waitFor(() => {
    const [, init] = expectRequest(fetchMock, "/api/tasks/91/", "PATCH");
    expect(JSON.parse(init.body)).toEqual({ progress_percent: 30, status: "in_progress" });
  });
}, 60000);
