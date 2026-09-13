// Board and dashboard views: the team board, the personal task queue, the Today
// dashboard, and the panels they embed (project progress, risks/issues,
// stakeholders and resources, and the time clock).

import React, { useEffect, useState } from "react";
import toast from "react-hot-toast";
import {
  AlertTriangle,
  AlarmClock,
  Archive,
  ArrowUpRight,
  Brush,
  CalendarCheck2,
  CalendarClock,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Copy,
  CircleSlash,
  Filter,
  Hash,
  LayoutDashboard,
  ListChecks,
  MessageSquare,
  Pause,
  Play,
  Plus,
  ShieldCheck,
  Square,
  Target,
  Users,
  X,
} from "lucide-react";
import { Button } from "./ui/button.jsx";
import { AppSelect } from "./ui/select.jsx";
import { Card } from "./ui/card.jsx";
import Avatar from "./Avatar.jsx";
import WorkScopeSelector, { taskMatchesScope } from "./WorkScopeSelector.jsx";
import {
  DateField,
  EmptyState,
  SelectField,
  WorkspaceViewHeading,
} from "./workspace-ui.jsx";
import {
  BREAK_PRESETS,
  BREAK_PRESET_LABEL,
  PRESENCE_LABEL,
  PRESENCE_OPTIONS,
  effectivePresence,
  formatDate,
  formatDay,
  formatLastSeen,
  formatShiftClock,
  formatShiftDuration,
  getCsrfToken,
  mapTaskFromApi,
  readJsonResponse,
  sortMembersByRecentActivity,
  taskAssigneeLabel,
  taskIsAssignedTo,
  toDateKey,
} from "../lib/workspace-format.js";
import { requestDirectMessage } from "../lib/chat-navigation.js";

const isTerminalTask = (task) =>
  task.status === "done" || task.status === "cancelled";
const isOpenTask = (task) => !isTerminalTask(task);
const addDaysToDateKey = (dateKey, days) => {
  const date = new Date(`${dateKey}T12:00:00`);
  date.setDate(date.getDate() + days);
  return toDateKey(date);
};
const isDueSoon = (task, today) =>
  isOpenTask(task) &&
  Boolean(task.due_date) &&
  task.due_date >= today &&
  task.due_date <= addDaysToDateKey(today, 3);
const completionRateForTasks = (tasks) => {
  const tracked = tasks.filter((task) => task.status !== "cancelled");
  if (!tracked.length) return null;
  const completed = tracked.filter((task) => task.status === "done").length;
  return Math.round((completed / tracked.length) * 100);
};
const taskRiskScore = (task, today) => {
  let score = 0;
  if (task.status === "blocked") score += 50;
  if (task.due_date && task.due_date < today && isOpenTask(task)) score += 40;
  if (isDueSoon(task, today)) score += 20;
  if (!task.assignee_id) score += 15;
  if (task.priority === "urgent") score += 10;
  if (task.priority === "high") score += 5;
  return score;
};
const compareTasksForAttention = (today) => (a, b) =>
  taskRiskScore(b, today) - taskRiskScore(a, today) ||
  String(a.due_date || "9999-12-31").localeCompare(
    String(b.due_date || "9999-12-31"),
  ) ||
  String(a.title || "").localeCompare(String(b.title || ""));

// The Today dashboard counts tasks the workspace over, and Team lists
// them. The same words sat in both places with two hand-written filters each, so the
// number and the list behind it were free to disagree - and did: an overdue task
// nobody had picked up was counted by the dashboard, then not shown by the personal
// queue the count linked to, and not shown by the board either because its people
// view only lists tasks a member owns. Both surfaces read their filter from here now,
// so a count and the list it opens are the same question asked twice.
const BOARD_FOCUS = {
  "due-today": (task, today) =>
    isOpenTask(task) && task.due_date === today,
  overdue: (task, today) =>
    isOpenTask(task) && Boolean(task.due_date && task.due_date < today),
  blocked: (task) => task.status === "blocked",
  unassigned: (task) => isOpenTask(task) && !task.assignee_id,
  completed: (task, today) =>
    task.status === "done" &&
    Boolean(task.completed_at) &&
    toDateKey(task.completed_at) === today,
};

const BOARD_FOCUS_LABEL = {
  "due-today": "Due today",
  overdue: "Overdue",
  blocked: "Blocked",
  unassigned: "Unassigned",
  completed: "Completed today",
};

function MemberProfilePopup({
  member,
  onClose,
  onMessage,
  tasks,
  stats,
  tasksLoading = false,
  checkIn,
  shift,
  todayWorkedSeconds = 0,
  today,
  onOpenTask,
}) {
  if (!member) return null;
  const name = [member.first_name, member.last_name].filter(Boolean).join(" ") || member.email;
  const hasWorkDetails = tasks !== undefined || today !== undefined;
  const memberTasks = tasks || [];
  const openTasks = memberTasks.filter(isOpenTask);
  const overdue = openTasks.filter(
    (task) => task.due_date && task.due_date < today,
  );
  const blocked = openTasks.filter((task) => task.status === "blocked");
  const completionRate = completionRateForTasks(memberTasks);
  const openCount = stats ? stats.open : openTasks.length;
  const overdueCount = stats ? stats.overdue : overdue.length;
  const blockedCount = stats ? stats.blocked : blocked.length;
  const resolvedCompletionRate = stats
    ? stats.tracked
      ? Math.round((stats.completed / stats.tracked) * 100)
      : null
    : completionRate;
  const shiftLabel = shift?.is_open
    ? shift.is_on_break
      ? "On break"
      : "Working now"
    : todayWorkedSeconds > 0
      ? "Clocked out"
      : "Not clocked in";
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <section
        className="modal member-profile-popup"
        role="dialog"
        aria-modal="true"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="modal-heading">
          <div>
            <p className="eyebrow">Workspace member</p>
            <h2>{name}</h2>
          </div>
          <button
            type="button"
            className="close-button"
            onClick={onClose}
            aria-label="Close profile"
          >
            <X size={18} />
          </button>
        </div>
        <div className="member-profile-summary">
          <Avatar
            name={name}
            avatarUrl={member.avatar_url}
            presence={effectivePresence(member)}
          />
          <div>
            <strong>{name}</strong>
            <span>
              {member.job_role || member.role || "Member"}
              {member.company ? ` at ${member.company}` : ""}
            </span>
            <small>
              {member.email} | {formatLastSeen(member.last_seen_at)}
            </small>
          </div>
        </div>
        {hasWorkDetails && (
        <div className="member-profile-stats">
          <div>
            <strong>{openCount}</strong>
            <span>Open</span>
          </div>
          <div className={overdueCount ? "is-warning" : ""}>
            <strong>{overdueCount}</strong>
            <span>Overdue</span>
          </div>
          <div className={blockedCount ? "is-danger" : ""}>
            <strong>{blockedCount}</strong>
            <span>Blocked</span>
          </div>
          <div>
            <strong>{resolvedCompletionRate === null ? "n/a" : `${resolvedCompletionRate}%`}</strong>
            <span>Completion</span>
          </div>
        </div>
        )}
        {hasWorkDetails && (
        <div className="member-profile-detail-grid">
          <section className="member-profile-detail">
            <h3>Today&apos;s check-in</h3>
            {checkIn ? (
              <>
                <p className="team-checkin-state is-complete">
                  <CheckCircle2 size={14} /> Submitted
                </p>
                <p>{checkIn.completed || "No completed work summary."}</p>
                {checkIn.next_steps && (
                  <p><strong>Next:</strong> {checkIn.next_steps}</p>
                )}
                {checkIn.blockers && (
                  <p className="team-blocker-note">
                    <AlertTriangle size={13} /> {checkIn.blockers}
                  </p>
                )}
              </>
            ) : (
              <p className="today-muted">No check-in submitted yet.</p>
            )}
          </section>
          <section className="member-profile-detail">
            <h3>Work status</h3>
            <p className={`team-checkin-state ${shift?.is_open ? "is-active" : ""}`}>
              <Clock3 size={14} /> {shiftLabel}
            </p>
            <p>
              {formatShiftDuration(
                shift?.worked_seconds || todayWorkedSeconds || 0,
              )} recorded today
            </p>
          </section>
        </div>
        )}
        {hasWorkDetails && (tasksLoading || openTasks.length > 0) && (
          <section className="member-profile-detail">
            <h3>Priority work</h3>
            {tasksLoading ? (
              <p className="today-muted">Loading priority work...</p>
            ) : (
              <div className="member-profile-task-list">
                {openTasks
                  .sort(compareTasksForAttention(today))
                  .slice(0, 4)
                  .map((task) => (
                    <button
                      type="button"
                      key={task.id}
                      onClick={() => onOpenTask?.(task)}
                    >
                      <span>{task.title}</span>
                      <em>
                        {task.status === "blocked"
                          ? "Blocked"
                          : overdue.some((item) => item.id === task.id)
                            ? "Overdue"
                            : isDueSoon(task, today)
                              ? "Due soon"
                              : task.priority}
                      </em>
                    </button>
                  ))}
              </div>
            )}
          </section>
        )}
        <Button type="button" onClick={() => onMessage(member)}>
          <MessageSquare size={15} /> Send message
        </Button>
      </section>
    </div>
  );
}

