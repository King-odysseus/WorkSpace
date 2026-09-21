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
  budget_amount: 120000,
  budget_currency: "GBP",
  metrics: {
    total_tasks: 4,
    applicable_tasks: 4,
    completed_tasks: 1,
    blocked_tasks: 1,
    overdue_tasks: 1,
    completion_rate: 25,
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

it("renders the approved P29 project overview hierarchy and actions", async () => {
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
    "/api/workspaces/1/projects/42/expenses/": {
      expenses: [
        { id: 1, amount: 102000, is_committed: false },
        { id: 2, amount: 28000, is_committed: true },
      ],
    },
    "/api/workspaces/1/projects/42/resources/": { resources: [] },
    "/api/workspaces/1/risks-issues/?project_id=42": { records: [] },
    "/api/workspaces/1/activity/": { activity: [] },
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

  const progressHeading = await screen.findByRole("heading", { name: "Progress" });
  const progressCard = progressHeading.closest(".project-detail-progress-card");
  expect(progressCard).not.toBeNull();
  expect(within(progressCard).queryByText(/at risk/i)).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Task totals" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Current blockers" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Recent activity" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Budget" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Delivery" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Upcoming deadline" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Quick actions" })).toBeInTheDocument();

  expect(screen.queryByText("Delivery overview")).not.toBeInTheDocument();
  expect(screen.queryByText("Progress summary")).not.toBeInTheDocument();
  expect(screen.queryByText("Workload")).not.toBeInTheDocument();
  expect(screen.queryByText("Next milestone")).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "New task" }));
  const dialog = await screen.findByRole("dialog", { name: "Add a task" });
  expect(dialog).toBeInTheDocument();
}, 60000);
