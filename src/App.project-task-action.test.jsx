import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { mockApi } from "./test/setup-tests.js";

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

const project = {
  id: 42,
  name: "Safron Website",
  description: "Refresh the marketing site and onboarding flow.",
  status: "active",
  health: "at-risk",
  due_date: "2026-10-03",
  updated_at: "2026-09-21T09:00:00Z",
  owner_name: "Nate Foster",
  member_count: 1,
  metrics: {
    total_tasks: 1,
    completed_tasks: 0,
    blocked_tasks: 0,
    overdue_tasks: 0,
    completion_rate: 0,
  },
};

const projectTask = {
  id: 91,
  title: "Review onboarding copy",
  description: "",
  assignee_id: 7,
  assignee_ids: [7],
  project: "Safron Website",
  project_id: 42,
  status: "todo",
  priority: "normal",
  due_date: "2026-09-25",
  bucket: "Backlog",
  recurrence: "none",
  estimate_minutes: 60,
  can_edit: true,
};

it("opens the existing task composer from the P31 project Tasks action", async () => {
  mockApi({
    "/api/auth/me/": session,
    "/api/tasks/?page=1&page_size=200": {
      tasks: [projectTask],
      pagination: { has_next: false },
    },
    "/api/workspaces/1/projects/?page_size=500": { projects: [project] },
    "/api/workspaces/1/members/?page_size=500": {
      members: [
        {
          id: 7,
          first_name: "Nate",
          last_name: "Foster",
          email: "nate@example.com",
          role: "owner",
        },
      ],
    },
    "/api/workspaces/1/plan-buckets/": {
      buckets: [{ id: 1, name: "Backlog", project_id: 42, position: 0 }],
    },
  });
  document.body.innerHTML = '<div id="root"></div>';
  await import("./main.jsx");

  await waitFor(
    () => expect(screen.getAllByRole("button", { name: "Projects" }).length).toBeGreaterThan(0),
    { timeout: 20000 },
  );
  fireEvent.click(screen.getAllByRole("button", { name: "Projects" })[0]);

  const openProject = await screen.findByRole(
    "button",
    { name: "Open Safron Website" },
    { timeout: 20000 },
  );
  fireEvent.click(openProject);
  fireEvent.click(await screen.findByRole("tab", { name: "Tasks" }));

  const newTask = await screen.findByRole("button", { name: "New task" });
  fireEvent.click(newTask);

  const dialog = await screen.findByRole("dialog", { name: "Add a task" });
  expect(within(dialog).getByRole("combobox", { name: "Project" })).toHaveTextContent("Safron Website");
}, 60000);