function TeamBoardView({
  tasks,
  workspaceId,
  workspaceRole = "member",
  currentUserId,
  taskReloadKey = 0,
  members,
  projects = [],
  checkIns = [],
  workShifts = [],
  scope = "all",
  onScopeChange,
  focus = "all",
  onFocusChange,
  invitations,
  canManageMembers,
  onInvite,
  onComplete,
  onStatusChange,
  onOpenTask,
  onUpdateMemberRole,
  onRemoveMember,
  onCancelInvitation,
  onResendInvitation,
  onNavigate,
}) {
  const today = toDateKey(new Date());
  const [tab, setTab] = useState("overview");
  const [taskGrouping, setTaskGrouping] = useState("owner");
  const [showTerminal, setShowTerminal] = useState(false);
  const [query, setQuery] = useState("");
  const [profileMember, setProfileMember] = useState(null);
  const [serverTasks, setServerTasks] = useState([]);
  const [taskSummary, setTaskSummary] = useState(null);
  const [taskPagination, setTaskPagination] = useState(null);
  const [taskPage, setTaskPage] = useState(1);
  const [taskLoading, setTaskLoading] = useState(false);
  const [taskError, setTaskError] = useState("");
  const [teamTaskReload, setTeamTaskReload] = useState(0);
  const [profileTasks, setProfileTasks] = useState([]);
  const [profileTasksLoading, setProfileTasksLoading] = useState(false);
  const usesServerTasks = Boolean(workspaceId);
  const sourceTasks = usesServerTasks ? serverTasks : tasks;
  const sendMemberMessage = (member) => { requestDirectMessage(member.id); onNavigate("Chats"); };
  const completeTeamTask = (id) =>
    Promise.resolve(onComplete(id)).finally(() =>
      setTeamTaskReload((current) => current + 1),
    );
  const changeTeamTaskStatus = (id, status) =>
    Promise.resolve(onStatusChange(id, status)).finally(() =>
      setTeamTaskReload((current) => current + 1),
    );
  const statuses = [
    ["todo", "To do"],
    ["in progress", "In progress"],
    ["review", "Review"],
    ["blocked", "Blocked"],
    ["on_hold", "On hold"],
    ["cancelled", "Cancelled"],
    ["done", "Done"],
  ];
  const priorities = ["urgent", "high", "normal", "low"];
  const taskSearch =
    tab === "tasks" || tab === "overview" ? query.trim() : "";
  const taskShowTerminal = tab === "tasks" && showTerminal;

  useEffect(() => {
    setTaskPage(1);
  }, [workspaceId, scope, focus, query, showTerminal, tab]);

  useEffect(() => {
    if (!workspaceId) {
      setServerTasks([]);
      setTaskSummary(null);
      setTaskPagination(null);
      setTaskError("");
      return undefined;
    }
    let current = true;
    const timer = window.setTimeout(() => {
      setTaskLoading(true);
      setTaskError("");
      const params = new URLSearchParams({
        page: String(taskPage),
        page_size: "25",
        sort: "attention",
        summary: "true",
      });
      if (scope && scope !== "all") params.set("scope", String(scope));
      if (focus && focus !== "all") params.set("focus", focus);
      if (taskSearch) params.set("search", taskSearch);
      if (!taskShowTerminal) params.set("terminal", "open");
      fetch(`/api/workspaces/${workspaceId}/tasks/?${params.toString()}`, {
        credentials: "include",
        headers: { "X-Workspace-Id": String(workspaceId) },
      })
        .then((response) =>
          readJsonResponse(response, "Team tasks could not be loaded.").then(
            (payload) => ({ ok: response.ok, payload }),
          ),
        )
        .then(({ ok, payload }) => {
          if (!current) return;
          if (!ok) {
            throw new Error(payload.error || "Team tasks could not be loaded.");
          }
          const serverPage = payload.pagination?.page;
          if (serverPage && serverPage !== taskPage) setTaskPage(serverPage);
          setServerTasks(
            (payload.tasks || []).map((task) =>
              mapTaskFromApi(task, {
                today,
                workspaceRole,
                currentUserId,
              }),
            ),
          );
          setTaskSummary(payload.summary || null);
          setTaskPagination(payload.pagination || null);
        })
        .catch((error) => {
          if (current) setTaskError(error.message || "Team tasks could not be loaded.");
        })
        .finally(() => {
          if (current) setTaskLoading(false);
        });
    }, taskSearch ? 250 : 0);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [
    workspaceId,
    taskPage,
    scope,
    focus,
    taskSearch,
    taskShowTerminal,
    today,
    workspaceRole,
    currentUserId,
    teamTaskReload,
    taskReloadKey,
  ]);

  useEffect(() => {
    if (!workspaceId || !profileMember) {
      setProfileTasks([]);
      setProfileTasksLoading(false);
      return undefined;
    }
    let current = true;
    setProfileTasksLoading(true);
    const params = new URLSearchParams({
      owner: String(profileMember.id),
      page_size: "4",
      sort: "attention",
      terminal: "open",
      scope: scope === "all" ? "all" : String(scope),
    });
    fetch(`/api/workspaces/${workspaceId}/tasks/?${params.toString()}`, {
      credentials: "include",
      headers: { "X-Workspace-Id": String(workspaceId) },
    })
      .then((response) =>
        readJsonResponse(response, "Member tasks could not be loaded.").then(
          (payload) => ({ ok: response.ok, payload }),
        ),
      )
      .then(({ ok, payload }) => {
        if (!current) return;
        if (!ok) {
          throw new Error(payload.error || "Member tasks could not be loaded.");
        }
        setProfileTasks(
          (payload.tasks || []).map((task) =>
            mapTaskFromApi(task, {
              today,
              workspaceRole,
              currentUserId,
            }),
          ),
        );
      })
      .catch(() => {
        if (current) setProfileTasks([]);
      })
      .finally(() => {
        if (current) setProfileTasksLoading(false);
      });
    return () => {
      current = false;
    };
  }, [
    workspaceId,
    profileMember,
    scope,
    today,
    workspaceRole,
    currentUserId,
    teamTaskReload,
    taskReloadKey,
  ]);

  const scopedTasks = sourceTasks.filter((task) => taskMatchesScope(task, scope));
  const matching = (key) =>
    scopedTasks.filter((task) => BOARD_FOCUS[key](task, today));
  const openTasks = scopedTasks.filter(isOpenTask);
  const blocked = matching("blocked");
  const overdue = matching("overdue");
  const unassigned = matching("unassigned");
  const normalizedQuery = query.trim().toLowerCase();
  const matchesQuery = (task) =>
    !normalizedQuery ||
    [
      task.title,
      task.description,
      task.member,
      task.tag,
      task.bucket,
      task.workstream,
      task.phase,
      task.blocker_details,
      ...(task.labels || []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery);
  const filtered = scopedTasks.filter(matchesQuery);
  const focused =
    focus === "all" ? [] : usesServerTasks ? filtered : matching(focus);
  const memberName = (member) =>
    [member.first_name, member.last_name].filter(Boolean).join(" ") ||
    member.email;
  const memberMatchesQuery = (member) =>
    !normalizedQuery ||
    [
      memberName(member),
      member.email,
      member.role,
      member.job_role,
      member.company,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery);
  const filteredMembers = members.filter(memberMatchesQuery);
  const copyInvitationLink = (invitation) => {
    if (!invitation.token) return;
    navigator.clipboard?.writeText(
      `${window.location.origin}/?invite=${invitation.token}`,
    );
    toast.success(`Invite link for ${invitation.email} copied.`);
  };
  const tasksForMember = (member, list = scopedTasks) =>
    list.filter((task) => taskIsAssignedTo(task, member.id, memberName(member)));
  const todayCheckIns = checkIns.filter((item) => item.date === today);
  const checkedInIds = new Set(
    todayCheckIns.map((item) => String(item.user_id)),
  );
  const checkedInCount = members.filter((member) =>
    checkedInIds.has(String(member.id)),
  ).length;
  const checkInPercent = members.length
    ? Math.round((checkedInCount / members.length) * 100)
    : 0;
  const checkInForMember = (member) =>
    todayCheckIns.find(
      (item) => String(item.user_id) === String(member.id),
    );
  const openShiftForMember = (member) =>
    workShifts.find(
      (shift) =>
        shift.is_open && String(shift.user_id) === String(member.id),
    );
  const workedTodayForMember = (member) =>
    workShifts
      .filter(
        (shift) =>
          shift.date === today && String(shift.user_id) === String(member.id),
      )
      .reduce((total, shift) => total + (shift.worked_seconds || 0), 0);
  const ownerSummaryById = new Map(
    (taskSummary?.by_owner || []).map((row) => [
      String(row.assignee_id ?? "unassigned"),
      row,
    ]),
  );
  const emptyOwnerSummary = {
    total: 0,
    open: 0,
    overdue: 0,
    blocked: 0,
    due_soon: 0,
    urgent: 0,
    high: 0,
    completed: 0,
    tracked: 0,
  };
  const memberStats = members
    .map((member) => {
      const memberTasks = tasksForMember(member);
      const memberOpen = memberTasks.filter(isOpenTask);
      const fallbackSummary = {
        ...emptyOwnerSummary,
        total: memberTasks.length,
        open: memberOpen.length,
        overdue: memberOpen.filter(
          (task) => task.due_date && task.due_date < today,
        ).length,
        blocked: memberOpen.filter((task) => task.status === "blocked").length,
        due_soon: memberOpen.filter((task) => isDueSoon(task, today)).length,
        urgent: memberOpen.filter((task) => task.priority === "urgent").length,
        high: memberOpen.filter((task) => task.priority === "high").length,
        completed: memberTasks.filter((task) => task.status === "done").length,
        tracked: memberTasks.filter((task) => task.status !== "cancelled").length,
      };
      const summary =
        usesServerTasks && taskSummary
          ? ownerSummaryById.get(String(member.id)) || emptyOwnerSummary
          : fallbackSummary;
      const risk =
        summary.blocked * 5 +
        summary.overdue * 4 +
        summary.due_soon * 2 +
        summary.urgent * 2 +
        summary.high;
      return {
        member,
        tasks: memberTasks,
        open: summary.open,
        overdue: summary.overdue,
        blocked: summary.blocked,
        dueSoon: summary.due_soon,
        completed: summary.completed,
        tracked: summary.tracked,
        completionRate: summary.tracked
          ? Math.round((summary.completed / summary.tracked) * 100)
          : null,
        risk,
      };
    })
    .sort(
      (a, b) =>
        b.risk - a.risk ||
        b.open - a.open ||
        memberName(a.member).localeCompare(memberName(b.member)),
    );
  const visibleMemberStats = memberStats.filter((item) =>
    memberMatchesQuery(item.member),
  );
  const riskTasks = (usesServerTasks ? filtered : openTasks.filter(matchesQuery))
    .filter(matchesQuery)
    .sort(compareTasksForAttention(today))
    .slice(0, 6);
  const summaryCounts = taskSummary?.counts || {
    open: openTasks.length,
    blocked: blocked.length,
    overdue: overdue.length,
    unassigned: unassigned.length,
  };
  const focusedCount = usesServerTasks
    ? taskPagination?.total_items || 0
    : focused.length;
  const teamTaskTotal =
    taskPagination?.total_items ?? (focus === "all" ? filtered.length : focusedCount);
  const teamTaskPage = taskPagination?.page || taskPage;
  const teamTaskPages = taskPagination?.total_pages || 1;
  const teamTaskPageSize = taskPagination?.page_size || 25;
  const teamTaskRangeStart = teamTaskTotal
    ? (teamTaskPage - 1) * teamTaskPageSize + 1
    : 0;
  const teamTaskRangeEnd = Math.min(
    teamTaskPage * teamTaskPageSize,
    teamTaskTotal,
  );
  const workloadWatch = memberStats.filter((item) => item.risk > 0).slice(0, 5);
  const presenceCounts = PRESENCE_OPTIONS.reduce((counts, presence) => {
    counts[presence] = members.filter(
      (member) => effectivePresence(member) === presence,
    ).length;
    return counts;
  }, {});
  const workingNowCount = members.filter((member) =>
    openShiftForMember(member),
  ).length;
  const taskSorter = compareTasksForAttention(today);
  const visibleTaskRows = filtered
    .filter((task) => showTerminal || isOpenTask(task))
    .sort(taskSorter);
  const groupedTasks = (items, keyFor, labelFor) => {
    const groups = new Map();
    items.forEach((task) => {
      const key = keyFor(task);
      if (!groups.has(key)) groups.set(key, { key, label: labelFor(task), tasks: [] });
      groups.get(key).tasks.push(task);
    });
    return [...groups.values()].sort((a, b) =>
      a.label.localeCompare(b.label),
    );
  };
  const ownerGroups = groupedTasks(
    visibleTaskRows,
    (task) => String(task.assignee_id || "unassigned"),
    (task) => (task.assignee_id ? taskAssigneeLabel(task) : "Unassigned"),
  );
  const statusGroups = statuses
    .filter(
      ([value]) => showTerminal || !["cancelled", "done"].includes(value),
    )
    .map(([value, label]) => ({
      key: value,
      label,
      tasks: visibleTaskRows.filter((task) => task.status === value),
    }));
  const priorityGroups = priorities.map((value) => ({
    key: value,
    label: value,
    tasks: visibleTaskRows.filter((task) => task.priority === value),
  }));
  const projectGroups = groupedTasks(
    visibleTaskRows,
    (task) => task.tag || "General",
    (task) => task.tag || "General",
  );
  const taskGroups = {
    owner: ownerGroups,
    status: statusGroups,
    priority: priorityGroups,
    project: projectGroups,
  }[taskGrouping] || ownerGroups;
  const teamTabs = [
    { id: "overview", label: "Overview", icon: LayoutDashboard },
    { id: "workload", label: "Workload", icon: Users },
    { id: "tasks", label: "Tasks", icon: ListChecks },
    { id: "availability", label: "Availability", icon: CalendarCheck2 },
    ...(canManageMembers
      ? [{ id: "people", label: "People & access", icon: ShieldCheck }]
      : []),
  ];
  const activeTab =
    tab === "people" && !canManageMembers ? "overview" : tab;
  const taskLabel = (task) =>
    task.status === "cancelled"
      ? "Cancelled"
      : task.due_date && task.due_date < today && isOpenTask(task)
      ? "Overdue"
      : task.due_date === today && isOpenTask(task)
        ? "Due today"
        : task.status === "in progress"
          ? "In progress"
          : task.status;
  const taskList = (list, emptyText = "No tasks in this view.") =>
    list.length ? (
      list.map((task) => {
        const isDone = task.status === "done";
        const isCancelled = task.status === "cancelled";
        return (
          <article className={`team-task-row ${task.status}`} key={task.id}>
            <button
              type="button"
              role="checkbox"
              aria-checked={isDone}
              aria-disabled={isCancelled}
              disabled={isCancelled}
              className={`check ${isDone ? "checked" : ""}`}
              onClick={() => !isCancelled && completeTeamTask(task.id)}
              aria-label={
                isCancelled
                  ? `Cancelled ${task.title}`
                  : `${isDone ? "Reopen" : "Complete"} ${task.title}`
              }
              title={
                isCancelled
                  ? "Reopen this task from its status control first"
                  : isDone
                    ? "Reopen task"
                    : "Mark task complete"
              }
            >
              {isCancelled ? (
                <CircleSlash size={13} aria-hidden="true" />
              ) : (
                <Check
                  className="task-check-mark"
                  size={13}
                  strokeWidth={3}
                  aria-hidden="true"
                />
              )}
            </button>
            <div>
              <button type="button" onClick={() => onOpenTask(task)}>
                {task.title}
              </button>
              <span title={task.blocker_details || undefined}>
                {taskAssigneeLabel(task) || "Unassigned"} | {taskLabel(task)}
                {task.progress_percent ? ` | ${task.progress_percent}%` : ""}
              </span>
            </div>
            <span className={`my-task-priority ${task.priority}`}>
              {task.priority}
            </span>
            <AppSelect
              className={`task-status task-status-select ${task.status}`}
              value={task.status}
              onChange={(event) =>
                changeTeamTaskStatus(task.id, event.target.value)
              }
              aria-label={`Change status for ${task.title}`}
            >
              <option value="todo">To do</option>
              <option value="in progress">In progress</option>
              <option value="review">Review</option>
              <option value="blocked">Blocked</option>
              <option value="on_hold">On hold</option>
              <option value="cancelled">Cancelled</option>
              <option value="done">Done</option>
            </AppSelect>
          </article>
        );
      })
    ) : (
      <p className="today-muted">{emptyText}</p>
    );
  return (
    <section className="workspace-view team-board-view">
      <WorkspaceViewHeading
        title="Team"
        subtitle="See workload, availability, and the work that needs attention."
        action={canManageMembers ? "Invite team member" : undefined}
        onAction={onInvite}
      />
      <div className="team-board-metrics">
        <button
          className={focus === "all" ? "active" : ""}
          onClick={() => onFocusChange("all")}
        >
          <strong>{summaryCounts.open}</strong>
          <span>Open tasks</span>
        </button>
        {["blocked", "overdue", "unassigned"].map((key) => {
          const count = summaryCounts[key];
          return (
            <button
              key={key}
              className={`${count ? "attention " : ""}${focus === key ? "active" : ""}`}
              onClick={() => onFocusChange(focus === key ? "all" : key)}
            >
              <strong>{count}</strong>
              <span>{BOARD_FOCUS_LABEL[key]}</span>
            </button>
          );
        })}
      </div>
      <div className="team-board-toolbar">
        <div className="team-board-toolbar-main">
          <WorkScopeSelector
            compact
            value={scope}
            onChange={onScopeChange}
            projects={projects}
            label="Scope"
          />
          <div className="team-board-tabs" role="tablist" aria-label="Team views">
            {teamTabs.map(({ id, label, icon: TabIcon }) => (
              <button
                type="button"
                role="tab"
                aria-selected={focus === "all" && activeTab === id}
                key={id}
                className={focus === "all" && activeTab === id ? "active" : ""}
                onClick={() => {
                  setTab(id);
                  if (focus !== "all") onFocusChange("all");
                }}
              >
                <TabIcon size={14} aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
        </div>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={
            activeTab === "tasks" || activeTab === "overview"
              ? "Search tasks"
              : "Search team"
          }
          aria-label={
            activeTab === "tasks" || activeTab === "overview"
              ? "Search team tasks"
              : "Search team members"
          }
        />
      </div>
      {activeTab === "tasks" && focus === "all" && (
        <div className="team-task-controls">
          <label>
            Group tasks
            <AppSelect
              value={taskGrouping}
              onChange={(event) => setTaskGrouping(event.target.value)}
              aria-label="Group tasks"
            >
              <option value="owner">By owner</option>
              <option value="status">By status</option>
              <option value="priority">By priority</option>
              <option value="project">By project</option>
            </AppSelect>
          </label>
          <button
            type="button"
            className={showTerminal ? "active" : ""}
            aria-pressed={showTerminal}
            onClick={() => setShowTerminal((current) => !current)}
          >
            <CheckCircle2 size={14} />
            {showTerminal ? "Hide closed work" : "Show closed work"}
          </button>
        </div>
      )}
      {focus !== "all" && (
        <div className="team-board-columns">
          <section className="team-board-column">
            <div className="team-column-heading team-focus-heading">
              <h2>{BOARD_FOCUS_LABEL[focus]}</h2>
              <span>{focusedCount}</span>
              <button
                type="button"
                className="text-button team-focus-clear"
                onClick={() => onFocusChange("all")}
              >
                Clear <X size={13} />
              </button>
            </div>
            <div className="team-task-list">
              {taskList(focused.filter(matchesQuery))}
            </div>
          </section>
        </div>
      )}
      {focus === "all" && activeTab === "overview" && (
        <div className="team-overview-grid">
          <section className="team-overview-panel team-risk-panel">
            <div className="today-panel-heading">
              <div>
                <h2>Highest-risk work</h2>
                <p>Blocked, overdue, unowned, and due-soon work first.</p>
              </div>
              <span className="team-panel-count">Top {riskTasks.length}</span>
            </div>
            <div className="team-task-list">
              {taskList(riskTasks, "No open work needs attention.")}
            </div>
          </section>
          <div className="team-overview-stack">
            <section className="team-overview-panel">
              <div className="today-panel-heading">
                <div>
                  <h2>Check-in progress</h2>
                  <p>Today&apos;s updates from the team.</p>
                </div>
                <strong className="team-panel-value">
                  {checkedInCount}/{members.length}
                </strong>
              </div>
              <div className="team-checkin-progress">
                <i style={{ width: `${checkInPercent}%` }} />
              </div>
              <div className="team-checkin-roster">
                {filteredMembers.slice(0, 6).map((member) => {
                  const complete = checkedInIds.has(String(member.id));
                  return (
                    <button
                      type="button"
                      className={complete ? "is-complete" : ""}
                      key={member.id}
                      onClick={() => setProfileMember(member)}
                    >
                      <Avatar
                        name={memberName(member)}
                        avatarUrl={member.avatar_url}
                        presence={effectivePresence(member)}
                        small
                      />
                      <span>{memberName(member)}</span>
                      {complete ? <CheckCircle2 size={13} /> : <Clock3 size={13} />}
                    </button>
                  );
                })}
                {!members.length && <EmptyState text="No team members yet." />}
              </div>
            </section>
            <section className="team-overview-panel">
              <div className="today-panel-heading">
                <div>
                  <h2>Workload watch</h2>
                  <p>People with the highest current risk.</p>
                </div>
                <span className="team-panel-count">Top {workloadWatch.length}</span>
              </div>
              {workloadWatch.length ? (
                <div className="team-watch-list">
                  {workloadWatch.map((item) => (
                    <button
                      type="button"
                      key={item.member.id}
                      onClick={() => setProfileMember(item.member)}
                    >
                      <span>{memberName(item.member)}</span>
                      <em>
                        {item.blocked} blocked | {item.overdue} overdue
                      </em>
                      <strong>{item.open} open</strong>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="today-muted">No workload pressure detected.</p>
              )}
              <div className="team-presence-strip">
                {PRESENCE_OPTIONS.map((presence) => (
                  <span key={presence}>
                    <i className={`presence-${presence}`} />
                    {PRESENCE_LABEL[presence]} {presenceCounts[presence] || 0}
                  </span>
                ))}
              </div>
            </section>
          </div>
        </div>
      )}
      {focus === "all" && activeTab === "workload" && (
        <div className="team-workload-list">
          {visibleMemberStats.map((item) => (
            <button
              type="button"
              className={`team-workload-card ${item.risk ? "is-at-risk" : ""}`}
              key={item.member.id}
              onClick={() => setProfileMember(item.member)}
              aria-label={`Open workload for ${memberName(item.member)}`}
            >
              <div className="team-workload-heading">
                <Avatar
                  name={memberName(item.member)}
                  avatarUrl={item.member.avatar_url}
                  presence={effectivePresence(item.member)}
                />
                <div>
                  <h2>{memberName(item.member)}</h2>
                  <span>
                    {item.member.job_role || item.member.role || "Member"} |{" "}
                    {formatLastSeen(item.member.last_seen_at)}
                  </span>
                </div>
                <em className={item.risk ? "is-warning" : ""}>
                  {item.risk ? `${item.risk} risk` : "Clear"}
                </em>
              </div>
              <div className="team-workload-stats">
                <div>
                  <strong>{item.open}</strong>
                  <span>Open</span>
                </div>
                <div className={item.overdue ? "is-warning" : ""}>
                  <strong>{item.overdue}</strong>
                  <span>Overdue</span>
                </div>
                <div className={item.blocked ? "is-danger" : ""}>
                  <strong>{item.blocked}</strong>
                  <span>Blocked</span>
                </div>
                <div className={item.dueSoon ? "is-info" : ""}>
                  <strong>{item.dueSoon}</strong>
                  <span>Due soon</span>
                </div>
              </div>
              <div className="team-completion">
                <div>
                  <span>Completion rate</span>
                  <strong>
                    {item.completionRate === null
                      ? "No tracked work"
                      : `${item.completionRate}%`}
                  </strong>
                </div>
                <div className="team-member-progress">
                  <i style={{ width: `${item.completionRate || 0}%` }} />
                </div>
              </div>
            </button>
          ))}
          {!visibleMemberStats.length && (
            <EmptyState text="No team members match this search." />
          )}
        </div>
      )}
      {focus === "all" && activeTab === "tasks" && (
        <>
          {taskGroups.length ? (
            <div className="team-board-columns">
              {taskGroups.map((group) => (
                <section className="team-board-column" key={group.key}>
                  <div className="team-column-heading">
                    <h2>{group.label}</h2>
                    <span>{group.tasks.length}</span>
                  </div>
                  <div className="team-task-list">
                    {taskList(group.tasks, "No work in this group.")}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <EmptyState text="No tasks match this view." />
          )}
        </>
      )}
      {usesServerTasks && (focus !== "all" || activeTab === "tasks") && (
        <div
          className="planner-pagination team-task-pagination"
          aria-busy={taskLoading}
        >
          <span>
            {taskLoading
              ? "Loading tasks..."
              : teamTaskTotal
                ? `${teamTaskRangeStart}-${teamTaskRangeEnd} of ${teamTaskTotal}`
                : "0 tasks"}
          </span>
          <div>
            <button
              type="button"
              disabled={taskLoading || teamTaskPage <= 1}
              onClick={() => setTaskPage((current) => Math.max(1, current - 1))}
              aria-label="Previous team task page"
            >
              <ChevronLeft size={15} />
            </button>
            <span>
              Page {teamTaskPage} of {teamTaskPages}
            </span>
            <button
              type="button"
              disabled={
                taskLoading || teamTaskPage >= teamTaskPages || !taskPagination?.has_next
              }
              onClick={() => setTaskPage((current) => current + 1)}
              aria-label="Next team task page"
            >
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
      )}
      {taskError && (
        <p className="today-muted team-task-error" role="alert">
          {taskError}
        </p>
      )}
      {focus === "all" && activeTab === "availability" && (
        <>
          <div className="team-availability-summary">
            <div>
              <span>Check-ins today</span>
              <strong>{checkedInCount} of {members.length}</strong>
            </div>
            <div>
              <span>Working now</span>
              <strong>{workingNowCount}</strong>
            </div>
            <div className="team-checkin-progress">
              <i style={{ width: `${checkInPercent}%` }} />
            </div>
          </div>
          <div className="team-availability-grid">
            {visibleMemberStats.map((item) => {
              const checkIn = checkInForMember(item.member);
              const shift = openShiftForMember(item.member);
              const workedToday = workedTodayForMember(item.member);
              return (
                <article className="team-availability-card" key={item.member.id}>
                  <button
                    type="button"
                    className="team-member-heading"
                    onClick={() => setProfileMember(item.member)}
                    aria-label={`Open profile for ${memberName(item.member)}`}
                  >
                    <Avatar
                      name={memberName(item.member)}
                      avatarUrl={item.member.avatar_url}
                      presence={effectivePresence(item.member)}
                      small
                    />
                    <div>
                      <h2>{memberName(item.member)}</h2>
                      <span>
                        {PRESENCE_LABEL[effectivePresence(item.member)]} |{" "}
                        {formatLastSeen(item.member.last_seen_at)}
                      </span>
                    </div>
                    <em className={shift?.is_open ? "is-working" : ""}>
                      {shift
                        ? shift.is_on_break
                          ? "On break"
                          : "Working"
                        : "Not clocked in"}
                    </em>
                  </button>
                  <div className="team-availability-chips">
                    <span className={checkIn ? "is-complete" : "is-pending"}>
                      {checkIn ? <CheckCircle2 size={13} /> : <Clock3 size={13} />}
                      {checkIn ? "Check-in submitted" : "Check-in pending"}
                    </span>
                    {workedToday > 0 && (
                      <span>
                        <Clock3 size={13} />
                        {formatShiftDuration(workedToday)} today
                      </span>
                    )}
                  </div>
                  {checkIn?.blockers ? (
                    <p className="team-blocker-note">
                      <AlertTriangle size={13} /> {checkIn.blockers}
                    </p>
                  ) : checkIn?.next_steps ? (
                    <p className="team-availability-note">
                      <strong>Next:</strong> {checkIn.next_steps}
                    </p>
                  ) : (
                    <p className="today-muted">No availability note submitted.</p>
                  )}
                </article>
              );
            })}
            {!visibleMemberStats.length && (
              <EmptyState text="No team members match this search." />
            )}
          </div>
        </>
      )}
      {focus === "all" && activeTab === "people" && canManageMembers && (
      <section className="team-access-panel">
        <div className="today-panel-heading">
          <div>
            <h2>People & access</h2>
            <p>Manage workspace membership and pending invitations.</p>
          </div>
        </div>
        {members.map((member) => (
          <div className="team-access-row" key={member.id}>
            <Avatar
              name={memberName(member)}
              avatarUrl={member.avatar_url}
              presence={effectivePresence(member)}
              small
            />
            <div>
              <strong>{memberName(member)}</strong>
              <span>
                {member.email} · {formatLastSeen(member.last_seen_at)}
              </span>
            </div>
            {canManageMembers && member.role !== "owner" ? (
              <>
                <AppSelect
                  value={member.role}
                  onChange={(event) =>
                    onUpdateMemberRole(member, event.target.value)
                  }
                  aria-label={`Change role for ${member.email}`}
                >
                  <option value="member">Member</option>
                  <option value="manager">Manager</option>
                </AppSelect>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => onRemoveMember(member)}
                  aria-label={`Remove ${member.email}`}
                >
                  <X size={14} />
                </Button>
              </>
            ) : (
              <em>{member.role}</em>
            )}
          </div>
        ))}
        {invitations
          .filter(
            (item) => item.status === "pending" || item.status === "expired",
          )
          .map((invitation) => (
            <div className="team-access-row" key={`invite-${invitation.id}`}>
              <span className="invite-dot" />
              <div>
                <strong>{invitation.email}</strong>
                <span>
                  Invited as {invitation.role} on{" "}
                  {formatDate(invitation.created_at)} ·
                  Expires {formatDate(invitation.expires_at)}
                </span>
              </div>
              <em
                className={`invitation-status-badge ${invitation.status === "expired" ? "is-expired" : "is-pending"}`}
              >
                {invitation.status === "expired" ? "Expired" : "Pending"}
              </em>
              {canManageMembers && (
                <div className="team-access-actions">
                  {invitation.token && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => copyInvitationLink(invitation)}
                      aria-label={`Copy invite link for ${invitation.email}`}
                      title="Copy invite link"
                    >
                      <Copy size={14} />
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onResendInvitation(invitation)}
                    aria-label={`Resend invitation for ${invitation.email}`}
                    title="Resend invitation"
                  >
                    Resend
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => onCancelInvitation(invitation)}
                    aria-label={`Revoke invitation for ${invitation.email}`}
                    title="Revoke invitation"
                  >
                    <X size={14} />
                  </Button>
                </div>
              )}
            </div>
          ))}
      </section>
      )}
      <MemberProfilePopup
        member={profileMember}
        onClose={() => setProfileMember(null)}
        onMessage={sendMemberMessage}
        tasks={
          profileMember
            ? usesServerTasks
              ? profileTasks
              : tasksForMember(profileMember)
            : []
        }
        stats={
          profileMember
            ? memberStats.find(
                (item) => String(item.member.id) === String(profileMember.id),
              ) || null
            : null
        }
        tasksLoading={profileTasksLoading}
        checkIn={profileMember ? checkInForMember(profileMember) : null}
        shift={profileMember ? openShiftForMember(profileMember) : null}
        todayWorkedSeconds={
          profileMember ? workedTodayForMember(profileMember) : 0
        }
        today={today}
        onOpenTask={(task) => {
          setProfileMember(null);
          onOpenTask(task);
        }}
      />
    </section>
  );
}

function MyTasksView({
  tasks,
  currentUserId,
  currentUserName,
  projects,
  buckets,
  onAddTask,
  onOpenTask,
  onComplete,
  onStatusChange,
  onDelete,
  canManageTasks,
}) {
  const today = toDateKey(new Date());
  const [view, setView] = useState("all");
  const [status, setStatus] = useState("all");
  const [priority, setPriority] = useState("all");
  const [project, setProject] = useState("all");
  const [bucket, setBucket] = useState("all");
  const [sort, setSort] = useState("priority");
  const [query, setQuery] = useState("");
  const mine = tasks.filter((task) =>
    taskIsAssignedTo(task, currentUserId, currentUserName),
  );
  const isOpen = (task) => task.status !== "done";
  const overdue = (task) =>
    Boolean(task.due_date && task.due_date < today && isOpen(task));
  const dueToday = (task) => task.due_date === today && isOpen(task);
  const counts = {
    all: mine.filter(isOpen).length,
    today: mine.filter(dueToday).length,
    upcoming: mine.filter((task) => task.due_date > today && isOpen(task))
      .length,
    overdue: mine.filter(overdue).length,
    blocked: mine.filter((task) => task.status === "blocked").length,
    completed: mine.filter((task) => task.status === "done").length,
  };
  const priorityRank = { urgent: 0, high: 1, normal: 2, low: 3 };
  const visible = mine
    .filter((task) => {
      const text = [
        task.title,
        task.description,
        task.tag,
        task.bucket,
        ...(task.labels || []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const matchesView =
        view === "all"
          ? isOpen(task)
          : view === "today"
            ? dueToday(task)
            : view === "upcoming"
              ? Boolean(task.due_date && task.due_date > today && isOpen(task))
              : view === "overdue"
                ? overdue(task)
                : view === "blocked"
                  ? task.status === "blocked"
                  : task.status === "done";
      return (
        matchesView &&
        (status === "all" || task.status === status) &&
        (priority === "all" || task.priority === priority) &&
        (project === "all" || String(task.project_id || "") === project) &&
        (bucket === "all" || task.bucket === bucket) &&
        (!query.trim() || text.includes(query.trim().toLowerCase()))
      );
    })
    .sort((a, b) => {
      if (sort === "due")
        return (
          (a.due_date || "9999-12-31").localeCompare(
            b.due_date || "9999-12-31",
          ) || (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9)
        );
      if (sort === "recent")
        return (
          String(b.completed_at || "").localeCompare(
            String(a.completed_at || ""),
          ) || b.id - a.id
        );
      return (
        (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9) ||
        (a.due_date || "9999-12-31").localeCompare(
          b.due_date || "9999-12-31",
        ) ||
        a.id - b.id
      );
    });
  const groups =
    view === "all"
      ? [{ label: "Active work", items: visible }]
      : [
          {
            label:
              view === "completed"
                ? "Completed"
                : view[0].toUpperCase() + view.slice(1),
            items: visible,
          },
        ];
  const viewTabs = [
    ["all", "Inbox"],
    ["today", "Today"],
    ["upcoming", "Upcoming"],
    ["overdue", "Overdue"],
    ["blocked", "Blocked"],
    ["completed", "Completed"],
  ];
  return (
    <section className="workspace-view my-tasks-view">
      <WorkspaceViewHeading
        title="My tasks"
        subtitle="A focused queue of work assigned to you."
        action="Add task"
        onAction={onAddTask}
      />
      <div className="my-task-summary">
        {viewTabs.slice(0, 4).map(([key, label]) => (
          <button
            key={key}
            className={view === key ? "active" : ""}
            onClick={() => setView(key)}
          >
            <strong>{counts[key]}</strong>
            <span>{label}</span>
          </button>
        ))}
      </div>
      <div className="my-task-toolbar">
        <div className="my-task-tabs">
          {viewTabs.map(([key, label]) => (
            <button
              key={key}
              className={view === key ? "active" : ""}
              onClick={() => setView(key)}
            >
              {label}
              <span>{counts[key]}</span>
            </button>
          ))}
        </div>
        <div className="my-task-filters">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search my tasks"
            aria-label="Search my tasks"
          />
          <AppSelect
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            aria-label="Filter by status"
          >
            <option value="all">All statuses</option>
            <option value="todo">To do</option>
            <option value="in progress">In progress</option>
            <option value="review">Review</option>
            <option value="blocked">Blocked</option>
            <option value="on_hold">On hold</option>
            <option value="cancelled">Cancelled</option>
            <option value="done">Done</option>
          </AppSelect>
          <AppSelect
            value={priority}
            onChange={(event) => setPriority(event.target.value)}
            aria-label="Filter by priority"
          >
            <option value="all">All priorities</option>
            {["urgent", "high", "normal", "low"].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </AppSelect>
          <AppSelect
            value={project}
            onChange={(event) => setProject(event.target.value)}
            aria-label="Filter by project"
          >
            <option value="all">All projects</option>
            {projects.map((item) => (
              <option key={item.id} value={String(item.id)}>
                {item.name}
              </option>
            ))}
          </AppSelect>
          <AppSelect
            value={bucket}
            onChange={(event) => setBucket(event.target.value)}
            aria-label="Filter by bucket"
          >
            <option value="all">All buckets</option>
            {buckets.map((item) => (
              <option key={item.id} value={item.name}>
                {item.name}
              </option>
            ))}
          </AppSelect>
          <AppSelect
            value={sort}
            onChange={(event) => setSort(event.target.value)}
            aria-label="Sort tasks"
          >
            <option value="priority">Sort: Priority</option>
            <option value="due">Sort: Due date</option>
            <option value="recent">Sort: Recently completed</option>
          </AppSelect>
        </div>
      </div>
      <div className="my-task-results">
        {groups.map((group) => (
          <section key={group.label} className="my-task-group">
            <div className="my-task-group-heading">
              <h2>{group.label}</h2>
              <span>{group.items.length}</span>
            </div>
            {group.items.length ? (
              group.items.map((task) => (
                <article
                  className={`my-task-row ${task.status} ${overdue(task) ? "overdue" : ""}`}
                  key={task.id}
                >
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={task.status === "done"}
                    className={`check ${task.status === "done" ? "checked" : ""}`}
                    onClick={() => onComplete(task.id)}
                    aria-label={`${task.status === "done" ? "Reopen" : "Complete"} ${task.title}`}
                    title={task.status === "done" ? "Reopen task" : "Mark task complete"}
                  >
                    <Check className="task-check-mark" size={13} strokeWidth={3} aria-hidden="true" />
                  </button>
                  <div className="my-task-row-copy">
                    <button type="button" onClick={() => onOpenTask(task)}>
                      {task.title}
                    </button>
                    <span>
                      {task.tag || "General"} · {task.bucket || "Backlog"}
                      {task.due_date
                        ? ` · Due ${formatDay(task.due_date)}`
                        : " · No due date"}
                    </span>
                  </div>
                  <span className={`my-task-priority ${task.priority}`}>
                    {task.priority}
                  </span>
                  <AppSelect
                    className={`task-status task-status-select ${task.status}`}
                    value={task.status}
                    onChange={(event) =>
                      onStatusChange(task.id, event.target.value)
                    }
                    aria-label={`Change status for ${task.title}`}
                  >
                    <option value="todo">To do</option>
                    <option value="in progress">In progress</option>
                    <option value="review">Review</option>
                    <option value="blocked">Blocked</option>
                    <option value="on_hold">On hold</option>
                    <option value="cancelled">Cancelled</option>
                    <option value="done">Done</option>
                  </AppSelect>
                  {canManageTasks && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => onDelete(task.id)}
                      aria-label={`Archive ${task.title}`}
                      title="Archive task"
                    >
                      <Archive size={14} />
                    </Button>
                  )}
                </article>
              ))
            ) : (
              <div className="my-task-empty">
                <CheckCircle2 size={18} />
                <p>
                  {view === "overdue"
                    ? "No overdue work."
                    : view === "completed"
                      ? "No completed tasks yet."
                      : "Nothing in this view."}
                </p>
                {view === "all" && (
                  <button className="text-button" onClick={onAddTask}>
                    Add your first task <ArrowUpRight size={14} />
                  </button>
                )}
              </div>
            )}
          </section>
        ))}
      </div>
    </section>
  );
}

function ProjectProgress({ project, tasks }) {
  // The project list carries the server's counts, which leave out cancelled and
  // archived tasks. Those are the numbers the health badge and the stat row on
  // this same card are drawn from, so counting separately here made the bar
  // disagree with both of them. Counting from tasks is the fallback for a
  // project that arrived without metrics.
  const metrics = project.metrics;
  const projectTasks = metrics
    ? null
    : tasks.filter((task) => String(task.project_id || "") === String(project.id));
  const totalTasks = metrics ? metrics.applicable_tasks : projectTasks.length;
  const completedTasks = metrics
    ? metrics.completed_tasks
    : projectTasks.filter((task) => task.status === "done").length;
  const completionPercent = metrics
    ? metrics.completion_rate
    : totalTasks
      ? Math.round((completedTasks / totalTasks) * 100)
      : 0;

  return (
    <div
      className="project-progress"
      aria-label={`${completedTasks} of ${totalTasks} project tasks completed`}
    >
      <div className="project-progress-label">
        <span>
          {totalTasks
            ? `${completedTasks} of ${totalTasks} tasks complete`
            : "No tasks linked yet"}
        </span>
        <strong>{completionPercent}%</strong>
      </div>
      <div
        className="project-progress-track"
        role="progressbar"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={completionPercent}
      >
        <span style={{ width: `${completionPercent}%` }} />
      </div>
    </div>
  );
}

function ProjectOperationsSummary({ project, workspaceId, onOpen }) {
  const [summary, setSummary] = useState({
    expenses: [],
    resources: [],
    records: [],
  });
  useEffect(() => {
    if (!project?.id || !workspaceId) return;
    Promise.all([
      fetch(`/api/workspaces/${workspaceId}/projects/${project.id}/expenses/`, {
        credentials: "include",
      }),
      fetch(
        `/api/workspaces/${workspaceId}/projects/${project.id}/resources/`,
        { credentials: "include" },
      ),
      fetch(
        `/api/workspaces/${workspaceId}/risks-issues/?project_id=${project.id}`,
        { credentials: "include" },
      ),
    ])
      .then(async (responses) => {
        const payloads = await Promise.all(
          responses.map((response) => response.json()),
        );
        if (responses.every((response) => response.ok))
          setSummary({
            expenses: payloads[0].expenses || [],
            resources: payloads[1].resources || [],
            records: payloads[2].records || [],
          });
      })
      .catch((error) => {
        console.warn("Project operational summary could not be loaded.", error);
      });
  }, [project?.id, workspaceId]);
  const actual = summary.expenses
    .filter((item) => !item.is_committed)
    .reduce((total, item) => total + Number(item.amount || 0), 0);
  const committed = summary.expenses
    .filter((item) => item.is_committed)
    .reduce((total, item) => total + Number(item.amount || 0), 0);
  const remaining =
    project.budget_amount === null || project.budget_amount === undefined
      ? null
      : Number(project.budget_amount) - actual - committed;
  const highRisks = summary.records.filter(
    (item) =>
      item.kind === "risk" &&
      ["high", "critical"].includes(item.severity) &&
      item.status !== "closed",
  ).length;
  const overdueMitigations = summary.records.filter(
    (item) =>
      item.kind === "risk" &&
      item.due_date &&
      item.due_date < toDateKey(new Date()) &&
      !["mitigated", "closed"].includes(item.status),
  ).length;
  const conflicts = summary.resources.filter(
    (item) =>
      item.capacity_percent !== null &&
      item.allocation_percent > item.capacity_percent,
  ).length;
  const currency = project.budget_currency || "USD";
  const money = (value) =>
    new Intl.NumberFormat(undefined, { style: "currency", currency }).format(
      value || 0,
    );
  return (
    <div className="project-detail-links project-operation-summary">
      <button type="button" onClick={() => onOpen("budget")}>
        <strong>Budget & costs</strong>
        <span>
          {remaining === null
            ? `${summary.expenses.length} cost entries`
            : `${money(remaining)} remaining`}
        </span>
      </button>
      <button type="button" onClick={() => onOpen("resources")}>
        <strong>Resources</strong>
        <span>
          {summary.resources.length} resources, {conflicts} conflicts
        </span>
      </button>
      <button type="button" onClick={() => onOpen("risks")}>
        <strong>Risks & issues</strong>
        <span>
          {highRisks} high risks, {overdueMitigations} overdue mitigations
        </span>
      </button>
    </div>
  );
}

function ProjectRiskIssuePanel({
  projects,
  workspaceId,
  hidden = false,
  tasks = [],
  canManage = false,
}) {
  const [projectId, setProjectId] = useState(() => projects[0]?.id || "");
  const [records, setRecords] = useState([]);
  const [activeTab, setActiveTab] = useState("risk");
  const [modalOpen, setModalOpen] = useState(false);
  const [kind, setKind] = useState("risk");
  const [form, setForm] = useState({
    title: "",
    detail: "",
    severity: "medium",
    likelihood: "",
    impact: "",
    mitigation: "",
    escalation: "",
    owner: "",
    due: "",
    task_id: "",
  });
  useEffect(() => {
    if (!projectId && projects[0]) setProjectId(projects[0].id);
  }, [projects, projectId]);
  useEffect(() => {
    if (!workspaceId || !projectId) return setRecords([]);
    fetch(
      `/api/workspaces/${workspaceId}/risks-issues/?project_id=${projectId}`,
      {
        credentials: "include",
        headers: { "X-Workspace-Id": String(workspaceId) },
      },
    )
      .then((response) =>
        readJsonResponse(
          response,
          "Risk and issue records could not be loaded.",
        ).then((data) => ({ response, data })),
      )
      .then(({ response, data }) => {
        if (!response.ok) throw new Error(data.error);
        setRecords(data.records || []);
      })
      .catch((error) =>
        toast.error(
          error.message || "Risk and issue records could not be loaded.",
        ),
      );
  }, [workspaceId, projectId]);
  useEffect(() => {
    const selectRegisterTab = (event) => {
      if (event.detail === "risk" || event.detail === "issue")
        setActiveTab(event.detail);
    };
    window.addEventListener("project-register:tab", selectRegisterTab);
    return () =>
      window.removeEventListener("project-register:tab", selectRegisterTab);
  }, []);
  const items = records;
  const openAddModal = () => {
    setKind(activeTab);
    setModalOpen(true);
  };
  const addRecord = async (event) => {
    event.preventDefault();
    if (!projectId || !form.title.trim()) return;
    const response = await fetch(
      `/api/workspaces/${workspaceId}/risks-issues/`,
      {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": await getCsrfToken(),
          "X-Workspace-Id": String(workspaceId),
        },
        body: JSON.stringify({
          project_id: projectId,
          kind,
          title: form.title.trim(),
          detail: form.detail.trim(),
          severity: form.severity,
          likelihood: form.likelihood || null,
          impact: form.impact || null,
          mitigation: form.mitigation.trim(),
          escalation: form.escalation.trim(),
          task_id: form.task_id || null,
          owner: form.owner.trim(),
          due: form.due,
        }),
      },
    );
    const data = await readJsonResponse(
      response,
      "Risk or issue could not be added.",
    );
    if (!response.ok)
      return toast.error(data.error || "Risk or issue could not be added.");
    setRecords((current) => [...current, data.record]);
    setForm({
      title: "",
      detail: "",
      severity: "medium",
      likelihood: "",
      impact: "",
      mitigation: "",
      escalation: "",
      owner: "",
      due: "",
      task_id: "",
    });
    setActiveTab(kind);
    setModalOpen(false);
    toast.success(`${kind === "risk" ? "Risk" : "Issue"} added.`);
  };
  const updateStatus = async (id, status) => {
    const response = await fetch(
      `/api/workspaces/${workspaceId}/risks-issues/${id}/`,
      {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": await getCsrfToken(),
          "X-Workspace-Id": String(workspaceId),
        },
        body: JSON.stringify({ status }),
      },
    );
    const data = await readJsonResponse(
      response,
      "Status could not be updated.",
    );
    if (!response.ok)
      return toast.error(data.error || "Status could not be updated.");
    setRecords((current) =>
      current.map((item) => (item.id === id ? data.record : item)),
    );
    toast.success("Status updated.");
  };
  const remove = async (id) => {
    const record = items.find((item) => item.id === id);
    const response = await fetch(
      `/api/workspaces/${workspaceId}/risks-issues/${id}/`,
      {
        method: "DELETE",
        credentials: "include",
        headers: {
          "X-CSRFToken": await getCsrfToken(),
          "X-Workspace-Id": String(workspaceId),
        },
      },
    );
    if (!response.ok)
      return toast.error("Risk or issue could not be archived.");
    setRecords((current) => current.filter((item) => item.id !== id));
    toast.success(`${record?.kind === "issue" ? "Issue" : "Risk"} deleted.`);
  };
  const risks = items.filter((item) => item.kind === "risk");
  const issues = items.filter((item) => item.kind === "issue");
  const visibleItems = activeTab === "risk" ? risks : issues;
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [activeTab, projectId]);
  const pageSize = 20;
  const totalPages = Math.max(1, Math.ceil(visibleItems.length / pageSize));
  const pageItems = visibleItems.slice((page - 1) * pageSize, page * pageSize);
  const statuses =
    activeTab === "risk"
      ? [
          ["open", "Open"],
          ["mitigated", "Mitigated"],
          ["closed", "Closed"],
        ]
      : [
          ["open", "Open"],
          ["in progress", "In progress"],
          ["resolved", "Resolved"],
        ];

  if (hidden) return null;

  return (
    <section className="project-risk-issues">
      <div className="project-risk-issues-heading">
        <div>
          <p className="eyebrow">Project controls</p>
          <h2>Risk register & issue log</h2>
          <p>
            Track threats, decisions, and problems before they become delivery
            surprises.
          </p>
        </div>
        <AppSelect
          value={projectId}
          onChange={(event) => setProjectId(event.target.value)}
          aria-label="Select project for risk and issue tracking"
        >
          {projects.length ? (
            projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))
          ) : (
            <option value="">No projects yet</option>
          )}
        </AppSelect>
      </div>
      <Card className="project-register-card">
        <div className="project-register-toolbar">
          <div
            className="project-register-tabs"
            role="tablist"
            aria-label="Project controls"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "risk"}
              className={activeTab === "risk" ? "active" : ""}
              onClick={() => setActiveTab("risk")}
            >
              Risk register <span>{risks.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "issue"}
              className={activeTab === "issue" ? "active" : ""}
              onClick={() => setActiveTab("issue")}
            >
              Issue log <span>{issues.length}</span>
            </button>
          </div>
          {canManage && (
            <button
              type="button"
              className="primary-button project-register-add"
              onClick={openAddModal}
              disabled={!projectId}
            >
              <Plus size={15} /> Add new
            </button>
          )}
        </div>
        <div className="project-register-table-wrap">
          <table className="project-register-table">
            <thead>
              <tr>
                <th>{activeTab === "risk" ? "Risk" : "Issue"}</th>
                <th>Severity</th>
                <th>Owner</th>
                <th>Target date</th>
                <th>Status</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.length ? (
                pageItems.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.title}</strong>
                      <span>
                        {item.detail || "No description added."}
                        {item.mitigation
                          ? ` · Mitigation: ${item.mitigation}`
                          : ""}
                        {item.task_title ? ` · Task: ${item.task_title}` : ""}
                      </span>
                    </td>
                    <td>
                      <span className={`record-severity ${item.severity}`}>
                        {item.severity}
                      </span>
                    </td>
                    <td>
                      {item.owner || (
                        <span className="table-muted">Unassigned</span>
                      )}
                    </td>
                    <td
                      className={
                        item.due_date &&
                        item.due_date < toDateKey(new Date()) &&
                        !["mitigated", "closed", "resolved"].includes(
                          item.status,
                        )
                          ? "is-danger"
                          : ""
                      }
                    >
                      {item.due || <span className="table-muted">No date</span>}
                    </td>
                    <td>
                      {canManage ? (
                        <AppSelect
                          value={item.status}
                          onChange={(event) =>
                            updateStatus(item.id, event.target.value)
                          }
                          aria-label={`Set status for ${item.title}`}
                        >
                          {statuses.map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </AppSelect>
                      ) : (
                        item.status
                      )}
                    </td>
                    <td>
                      {canManage && (
                        <button
                          type="button"
                          className="inline-delete"
                          onClick={() => remove(item.id)}
                          aria-label={`Delete ${item.title}`}
                        >
                          <X size={14} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="project-register-empty" colSpan="6">
                    <Brush size={22} />
                    <strong>
                      No {activeTab === "risk" ? "risks" : "issues"} yet
                    </strong>
                    <span>
                      {activeTab === "risk"
                        ? "Add a risk to begin tracking possible threats."
                        : "Add an issue to track an active project problem."}
                    </span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="planner-pagination">
            <span>
              {visibleItems.length
                ? `${(page - 1) * pageSize + 1}-${Math.min(page * pageSize, visibleItems.length)} of ${visibleItems.length}`
                : "0 records"}
            </span>
            <div>
              <button
                type="button"
                disabled={page === 1}
                onClick={() => setPage((current) => current - 1)}
                aria-label="Previous page"
              >
                <ChevronLeft size={15} />
              </button>
              <span>
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                disabled={page === totalPages}
                onClick={() => setPage((current) => current + 1)}
                aria-label="Next page"
              >
                <ChevronRight size={15} />
              </button>
            </div>
          </div>
        </div>
      </Card>
      {modalOpen && (
        <div className="modal-backdrop" onMouseDown={() => setModalOpen(false)}>
          <form
            className="modal project-record-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="project-record-modal-title"
            onSubmit={addRecord}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Project controls</p>
                <h2 id="project-record-modal-title">Add a new record</h2>
                <p className="modal-subtitle">
                  Capture a risk or an active issue for this project.
                </p>
              </div>
              <button
                type="button"
                className="close-button"
                onClick={() => setModalOpen(false)}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <div
              className="record-form-toggle"
              role="group"
              aria-label="Record type"
            >
              <button
                type="button"
                className={kind === "risk" ? "active" : ""}
                onClick={() => setKind("risk")}
              >
                Risk
              </button>
              <button
                type="button"
                className={kind === "issue" ? "active" : ""}
                onClick={() => setKind("issue")}
              >
                Issue
              </button>
            </div>
            <label>
              {kind === "risk" ? "Risk title" : "Issue title"}
              <input
                autoFocus
                value={form.title}
                onChange={(event) =>
                  setForm({ ...form, title: event.target.value })
                }
                placeholder={
                  kind === "risk"
                    ? "What could affect delivery?"
                    : "What problem needs resolving?"
                }
                required
              />
            </label>
            <label>
              Description
              <textarea
                value={form.detail}
                onChange={(event) =>
                  setForm({ ...form, detail: event.target.value })
                }
                placeholder={
                  kind === "risk"
                    ? "Describe the risk and planned mitigation"
                    : "Describe the issue and next action"
                }
              />
            </label>
            <div className="record-form-grid">
              <SelectField
                label="Severity"
                name="severity"
                value={form.severity}
                onChange={(event) =>
                  setForm({ ...form, severity: event.target.value })
                }
                options={[
                  ["low", "Low"],
                  ["medium", "Medium"],
                  ["high", "High"],
                  ["critical", "Critical"],
                ]}
              />
              <label>
                Likelihood (1-5)
                <input
                  type="number"
                  min="1"
                  max="5"
                  value={form.likelihood}
                  onChange={(event) =>
                    setForm({ ...form, likelihood: event.target.value })
                  }
                />
              </label>
              <label>
                Impact (1-5)
                <input
                  type="number"
                  min="1"
                  max="5"
                  value={form.impact}
                  onChange={(event) =>
                    setForm({ ...form, impact: event.target.value })
                  }
                />
              </label>
              <label>
                Owner
                <input
                  value={form.owner}
                  onChange={(event) =>
                    setForm({ ...form, owner: event.target.value })
                  }
                  placeholder="Name or team"
                />
              </label>
              <DateField
                label="Target date"
                value={form.due}
                onChange={(event) =>
                  setForm({ ...form, due: event.target.value })
                }
              />
            </div>
            <label>
              Mitigation
              <textarea
                value={form.mitigation}
                onChange={(event) =>
                  setForm({ ...form, mitigation: event.target.value })
                }
                placeholder="Preventive action and next step"
              />
            </label>
            <label>
              Escalation
              <textarea
                value={form.escalation}
                onChange={(event) =>
                  setForm({ ...form, escalation: event.target.value })
                }
                placeholder="When and who to escalate to"
              />
            </label>
            <label>
              Linked task
              <AppSelect
                value={form.task_id}
                onChange={(event) =>
                  setForm({ ...form, task_id: event.target.value })
                }
              >
                <option value="">No task link</option>
                {tasks
                  .filter(
                    (task) => String(task.project_id) === String(projectId),
                  )
                  .map((task) => (
                    <option key={task.id} value={task.id}>
                      {task.title}
                    </option>
                  ))}
              </AppSelect>
            </label>
            <button type="submit" className="primary-button modal-submit">
              Add {kind}
            </button>
          </form>
        </div>
      )}
    </section>
  );
}

function ClockInCard({
  shifts,
  currentUserId,
  presence,
  onSubmitShift,
  onChangePresence,
}) {
  const [pending, setPending] = useState("");
  const [tick, setTick] = useState(() => Date.now());
  const mine = shifts.filter(
    (shift) => String(shift.user_id) === String(currentUserId),
  );
  const openShift = mine.find((shift) => shift.is_open) || null;
  const closedToday = mine.filter((shift) => !shift.is_open);
  const onBreak = Boolean(openShift?.is_on_break);

  useEffect(() => {
    if (!openShift) return undefined;
    const timer = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [openShift?.id]);

  // break_seconds from the API is banked time only, so a break still running is added from break_started_at here.
  const runningBreakSeconds = openShift?.break_started_at
    ? Math.max(
        0,
        Math.floor(
          (tick - new Date(openShift.break_started_at).getTime()) / 1000,
        ),
      )
    : 0;
  // The headline timer tracks the shift in progress only, so clocking out returns it to zero.
  const shiftSeconds = openShift
    ? Math.max(
        0,
        Math.floor((tick - new Date(openShift.started_at).getTime()) / 1000) -
          openShift.break_seconds -
          runningBreakSeconds,
      )
    : 0;
  const shiftBreakSeconds =
    (openShift?.break_seconds || 0) + runningBreakSeconds;
  const earlierSeconds = closedToday.reduce(
    (total, shift) => total + shift.worked_seconds,
    0,
  );
  const dayTotalSeconds = earlierSeconds + shiftSeconds;
  const breakPlanSeconds = (openShift?.break_plan_minutes || 0) * 60;
  const breakRemaining = breakPlanSeconds
    ? breakPlanSeconds - runningBreakSeconds
    : 0;
  const breakOverrun = Boolean(breakPlanSeconds) && breakRemaining <= 0;

  const run = async (action, minutes = 0) => {
    setPending(action);
    try {
      await onSubmitShift(action, minutes);
    } finally {
      setPending("");
    }
  };

  const stateLabel = !openShift
    ? "Clocked out"
    : onBreak
      ? "On break"
      : "Clocked in";
  const headline = openShift
    ? `Started ${formatShiftClock(openShift.started_at)}`
    : closedToday.length
      ? `Last shift ended ${formatShiftClock(closedToday[0].ended_at)}`
      : "Not started yet";
  return (
    <div className="today-panel today-clock-panel">
      <div className="today-panel-heading">
        <div>
          <h2>Time clock</h2>
          <p>{headline}</p>
        </div>
        <span
          className={`clock-state clock-state-${openShift ? (onBreak ? "break" : "active") : "idle"}`}
        >
          <Clock3 size={14} /> {stateLabel}
        </span>
      </div>
      <strong
        className="today-clock-timer"
        role="timer"
        aria-live="off"
        aria-label={`Current shift ${formatShiftDuration(shiftSeconds)}`}
      >
        {formatShiftDuration(shiftSeconds)}
      </strong>
      <span className="today-muted">
        {dayTotalSeconds
          ? `Today ${formatShiftDuration(dayTotalSeconds)}`
          : "Nothing logged today"}
        {shiftBreakSeconds
          ? ` · Breaks ${formatShiftDuration(shiftBreakSeconds)}`
          : ""}
      </span>
      {onBreak && (
        <p className={`clock-break-timer${breakOverrun ? " is-over" : ""}`}>
          {breakPlanSeconds
            ? breakOverrun
              ? `${BREAK_PRESET_LABEL[openShift.break_plan_minutes]} break is over by ${formatShiftDuration(-breakRemaining)}`
              : `${formatShiftDuration(breakRemaining)} left of your ${BREAK_PRESET_LABEL[openShift.break_plan_minutes]} break`
            : `Break running ${formatShiftDuration(runningBreakSeconds)}`}
        </p>
      )}
      <div className="today-clock-actions">
        {!openShift && (
          <Button
            size="sm"
            disabled={Boolean(pending)}
            onClick={() => run("clock_in")}
          >
            <Play size={15} /> Clock in
          </Button>
        )}
        {openShift && onBreak && (
          <Button
            size="sm"
            disabled={Boolean(pending)}
            onClick={() => run("end_break")}
          >
            <Play size={15} /> Resume
          </Button>
        )}
        {openShift &&
          !onBreak &&
          BREAK_PRESETS.map((minutes) => (
            <Button
              key={minutes}
              variant="outline"
              size="sm"
              disabled={Boolean(pending)}
              onClick={() => run("start_break", minutes)}
            >
              <Pause size={15} /> {BREAK_PRESET_LABEL[minutes]} break
            </Button>
          ))}
        {openShift && (
          <Button
            variant="outline"
            size="sm"
            disabled={Boolean(pending)}
            onClick={() => run("clock_out")}
          >
            <Square size={15} /> Clock out
          </Button>
        )}
      </div>
      <label className="today-status-select">
        <span>Status</span>
        <span className="presence-select">
          <span className={`presence-dot presence-${presence}`} />
          <AppSelect
            value={presence}
            onChange={(event) => onChangePresence(event.target.value)}
            aria-label="Set your status"
          >
            {PRESENCE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {PRESENCE_LABEL[option]}
              </option>
            ))}
          </AppSelect>
        </span>
      </label>
    </div>
  );
}

function ProjectStakeholderResourcePanel({
  project,
  workspaceId,
  canManage,
  tasks = [],
}) {
  const [resources, setResources] = useState([]);
  const [stakeholders, setStakeholders] = useState([]);
  const [resourceForm, setResourceForm] = useState({
    name: "",
    resource_type: "person",
    role: "",
    availability: "",
    capacity_percent: "",
    allocation_percent: "",
    task_id: "",
    file_url: "",
    notes: "",
  });
  const [stakeholderForm, setStakeholderForm] = useState({
    name: "",
    role: "",
    email: "",
    influence: "medium",
    interest: "medium",
    notes: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const load = async () => {
    if (!workspaceId || !project?.id) return;
    setLoading(true);
    setError("");
    try {
      const [resourceResponse, stakeholderResponse] = await Promise.all([
        fetch(
          `/api/workspaces/${workspaceId}/projects/${project.id}/resources/`,
          { credentials: "include" },
        ),
        fetch(
          `/api/workspaces/${workspaceId}/projects/${project.id}/stakeholders/`,
          { credentials: "include" },
        ),
      ]);
      const [resourceData, stakeholderData] = await Promise.all([
        resourceResponse.json(),
        stakeholderResponse.json(),
      ]);
      if (!resourceResponse.ok || !stakeholderResponse.ok)
        throw new Error(
          resourceData.error ||
            stakeholderData.error ||
            "Project management data could not be loaded.",
        );
      setResources(resourceData.resources || []);
      setStakeholders(stakeholderData.stakeholders || []);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, [workspaceId, project?.id]);
  const addResource = async (event) => {
    event.preventDefault();
    if (!resourceForm.name.trim()) return;
    const response = await fetch(
      `/api/workspaces/${workspaceId}/projects/${project.id}/resources/`,
      {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": await getCsrfToken(),
        },
        body: JSON.stringify(resourceForm),
      },
    );
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || "Resource could not be added.");
      return toast.error(data.error || "Resource could not be added.");
    }
    setResources((current) => [...current, data.resource]);
    setResourceForm({
      name: "",
      resource_type: "person",
      role: "",
      availability: "",
      capacity_percent: "",
      allocation_percent: "",
      task_id: "",
      file_url: "",
      notes: "",
    });
    toast.success(`${data.resource.name} added.`);
  };
  const addStakeholder = async (event) => {
    event.preventDefault();
    if (!stakeholderForm.name.trim()) return;
    const response = await fetch(
      `/api/workspaces/${workspaceId}/projects/${project.id}/stakeholders/`,
      {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": await getCsrfToken(),
        },
        body: JSON.stringify(stakeholderForm),
      },
    );
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || "Stakeholder could not be added.");
      return toast.error(data.error || "Stakeholder could not be added.");
    }
    setStakeholders((current) => [...current, data.stakeholder]);
    setStakeholderForm({
      name: "",
      role: "",
      email: "",
      influence: "medium",
      interest: "medium",
      notes: "",
    });
    toast.success(`${data.stakeholder.name} added.`);
  };
  const archiveResource = async (resource) => {
    const response = await fetch(
      `/api/workspaces/${workspaceId}/projects/${project.id}/resources/${resource.id}/`,
      {
        method: "DELETE",
        credentials: "include",
        headers: { "X-CSRFToken": await getCsrfToken() },
      },
    );
    if (response.ok) {
      setResources((current) =>
        current.filter((item) => item.id !== resource.id),
      );
      toast.success(`${resource.name} archived.`);
    } else {
      toast.error("Resource could not be archived.");
    }
  };
  const archiveStakeholder = async (stakeholder) => {
    const response = await fetch(
      `/api/workspaces/${workspaceId}/projects/${project.id}/stakeholders/${stakeholder.id}/`,
      {
        method: "DELETE",
        credentials: "include",
        headers: { "X-CSRFToken": await getCsrfToken() },
      },
    );
    if (response.ok) {
      setStakeholders((current) =>
        current.filter((item) => item.id !== stakeholder.id),
      );
      toast.success(`${stakeholder.name} archived.`);
    } else {
      toast.error("Stakeholder could not be archived.");
    }
  };
  return (
    <section className="project-stakeholder-resource">
      <div className="project-risk-issues-heading">
        <div>
          <p className="eyebrow">Project delivery</p>
          <h2>Resources & stakeholders</h2>
          <p>Track who is involved and what is available for delivery.</p>
        </div>
      </div>
      {loading && (
        <p className="workspace-inline-status" role="status">
          Loading project management data...
        </p>
      )}
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      <div className="project-stakeholder-resource-grid">
        <Card className="project-stakeholder-card">
          <div className="drawer-section-heading">
            <h3>Resources</h3>
            <span>{resources.length}</span>
          </div>
          {canManage && (
            <form className="project-resource-form" onSubmit={addResource}>
              <label>
                Name
                <input
                  value={resourceForm.name}
                  onChange={(event) =>
                    setResourceForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="e.g. Senior designer"
                  required
                />
              </label>
              <SelectField
                label="Type"
                name="resource_type"
                value={resourceForm.resource_type}
                onChange={(event) =>
                  setResourceForm((current) => ({
                    ...current,
                    resource_type: event.target.value,
                  }))
                }
                options={[
                  ["person", "Person"],
                  ["equipment", "Equipment"],
                  ["supplier", "Supplier"],
                  ["file", "File"],
                  ["other", "Other"],
                ]}
              />
              <label>
                Role
                <input
                  value={resourceForm.role}
                  onChange={(event) =>
                    setResourceForm((current) => ({
                      ...current,
                      role: event.target.value,
                    }))
                  }
                  placeholder="e.g. Design lead"
                />
              </label>
              <label>
                Capacity %
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={resourceForm.capacity_percent}
                  onChange={(event) =>
                    setResourceForm((current) => ({
                      ...current,
                      capacity_percent: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Allocation %
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={resourceForm.allocation_percent}
                  onChange={(event) =>
                    setResourceForm((current) => ({
                      ...current,
                      allocation_percent: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                Task link
                <AppSelect
                  value={resourceForm.task_id}
                  onChange={(event) =>
                    setResourceForm((current) => ({
                      ...current,
                      task_id: event.target.value,
                    }))
                  }
                >
                  <option value="">No task link</option>
                  {tasks
                    .filter(
                      (task) => String(task.project_id) === String(project.id),
                    )
                    .map((task) => (
                      <option key={task.id} value={task.id}>
                        {task.title}
                      </option>
                    ))}
                </AppSelect>
              </label>
              <label>
                File or supplier link
                <input
                  type="url"
                  value={resourceForm.file_url}
                  onChange={(event) =>
                    setResourceForm((current) => ({
                      ...current,
                      file_url: event.target.value,
                    }))
                  }
                  placeholder="https://..."
                />
              </label>
              <button className="secondary-button" type="submit">
                <Plus size={15} /> Add resource
              </button>
            </form>
          )}
          <div className="project-stakeholder-list">
            {resources.map((resource) => (
              <div className="project-stakeholder-row" key={resource.id}>
                <div>
                  <strong>{resource.name}</strong>
                  <span>
                    {resource.resource_type} ·{" "}
                    {resource.role ||
                      resource.availability ||
                      "No role or availability"}
                    {resource.capacity_percent !== null
                      ? ` · ${resource.allocation_percent || 0}% of ${resource.capacity_percent}% capacity`
                      : ""}
                    {resource.task_title ? ` · ${resource.task_title}` : ""}
                    {resource.file_url ? " · linked file" : ""}
                  </span>
                  {resource.capacity_percent !== null &&
                    resource.allocation_percent > resource.capacity_percent && (
                      <span className="auth-error">Over-allocated</span>
                    )}
                </div>
                {canManage && (
                  <button
                    type="button"
                    className="inline-delete"
                    onClick={() => archiveResource(resource)}
                    aria-label={`Archive ${resource.name}`}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </Card>
        <Card className="project-stakeholder-card">
          <div className="drawer-section-heading">
            <h3>Stakeholders</h3>
            <span>{stakeholders.length}</span>
          </div>
          {canManage && (
            <form className="project-resource-form" onSubmit={addStakeholder}>
              <label>
                Name
                <input
                  value={stakeholderForm.name}
                  onChange={(event) =>
                    setStakeholderForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="e.g. Finance Director"
                  required
                />
              </label>
              <label>
                Role
                <input
                  value={stakeholderForm.role}
                  onChange={(event) =>
                    setStakeholderForm((current) => ({
                      ...current,
                      role: event.target.value,
                    }))
                  }
                  placeholder="Approver"
                />
              </label>
              <label>
                Email
                <input
                  value={stakeholderForm.email}
                  onChange={(event) =>
                    setStakeholderForm((current) => ({
                      ...current,
                      email: event.target.value,
                    }))
                  }
                  placeholder="person@company.com"
                />
              </label>
              <div className="modal-grid">
                <SelectField
                  label="Influence"
                  name="influence"
                  value={stakeholderForm.influence}
                  onChange={(event) =>
                    setStakeholderForm((current) => ({
                      ...current,
                      influence: event.target.value,
                    }))
                  }
                  options={[
                    ["low", "Low"],
                    ["medium", "Medium"],
                    ["high", "High"],
                  ]}
                />
                <SelectField
                  label="Interest"
                  name="interest"
                  value={stakeholderForm.interest}
                  onChange={(event) =>
                    setStakeholderForm((current) => ({
                      ...current,
                      interest: event.target.value,
                    }))
                  }
                  options={[
                    ["low", "Low"],
                    ["medium", "Medium"],
                    ["high", "High"],
                  ]}
                />
              </div>
              <button className="secondary-button" type="submit">
                <Plus size={15} /> Add stakeholder
              </button>
            </form>
          )}
          <div className="project-stakeholder-list">
            {stakeholders.map((stakeholder) => (
              <div className="project-stakeholder-row" key={stakeholder.id}>
                <div>
                  <strong>{stakeholder.name}</strong>
                  <span>
                    {stakeholder.role || "No role"} ·{" "}
                    {stakeholder.email || "No email"} · Influence{" "}
                    {stakeholder.influence} · Interest {stakeholder.interest}
                  </span>
                </div>
                {canManage && (
                  <button
                    type="button"
                    className="inline-delete"
                    onClick={() => archiveStakeholder(stakeholder)}
                    aria-label={`Archive ${stakeholder.name}`}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </section>
  );
}
function ProjectCostBudgetPanel({
  project,
  workspaceId,
  canManage,
  onProjectUpdated,
}) {
  const [expenses, setExpenses] = useState([]);
  const [expenseForm, setExpenseForm] = useState({
    name: "",
    category: "other",
    amount: "",
    is_committed: false,
    incurred_on: "",
    notes: "",
    receipt_url: "",
  });
  const [budgetForm, setBudgetForm] = useState({
    budget_amount: project.budget_amount || "",
    budget_currency: project.budget_currency || "USD",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const load = async () => {
    if (!workspaceId || !project?.id) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/projects/${project.id}/expenses/`,
        { credentials: "include" },
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Project expenses could not be loaded.");
      setExpenses(data.expenses || []);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    load();
  }, [workspaceId, project?.id]);
  useEffect(() => {
    setBudgetForm({
      budget_amount: project.budget_amount || "",
      budget_currency: project.budget_currency || "USD",
    });
  }, [project.budget_amount, project.budget_currency]);
  const formatMoney = (amount) => {
    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: budgetForm.budget_currency || "USD",
      }).format(Number(amount) || 0);
    } catch {
      return `${amount}`;
    }
  };
  const actualSpent = expenses
    .filter((expense) => !expense.is_committed)
    .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const committedSpent = expenses
    .filter((expense) => expense.is_committed)
    .reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const totalSpent = actualSpent + committedSpent;
  const budgetAmount = project.budget_amount
    ? Number(project.budget_amount)
    : null;
  const remaining = budgetAmount === null ? null : budgetAmount - totalSpent;
  const saveBudget = async (event) => {
    event.preventDefault();
    const response = await fetch(
      `/api/workspaces/${workspaceId}/projects/${project.id}/`,
      {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": await getCsrfToken(),
        },
        body: JSON.stringify({
          budget_amount:
            budgetForm.budget_amount === "" ? null : budgetForm.budget_amount,
          budget_currency: budgetForm.budget_currency,
        }),
      },
    );
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || "Budget could not be saved.");
      return toast.error(data.error || "Budget could not be saved.");
    }
    onProjectUpdated?.(data.project);
    toast.success("Budget saved.");
  };
  const addExpense = async (event) => {
    event.preventDefault();
    if (!expenseForm.name.trim() || !expenseForm.amount) return;
    const response = await fetch(
      `/api/workspaces/${workspaceId}/projects/${project.id}/expenses/`,
      {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": await getCsrfToken(),
        },
        body: JSON.stringify({
          ...expenseForm,
          incurred_on: expenseForm.incurred_on || null,
        }),
      },
    );
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || "Expense could not be added.");
      return toast.error(data.error || "Expense could not be added.");
    }
    setExpenses((current) => [data.expense, ...current]);
    setExpenseForm({
      name: "",
      category: "other",
      amount: "",
      is_committed: false,
      incurred_on: "",
      notes: "",
      receipt_url: "",
    });
    toast.success(`${data.expense.name} added.`);
  };
  const archiveExpense = async (expense) => {
    const response = await fetch(
      `/api/workspaces/${workspaceId}/projects/${project.id}/expenses/${expense.id}/`,
      {
        method: "DELETE",
        credentials: "include",
        headers: { "X-CSRFToken": await getCsrfToken() },
      },
    );
    if (response.ok) {
      setExpenses((current) =>
        current.filter((item) => item.id !== expense.id),
      );
      toast.success(`${expense.name} archived.`);
    } else {
      toast.error("Expense could not be archived.");
    }
  };
  return (
    <section className="project-stakeholder-resource">
      <div className="project-risk-issues-heading">
        <div>
          <p className="eyebrow">Project delivery</p>
          <h2>Cost & budget</h2>
          <p>Track spend against the approved budget.</p>
        </div>
      </div>
      {loading && (
        <p className="workspace-inline-status" role="status">
          Loading budget data...
        </p>
      )}
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      <div className="project-summary">
        <div>
          <strong>
            {budgetAmount === null ? "Not set" : formatMoney(budgetAmount)}
          </strong>
          <span>Budget</span>
        </div>
        <div>
          <strong>{formatMoney(actualSpent)}</strong>
          <span>Actual spend</span>
        </div>
        <div>
          <strong>{formatMoney(committedSpent)}</strong>
          <span>Committed</span>
        </div>
        <div className={remaining !== null && remaining < 0 ? "is-danger" : ""}>
          <strong>{remaining === null ? "n/a" : formatMoney(remaining)}</strong>
          <span>
            {remaining !== null && remaining < 0 ? "Over budget" : "Remaining"}
          </span>
        </div>
        <div
          className={
            budgetAmount && totalSpent / budgetAmount >= 0.9 ? "is-warning" : ""
          }
        >
          <strong>
            {budgetAmount
              ? `${Math.min(Math.round((totalSpent / budgetAmount) * 100), 999)}%`
              : "n/a"}
          </strong>
          <span>
            {budgetAmount && totalSpent / budgetAmount >= 0.9
              ? "Budget alert"
              : "Variance used"}
          </span>
        </div>
      </div>
      <div className="project-stakeholder-resource-grid">
        <Card className="project-stakeholder-card">
          <div className="drawer-section-heading">
            <h3>Budget target</h3>
          </div>
          {canManage ? (
            <form className="project-resource-form" onSubmit={saveBudget}>
              <label>
                Amount
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={budgetForm.budget_amount}
                  onChange={(event) =>
                    setBudgetForm((current) => ({
                      ...current,
                      budget_amount: event.target.value,
                    }))
                  }
                  placeholder="e.g. 50000"
                />
              </label>
              <SelectField
                label="Currency"
                name="budget_currency"
                value={budgetForm.budget_currency}
                onChange={(event) =>
                  setBudgetForm((current) => ({
                    ...current,
                    budget_currency: event.target.value,
                  }))
                }
                options={[
                  ["USD", "US Dollar ($)"],
                  ["GBP", "British Pound (£)"],
                  ["NGN", "Nigerian Naira (₦)"],
                  ["KES", "Kenyan Shilling (KSh)"],
                ]}
              />
              <button className="secondary-button" type="submit">
                Save budget
              </button>
            </form>
          ) : (
            <p className="today-muted">
              Only managers can set the budget target.
            </p>
          )}
        </Card>
        <Card className="project-stakeholder-card">
          <div className="drawer-section-heading">
            <h3>Expenses</h3>
            <span>{expenses.length}</span>
          </div>
          {canManage && (
            <form className="project-resource-form" onSubmit={addExpense}>
              <label>
                Name
                <input
                  value={expenseForm.name}
                  onChange={(event) =>
                    setExpenseForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  placeholder="e.g. Design contractor"
                  required
                />
              </label>
              <SelectField
                label="Category"
                name="category"
                value={expenseForm.category}
                onChange={(event) =>
                  setExpenseForm((current) => ({
                    ...current,
                    category: event.target.value,
                  }))
                }
                options={[
                  ["labor", "Labor"],
                  ["materials", "Materials"],
                  ["software", "Software"],
                  ["travel", "Travel"],
                  ["other", "Other"],
                ]}
              />
              <label>
                Amount
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={expenseForm.amount}
                  onChange={(event) =>
                    setExpenseForm((current) => ({
                      ...current,
                      amount: event.target.value,
                    }))
                  }
                  placeholder="e.g. 1200"
                  required
                />
              </label>
              <DateField
                label="Date"
                name="incurred_on"
                value={expenseForm.incurred_on}
                onChange={(event) =>
                  setExpenseForm((current) => ({
                    ...current,
                    incurred_on: event.target.value,
                  }))
                }
              />
              <label>
                <input
                  type="checkbox"
                  checked={expenseForm.is_committed}
                  onChange={(event) =>
                    setExpenseForm((current) => ({
                      ...current,
                      is_committed: event.target.checked,
                    }))
                  }
                />{" "}
                Committed, not yet paid
              </label>
              <label>
                Receipt or file link
                <input
                  type="url"
                  value={expenseForm.receipt_url}
                  onChange={(event) =>
                    setExpenseForm((current) => ({
                      ...current,
                      receipt_url: event.target.value,
                    }))
                  }
                  placeholder="https://..."
                />
              </label>
              <label>
                Notes
                <textarea
                  value={expenseForm.notes}
                  onChange={(event) =>
                    setExpenseForm((current) => ({
                      ...current,
                      notes: event.target.value,
                    }))
                  }
                />
              </label>
              <button className="secondary-button" type="submit">
                <Plus size={15} /> Add expense
              </button>
            </form>
          )}
          <div className="project-stakeholder-list">
            {expenses.map((expense) => (
              <div className="project-stakeholder-row" key={expense.id}>
                <div>
                  <strong>{expense.name}</strong>
                  <span>
                    {expense.category} · {formatMoney(expense.amount)} ·{" "}
                    {expense.is_committed ? "Committed" : "Actual"}
                    {expense.incurred_on ? ` · ${expense.incurred_on}` : ""}
                    {expense.receipt_url ? " · receipt linked" : ""}
                    {expense.notes ? ` · ${expense.notes}` : ""}
                  </span>
                </div>
                {canManage && (
                  <button
                    type="button"
                    className="inline-delete"
                    onClick={() => archiveExpense(expense)}
                    aria-label={`Archive ${expense.name}`}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </section>
  );
}
function TodayPanel({
  panelKey,
  title,
  description,
  open,
  onToggle,
  action,
  className = "",
  children,
}) {
  return (
    <section className={`today-panel ${className}`.trim()}>
      <div className="today-panel-heading">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <div className="today-panel-controls">
          {action}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onToggle}
            aria-expanded={open}
            aria-controls={`today-panel-${panelKey}`}
            aria-label={`${open ? "Collapse" : "Expand"} ${title}`}
            title={`${open ? "Collapse" : "Expand"} ${title}`}
          >
            <ChevronDown
              size={15}
              className={open ? "today-panel-chevron is-open" : "today-panel-chevron"}
            />
          </Button>
        </div>
      </div>
      {open && <div id={`today-panel-${panelKey}`} className="today-panel-body">{children}</div>}
    </section>
  );
}

function TodayDashboard({
  today,
  todayLabel,
  currentUserName,
  currentUserId,
  currentUserPresence,
  workspaceName,
  tasks,
  events,
  followUps,
  checkIns,
  activity = [],
  workShifts,
  members,
  canManageMembers,
  onAddTask,
  onAddEvent,
  onCheckIn,
  onInvite,
  onOpenTask,
  onOpenEvent,
  onOpenFollowUp,
  onNavigate,
  onOpenBoard,
  onComplete,
  onStatusChange,
  onSubmitShift,
  onChangePresence,
}) {
  const [profileMember, setProfileMember] = useState(null);
  const [collapsedPanels, setCollapsedPanels] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("workspace-today-panels") || "{}");
    } catch {
      return {};
    }
  });
  const panelOpen = (key) => collapsedPanels[key] !== false;
  const togglePanel = (key) => {
    setCollapsedPanels((current) => {
      const next = { ...current, [key]: current[key] === false };
      localStorage.setItem("workspace-today-panels", JSON.stringify(next));
      return next;
    });
  };
  const isOpen = (task) => task.status !== "done";
  // Counted through BOARD_FOCUS so each headline number is the same question the
  // Team answers when the card opens it.
  const countMatching = (key) =>
    tasks.filter((task) => BOARD_FOCUS[key](task, today));
  const dueToday = countMatching("due-today");
  const overdue = countMatching("overdue");
  const blocked = countMatching("blocked");
  const completedToday = countMatching("completed");
  // Matches on the user id, the way MyTasksView does. This compared the
  // displayed name against member.email, which only ever matched for someone
  // with no first or last name, so the lookup usually fell through to "" and
  // every unassigned task satisfied "" === "" and showed up as yours. The name
  // fallback is kept behind the same !assignee_id guard as MyTasksView so an
  // unassigned task cannot be claimed by a name comparison.
  const myTasks = tasks.filter((task) =>
    taskIsAssignedTo(task, currentUserId, currentUserName),
  );
  const myQueue = myTasks
    .filter(isOpen)
    .sort((a, b) => {
      const rank = (task) =>
        task.due === "Overdue"
          ? 0
          : task.priority === "urgent"
            ? 1
            : task.due_date === today
              ? 2
              : task.status === "in progress"
                ? 3
                : 4;
      return (
        rank(a) - rank(b) ||
        (a.due_date || "9999").localeCompare(b.due_date || "9999")
      );
    })
    .slice(0, 8);
  const todaysEvents = events
    // An event that began earlier but runs into today is still today's, so this
    // matches on overlap rather than an exact start date.
    .filter(
      (event) =>
        toDateKey(event.start_at) <= today &&
        toDateKey(event.end_at || event.start_at) >= today,
    )
    .sort((a, b) => new Date(a.start_at) - new Date(b.start_at))
    .slice(0, 6);
  const dueFollowUps = followUps
    .filter(
      (item) =>
        item.status !== "completed" &&
        (!item.due_date || item.due_date <= today),
    )
    // Soonest first, undated last, so an undated item cannot push a genuinely
    // overdue follow-up out of the four that are shown.
    .sort((a, b) =>
      (a.due_date || "9999-12-31").localeCompare(b.due_date || "9999-12-31"),
    )
    .slice(0, 6);
  const openExceptions = [
    ...blocked,
    ...tasks
      .filter((task) => !task.assignee_id && isOpen(task))
      .filter((task) => !blocked.includes(task)),
    ...overdue.filter((task) => !blocked.includes(task)),
  ]
    .filter(
      (task, index, list) =>
        list.findIndex((item) => item.id === task.id) === index,
    )
    .slice(0, 8);
  const checkInsToday = checkIns.filter(
    (item) =>
      item.date === today ||
      (item.created_at && toDateKey(item.created_at) === today),
  );
  const checkedInMemberIds = new Set(checkInsToday.map((item) => String(item.user_id)));
  const memberName = (member) =>
    [member.first_name, member.last_name].filter(Boolean).join(" ") ||
    member.email;
  const membersByActivity = sortMembersByRecentActivity(members, currentUserId);
  const onlineMembers = membersByActivity
    .filter((member) => effectivePresence(member) !== "offline")
    .slice(0, 6);
  const recentMembers = membersByActivity
    .filter((member) => effectivePresence(member) === "offline")
    .slice(0, 4);
  const missingCheckInMembers = members.filter(
    (member) => !checkedInMemberIds.has(String(member.id)),
  );
  const myAgendaTasks = myTasks
    .filter(
      (task) =>
        isOpen(task) &&
        (task.due === "Overdue" || task.due_date === today),
    )
    .sort((a, b) => a.due_date.localeCompare(b.due_date))
    .slice(0, 6);
  const agendaItems = [
    ...myAgendaTasks.map((task) => ({
      key: `task-${task.id}`,
      kind: "task",
      sort: task.due === "Overdue" ? -1 : 1,
      label: task.due === "Overdue" ? "Overdue" : "Due today",
      title: task.title,
      meta: `${taskAssigneeLabel(task)} - ${task.status}`,
      onOpen: () => onOpenTask(task),
    })),
    ...todaysEvents.map((event) => ({
      key: `event-${event.id}`,
      kind: "event",
      sort: new Date(event.start_at).getTime(),
      label:
        toDateKey(event.start_at) === today
          ? new Date(event.start_at).toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
            })
          : formatDay(event.start_at),
      title: event.title,
      meta: event.event_type || "Event",
      onOpen: () => onOpenEvent?.(event),
    })),
    ...dueFollowUps.map((item) => ({
      key: `followup-${item.id}`,
      kind: "followup",
      sort: item.due_date ? new Date(`${item.due_date}T12:00:00`).getTime() : Number.MAX_SAFE_INTEGER,
      label: item.due_date ? formatDay(item.due_date) : "No due date",
      title: item.note,
      meta: item.task_id ? "Linked follow-up" : "Open follow-up",
      onOpen: () => onOpenFollowUp?.(item),
    })),
  ].sort((a, b) => a.sort - b.sort).slice(0, 8);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todaysChanges = activity
    .filter((event) => new Date(event.created_at).getTime() >= todayStart.getTime())
    .slice(0, 4);
  const dueAge = (task) => {
    if (!task.due_date || task.due === "Due today") return "Due today";
    const days = Math.max(
      0,
      Math.round(
        (new Date(`${today}T12:00:00`) - new Date(`${task.due_date}T12:00:00`)) /
          86400000,
      ),
    );
    return days === 1 ? "1 day overdue" : `${days} days overdue`;
  };
  const exceptionReason = (task) =>
    task.status === "blocked"
      ? task.blocker_details || "Blocked work"
      : !task.assignee_id
        ? "No owner"
        : dueAge(task);
  const messageOnlineMember = (member) => {
    requestDirectMessage(member.id);
    onNavigate("Chats");
  };
  const greetingHour = new Date().getHours();
  const greeting =
    greetingHour < 12
      ? "Good morning"
      : greetingHour < 18
        ? "Good afternoon"
        : "Good evening";
  const taskLabel = (task) =>
    task.due === "Overdue"
      ? "Overdue"
      : task.due_date === today
        ? "Due today"
        : task.status === "in progress"
          ? "In progress"
          : task.priority;
  return (
    <section className="today-dashboard">
      <section className="today-hero">
        <div>
          <p className="eyebrow">{todayLabel}</p>
          <h1>
            {greeting}, {currentUserName.split(" ")[0]}
          </h1>
          <p className="subtitle">
            Here is what needs your attention in {workspaceName}.
          </p>
        </div>
        <div className="today-actions">
          <Button type="button" onClick={onAddTask}>
            <Plus size={16} /> Add task
          </Button>
          <Button type="button" variant="secondary" onClick={onAddEvent}>
            <CalendarDays size={16} /> Add event
          </Button>
          <Button type="button" variant="outline" onClick={onCheckIn}>
            <MessageSquare size={16} /> Check in
          </Button>
          {canManageMembers && (
            <Button type="button" variant="ghost" onClick={onInvite}>
              <Plus size={16} /> Invite
            </Button>
          )}
        </div>
      </section>
      <section className="today-overview">
        <div className="today-overview-heading">
          <div>
            <h2>Workspace overview</h2>
            <p>Across all work in {workspaceName}</p>
          </div>
          <span>My day is separated below</span>
        </div>
        <div className="today-metrics">
        <button
          className="today-metric today-metric-due"
          onClick={() => onOpenBoard("due-today")}
        >
          <span className="today-metric-icon" aria-hidden="true">
            <CalendarClock size={19} />
          </span>
          <span className="today-metric-copy">
            <strong>{dueToday.length}</strong>
            <span>Due today</span>
          </span>
        </button>
        <button
          className={`today-metric today-metric-overdue${overdue.length ? " attention" : ""}`}
          onClick={() => onOpenBoard("overdue")}
        >
          <span className="today-metric-icon" aria-hidden="true">
            <AlarmClock size={19} />
          </span>
          <span className="today-metric-copy">
            <strong>{overdue.length}</strong>
            <span>Overdue</span>
          </span>
        </button>
        <button
          className={`today-metric today-metric-blocked${blocked.length ? " attention" : ""}`}
          onClick={() => onOpenBoard("blocked")}
        >
          <span className="today-metric-icon" aria-hidden="true">
            <CircleSlash size={19} />
          </span>
          <span className="today-metric-copy">
            <strong>{blocked.length}</strong>
            <span>Blocked</span>
          </span>
        </button>
        <button
          className="today-metric today-metric-completed"
          onClick={() => onOpenBoard("completed")}
        >
          <span className="today-metric-icon" aria-hidden="true">
            <CheckCircle2 size={19} />
          </span>
          <span className="today-metric-copy">
            <strong>{completedToday.length}</strong>
            <span>Completed today</span>
          </span>
        </button>
        </div>
      </section>
      {todaysChanges.length > 0 && (
        <section className="today-change-strip">
          <div>
            <strong>Changed today</strong>
            <span>Latest workspace updates</span>
          </div>
          <div className="today-change-list">
            {todaysChanges.map((event) => (
              <span key={event.id}>
                <b>{event.actor_name}</b> {event.message}
              </span>
            ))}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onNavigate("Activity")}
          >
            Activity <ArrowUpRight size={14} />
          </Button>
        </section>
      )}
      <div className="today-grid">
        <TodayPanel
          panelKey="my-day"
          title="My day"
          description="Prioritized work assigned to you"
          open={panelOpen("my-day")}
          onToggle={() => togglePanel("my-day")}
          className="my-day-panel"
          action={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onNavigate("My tasks")}
            >
              View all <ArrowUpRight size={14} />
            </Button>
          }
        >
          {myQueue.length ? (
            <div className="today-task-list">
              {myQueue.map((task) => (
                <article
                  className={`today-task-row ${task.status}`}
                  key={task.id}
                >
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={task.status === "done"}
                    className={`check ${task.status === "done" ? "checked" : ""}`}
                    onClick={() => onComplete(task.id)}
                    aria-label={`${task.status === "done" ? "Reopen" : "Complete"} ${task.title}`}
                    title={task.status === "done" ? "Reopen task" : "Mark task complete"}
                  >
                    <Check className="task-check-mark" size={13} strokeWidth={3} aria-hidden="true" />
                  </button>
                  <div className="today-task-copy">
                    <button onClick={() => onOpenTask(task)}>
                      {task.title}
                    </button>
                    <span>
                      {taskLabel(task)}
                      {task.tag && ` · ${task.tag}`}
                    </span>
                  </div>
                  <AppSelect
                    className={`task-status task-status-select ${task.status}`}
                    value={task.status}
                    onChange={(event) =>
                      onStatusChange(task.id, event.target.value)
                    }
                    aria-label={`Change status for ${task.title}`}
                  >
                    <option value="todo">To do</option>
                    <option value="in progress">In progress</option>
                    <option value="review">Review</option>
                    <option value="blocked">Blocked</option>
                    <option value="on_hold">On hold</option>
                    <option value="cancelled">Cancelled</option>
                    <option value="done">Done</option>
                  </AppSelect>
                </article>
              ))}
            </div>
          ) : (
            <div className="today-empty">
              <CheckCircle2 size={20} />
              <p>Your day is clear.</p>
              <Button variant="ghost" size="sm" onClick={onAddTask}>
                Plan a task <ArrowUpRight size={14} />
              </Button>
            </div>
          )}
        </TodayPanel>
        <aside className="today-side-stack">
          <ClockInCard
            shifts={workShifts}
            currentUserId={currentUserId}
            presence={currentUserPresence}
            onSubmitShift={onSubmitShift}
            onChangePresence={onChangePresence}
          />
          <TodayPanel
            panelKey="agenda"
            title="Today agenda"
            description="Tasks, events and follow-ups in chronological order"
            open={panelOpen("agenda")}
            onToggle={() => togglePanel("agenda")}
            className="today-agenda-panel"
            action={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => onNavigate("Calendar")}
                aria-label="Open calendar"
                title="Open calendar"
              >
                <ArrowUpRight size={15} />
              </Button>
            }
          >
            {agendaItems.length ? (
              <div className="today-agenda-list">
                {agendaItems.map((item) => (
                  <button
                    type="button"
                    className={`today-agenda-row is-${item.kind}`}
                    key={item.key}
                    onClick={item.onOpen}
                  >
                    <span className="today-agenda-time">{item.label}</span>
                    <span className="today-agenda-dot" aria-hidden="true" />
                    <span className="today-agenda-copy">
                      <strong>{item.title}</strong>
                      <small>{item.meta}</small>
                    </span>
                    <ArrowUpRight size={14} aria-hidden="true" />
                  </button>
                ))}
              </div>
            ) : (
              <div className="today-empty">
                <CalendarCheck2 size={20} />
                <p>No events or deadlines left today.</p>
                <Button type="button" variant="ghost" size="sm" onClick={onAddEvent}>
                  Add an event <ArrowUpRight size={14} />
                </Button>
              </div>
            )}
          </TodayPanel>
          <TodayPanel
            panelKey="team-presence"
            title="Team presence"
            description="Online now, then recently active teammates"
            open={panelOpen("team-presence")}
            onToggle={() => togglePanel("team-presence")}
            className="team-online-panel"
            action={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => onNavigate("Team")}
                aria-label="Open team board"
                title="Open team board"
              >
                <ArrowUpRight size={15} />
              </Button>
            }
          >
            <div className="today-presence-group">
              <h3>Online now <span>{onlineMembers.length}</span></h3>
              {onlineMembers.length ? (
                onlineMembers.map((member) => (
                  <button
                    type="button"
                    className="team-access-row"
                    key={member.id}
                    onClick={() => setProfileMember(member)}
                    aria-label={`Open ${memberName(member)} profile`}
                    title={`${member.job_role || member.role || "Member"}${member.company ? ` at ${member.company}` : ""}`}
                  >
                    <Avatar
                      name={memberName(member)}
                      avatarUrl={member.avatar_url}
                      presence={effectivePresence(member)}
                      small
                    />
                    <div>
                      <strong>{memberName(member)}</strong>
                      <span>
                        {formatLastSeen(member.last_seen_at)}
                        {canManageMembers &&
                          (member.on_break
                            ? " - On break"
                            : member.clocked_in
                              ? ` - Clocked in ${formatShiftClock(member.clock_in_at)}`
                              : "")}
                      </span>
                    </div>
                    <ArrowUpRight size={15} />
                  </button>
                ))
              ) : (
                <p className="today-muted">No teammates are online right now.</p>
              )}
            </div>
            <div className="today-presence-group">
              <h3>Recently active <span>{recentMembers.length}</span></h3>
              {recentMembers.length ? (
                recentMembers.map((member) => (
                  <button
                    type="button"
                    className="team-access-row"
                    key={member.id}
                    onClick={() => setProfileMember(member)}
                    aria-label={`Open ${memberName(member)} profile`}
                  >
                    <Avatar
                      name={memberName(member)}
                      avatarUrl={member.avatar_url}
                      presence={effectivePresence(member)}
                      small
                    />
                    <div>
                      <strong>{memberName(member)}</strong>
                      <span>{formatLastSeen(member.last_seen_at)}</span>
                    </div>
                    <ArrowUpRight size={15} />
                  </button>
                ))
              ) : (
                <p className="today-muted">No recent activity to show.</p>
              )}
            </div>
          </TodayPanel>
        </aside>
      </div>
      <div className="today-lower-grid">
        <TodayPanel
          panelKey="team-attention"
          title="Team attention"
          description={
            canManageMembers
              ? "Exceptions worth acting on"
              : "Work that may need help"
          }
          open={panelOpen("team-attention")}
          onToggle={() => togglePanel("team-attention")}
          className="today-attention-panel"
          action={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onNavigate("Team")}
            >
              Open board <ArrowUpRight size={14} />
            </Button>
          }
        >
          {openExceptions.length ? (
            <div className="today-exception-list">
              {openExceptions.map((task) => (
                <article className="today-exception-row" key={task.id}>
                  <button
                    type="button"
                    className="today-exception-main"
                    onClick={() => onOpenTask(task)}
                  >
                    <span className={`status-dot ${task.status}`} />
                    <span className="today-exception-copy">
                      <strong>{task.title}</strong>
                      <small>
                        {task.assignee_id ? taskAssigneeLabel(task) : "Unassigned"}
                        {" - "}
                        {exceptionReason(task)}
                      </small>
                    </span>
                  </button>
                  <span className={`today-exception-priority ${task.priority || "normal"}`}>
                    {task.priority || "normal"}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => onComplete(task.id)}
                    aria-label={`Complete ${task.title}`}
                    title={`Complete ${task.title}`}
                  >
                    <Check size={14} />
                  </Button>
                </article>
              ))}
            </div>
          ) : (
            <p className="today-muted">No team exceptions right now.</p>
          )}
        </TodayPanel>
        <TodayPanel
          panelKey="check-ins"
          title="Check-ins"
          description="Keep the team aligned"
          open={panelOpen("check-ins")}
          onToggle={() => togglePanel("check-ins")}
          className="today-checkin-panel"
        >
          <strong className="today-checkin-count">
            {checkedInMemberIds.size} of {members.length}
          </strong>
          <span className="today-muted">check-ins received today</span>
          {missingCheckInMembers.length ? (
            <div className="today-checkin-members">
              <span>Waiting on</span>
              {missingCheckInMembers.slice(0, 4).map((member) => (
                <b key={member.id}>{memberName(member)}</b>
              ))}
              {missingCheckInMembers.length > 4 && (
                <b>+{missingCheckInMembers.length - 4} more</b>
              )}
            </div>
          ) : (
            <p className="today-muted">Everyone has checked in today.</p>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onNavigate("Check-ins")}
          >
            {checkedInMemberIds.size ? "View check-ins" : "Start check-in"}
          </Button>
        </TodayPanel>
      </div>
      <MemberProfilePopup member={profileMember} onClose={() => setProfileMember(null)} onMessage={messageOnlineMember} />
    </section>
  );
}

export {
  TeamBoardView,
  MyTasksView,
  ProjectProgress,
  ProjectOperationsSummary,
  ProjectRiskIssuePanel,
  ClockInCard,
  ProjectStakeholderResourcePanel,
  ProjectCostBudgetPanel,
  TodayDashboard,
};
