// Board and dashboard views: the team board, the personal task queue, the Today
// dashboard, and the panels they embed (project progress, risks/issues,
// stakeholders and resources, and the time clock).

import React, { useEffect, useState } from "react";
import toast from "react-hot-toast";
import {
  AlertTriangle,
  Archive,
  ArrowUpRight,
  Brush,
  CalendarCheck2,
  CalendarDays,
  Check,
  CheckCircle2,
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
import { SearchInput } from "./ui/search-input.jsx";
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
  formatCompletedAgo,
  formatEstimateMinutes,
  formatDayMonthName,
  formatLastSeen,
  formatTodayEyebrow,
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
import { cn } from "../lib/utils.js";
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

// Status wording and skin for the Today card's badges. The fills come from the
// status ramp in workspace.css, so a badge, a board card and a drawer cannot
// drift apart on the same status.
const STATUS_LABEL = {
  todo: "To do",
  "in progress": "In progress",
  review: "Review",
  blocked: "Blocked",
  on_hold: "On hold",
  cancelled: "Cancelled",
  done: "Done",
};
const STATUS_PILL = {
  todo: "bg-status-todo-bg text-status-todo",
  "in progress": "bg-status-progress-bg text-status-progress",
  review: "bg-status-review-bg text-status-review",
  blocked: "bg-status-blocked-bg text-status-blocked",
  on_hold: "bg-status-hold-bg text-status-hold",
  cancelled: "bg-status-cancelled-bg text-status-cancelled",
  done: "bg-status-done-bg text-status-done",
};
// The By-status breakdown paints dots and bars from the mark ramp rather than
// the pill ramp above: see the token block in workspace.css for why.
const STATUS_MARK = {
  todo: "bg-status-todo-mark",
  "in progress": "bg-status-progress-mark",
  review: "bg-status-review-mark",
  blocked: "bg-status-blocked-mark",
  on_hold: "bg-status-hold-mark",
  cancelled: "bg-status-cancelled-mark",
  done: "bg-status-done-mark",
};
// The colour bar down the left of an upcoming event, keyed off the event types
// the composer offers.
const EVENT_BAR_TONE = {
  meeting: "bg-navy",
  focus: "bg-info",
  deadline: "bg-danger",
  reminder: "bg-bronze",
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

  // P9 is a single capacity view, not a second dashboard with internal tabs.
  // Keep the existing profile and invitation actions, but present the same live
  // data in the structure supplied by the Pencil frame.
  const capacityHours = Math.max(members.length * 24, 1);
  const allocatedHours = visibleMemberStats.reduce(
    (total, item) => total + Math.min(24, item.open * 3),
    0,
  );
  const availabilityRows = visibleMemberStats.slice(0, 6);
  const availabilityLabel = (item) => {
    if (item.open > 8) return "Overloaded";
    if (item.open > 5) return "At capacity";
    if (effectivePresence(item.member) === "away") return "Away";
    return "Available";
  };
  const availabilityCounts = availabilityRows.reduce((counts, item) => {
    const label = availabilityLabel(item).toLowerCase().replace(" ", "-");
    counts[label] = (counts[label] || 0) + 1;
    return counts;
  }, {});
  return (
    <section className="workspace-view pencil-team-view">
      <WorkspaceViewHeading
        eyebrow="People and capacity"
        title="Team"
        subtitle="Who is working on what, and where capacity or risk sits this week."
        action={canManageMembers ? "Invite" : undefined}
        icon={Users}
        onAction={onInvite}
      />
      <div className="pencil-team-filters" role="tablist" aria-label="Team capacity filters">
        <button type="button" className="active" onClick={() => setQuery("")}>All {members.length}</button>
        <button type="button" onClick={() => setQuery("")}>Available {availabilityCounts.available || 0}</button>
        <button type="button" onClick={() => setQuery("")}>At capacity {availabilityCounts["at-capacity"] || 0}</button>
        <button type="button" onClick={() => setQuery("")}>Overloaded {availabilityCounts.overloaded || 0}</button>
      </div>
      <div className="pencil-team-layout">
        <div className="pencil-team-main">
          <p className="pencil-team-list-label">{members.length} members · {visibleMemberStats.filter((item) => item.risk > 0).length} needs attention</p>
          <div className="pencil-team-table" role="list">
            <div className="pencil-team-table-head" aria-hidden="true"><span>Member</span><span>Availability</span><span>Workload</span><span>Tasks</span><span /></div>
            {availabilityRows.map((item) => {
              const label = availabilityLabel(item);
              const workload = Math.min(100, Math.round((item.open / 8) * 100));
              return <article className="pencil-team-row" role="listitem" key={item.member.id}>
                <button type="button" className="pencil-team-person" onClick={() => setProfileMember(item.member)} aria-label={`Open ${memberName(item.member)} profile`}>
                  <Avatar name={memberName(item.member)} avatarUrl={item.member.avatar_url} presence={effectivePresence(item.member)} />
                  <span><strong>{memberName(item.member)}</strong><small>{item.member.job_role || item.member.role || "Member"}</small></span>
                </button>
                <span className={`pencil-team-status ${label.toLowerCase().replace(" ", "-")}`}>{label}</span>
                <span className="pencil-team-workload"><small>{Math.min(item.open * 3, 28)}h / 24h</small><i><b style={{ width: `${workload}%` }} /></i></span>
                <span className="pencil-team-task-count">{item.open} tasks</span>
                <button type="button" className="pencil-team-message" onClick={() => setProfileMember(item.member)} aria-label={`Message ${memberName(item.member)}`}><MessageSquare size={18} /></button>
              </article>;
            })}
            {!availabilityRows.length && <EmptyState text="No team members yet." />}
          </div>
        </div>
        <aside className="pencil-team-side">
          <section className="pencil-team-card">
            <h2>Team capacity</h2><p>{members.length} members · capacity {capacityHours}h</p>
            <strong>{allocatedHours}h <small>/ {capacityHours}h</small></strong>
            <div className="pencil-team-capacity"><i style={{ width: `${Math.min(100, Math.round((allocatedHours / capacityHours) * 100))}%` }} /></div>
            <span>{Math.min(100, Math.round((allocatedHours / capacityHours) * 100))}% allocated · {Math.max(0, capacityHours - allocatedHours)}h remaining</span>
          </section>
          <section className="pencil-team-card">
            <h2>Availability</h2>
            {[['Available', 'available'], ['At capacity', 'at-capacity'], ['Overloaded', 'overloaded'], ['Away', 'away']].map(([label, key]) => <div className="pencil-team-breakdown" key={key}><span><i className={key} />{label}</span><b style={{ width: `${members.length ? ((availabilityCounts[key] || 0) / members.length) * 108 : 0}px` }} /> <em>{availabilityCounts[key] || 0}</em></div>)}
            <small>Capacity is measured in hours allocated this week.</small>
          </section>
          {canManageMembers && <section className="pencil-team-card pencil-team-invites"><h2>Pending invitations</h2>{invitations.filter((item) => item.status === 'pending').slice(0, 2).map((item) => <div key={item.id}><span>{item.email}<small>Invited as {item.role}</small></span><button type="button" onClick={() => onResendInvitation(item)}>Resend</button></div>)}<button type="button" className="pencil-team-invite-button" onClick={onInvite}><Users size={16} /> Invite someone</button></section>}
        </aside>
      </div>
      <MemberProfilePopup member={profileMember} onClose={() => setProfileMember(null)} onMessage={sendMemberMessage} tasks={profileMember ? (usesServerTasks ? profileTasks : tasksForMember(profileMember)) : []} stats={profileMember ? memberStats.find((item) => String(item.member.id) === String(profileMember.id)) || null : null} tasksLoading={profileTasksLoading} checkIn={profileMember ? checkInForMember(profileMember) : null} shift={profileMember ? openShiftForMember(profileMember) : null} todayWorkedSeconds={profileMember ? workedTodayForMember(profileMember) : 0} today={today} onOpenTask={(task) => { setProfileMember(null); onOpenTask(task); }} />
    </section>
  );
  return (
    <section className="workspace-view team-board-view">
      <WorkspaceViewHeading
        title="Team"
        subtitle="See workload, availability, and the work that needs attention."
        action={canManageMembers ? "Invite team member" : undefined}
        icon={Users}
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
  members = [],
  onAddTask,
  onOpenTask,
  onComplete,
  onStatusChange,
  onDelete,
  canManageTasks,
}) {
  const today = toDateKey(new Date());
  // A week out, not "this calendar week": the workload card answers "what is
  // already on me", and work due the day after a Sunday is on me today.
  const weekEnd = addDaysToDateKey(today, 7);
  const [status, setStatus] = useState("all");
  const [priority, setPriority] = useState("all");
  const [project, setProject] = useState("all");
  const [bucket, setBucket] = useState("all");
  const [sort, setSort] = useState("due");
  const [query, setQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [completedOpen, setCompletedOpen] = useState(false);

  const mine = tasks.filter((task) =>
    taskIsAssignedTo(task, currentUserId, currentUserName),
  );
  const overdue = (task) =>
    Boolean(task.due_date && task.due_date < today && isOpenTask(task));
  const dueToday = (task) => task.due_date === today && isOpenTask(task);
  const openMine = mine.filter(isOpenTask);
  const completedMine = mine.filter((task) => task.status === "done");

  const priorityRank = { urgent: 0, high: 1, normal: 2, low: 3 };
  const compare = (a, b) => {
    if (sort === "recent") {
      return (
        String(b.completed_at || "").localeCompare(String(a.completed_at || "")) ||
        b.id - a.id
      );
    }
    if (sort === "priority") {
      return (
        (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9) ||
        (a.due_date || "9999-12-31").localeCompare(b.due_date || "9999-12-31") ||
        a.id - b.id
      );
    }
    return (
      (a.due_date || "9999-12-31").localeCompare(b.due_date || "9999-12-31") ||
      (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9) ||
      a.id - b.id
    );
  };
  const matchesFilters = (task) => {
    if (status !== "all" && task.status !== status) return false;
    if (priority !== "all" && task.priority !== priority) return false;
    if (project !== "all" && String(task.project_id || "") !== project)
      return false;
    if (bucket !== "all" && task.bucket !== bucket) return false;
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return [
      task.title,
      task.description,
      task.tag,
      task.bucket,
      ...(task.labels || []),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(needle);
  };

  const sortLabels = {
    due: "due date",
    priority: "priority",
    recent: "recently completed",
  };
  const openVisible = openMine.filter(matchesFilters).sort(compare);
  const completedVisible = completedMine.filter(matchesFilters).sort(compare);

  // The design's Today group is today *and* anything past due: an overdue task
  // is work for today, and hiding it in a group of its own would let the two
  // lists disagree about how much is on the person.
  const groups = [
    {
      key: "today",
      label: "Today",
      items: openVisible.filter((task) => task.due_date && task.due_date <= today),
    },
    {
      key: "week",
      label: "This week",
      items: openVisible.filter(
        (task) => task.due_date > today && task.due_date <= weekEnd,
      ),
    },
    {
      key: "later",
      label: "Later",
      items: openVisible.filter((task) => task.due_date > weekEnd),
    },
    {
      key: "undated",
      label: "No due date",
      items: openVisible.filter((task) => !task.due_date),
    },
  ].filter((group) => group.items.length);

  const estimateTotal = (items) =>
    items.reduce((total, task) => total + (task.estimate_minutes || 0), 0);

  // The workload card needs a denominator. It comes from the member's own
  // profile, and the fallback is the model's default so a workspace that has
  // never set one still gets a truthful ratio against 40 hours.
  const me = members.find((member) => String(member.id) === String(currentUserId));
  const capacityMinutes = Number(me?.weekly_capacity_minutes) || 2400;
  const capacityHours = Math.round(capacityMinutes / 60);
  const weekLoad = openMine.filter(
    (task) => task.due_date && task.due_date <= weekEnd,
  );
  const plannedMinutes = weekLoad.reduce(
    (total, task) => total + (task.estimate_minutes || 0),
    0,
  );
  // Nothing estimated is not the same as nothing planned. A bar sitting at 0%
  // would claim the week is clear when the truth is that nobody has said.
  const hasEstimates = weekLoad.some((task) => task.estimate_minutes);
  const allocatedPercent = Math.min(
    100,
    Math.round((plannedMinutes / capacityMinutes) * 100),
  );
  const remainingMinutes = Math.max(0, capacityMinutes - plannedMinutes);

  const statusRows = [
    "todo",
    "in progress",
    "review",
    "blocked",
    "on_hold",
    "cancelled",
    "done",
  ].map((key) => ({ key, label: STATUS_LABEL[key], count: mine.filter((task) => task.status === key).length }));
  const statusCeiling = Math.max(1, ...statusRows.map((row) => row.count));

  const recentlyCompleted = [...completedMine]
    .sort(
      (a, b) =>
        String(b.completed_at || "").localeCompare(String(a.completed_at || "")) ||
        b.id - a.id,
    )
    .slice(0, 4);

  const squadFor = (task) => {
    const owner = projects.find(
      (item) => String(item.id) === String(task.project_id),
    );
    return owner?.name || task.tag || task.bucket || "General";
  };
  const duePhrase = (task) => {
    if (!task.due_date) return "No due date";
    if (task.due_date < today) {
      const days = Math.round(
        (new Date(`${today}T12:00:00`) - new Date(`${task.due_date}T12:00:00`)) /
          86400000,
      );
      return days === 1 ? "1 day overdue" : `${days} days overdue`;
    }
    if (task.due_date === today) return "due today";
    return `due ${formatDayMonthName(task.due_date)}`;
  };
  // Whose avatar sits at the end of the row. The member record is the better
  // source when it resolves, but the task carries the assignee's display name
  // from the API, which is what shows when there is no member row to match.
  const ownerName = (task) => {
    const assignee = members.find(
      (member) => String(member.id) === String(task.assignee_id),
    );
    const full = assignee
      ? [assignee.first_name, assignee.last_name].filter(Boolean).join(" ")
      : "";
    return full || task.member || "Unassigned";
  };
  const dueLabel = (task) => {
    if (!task.due_date) return "No due date";
    if (task.due_date < today) return "Overdue";
    if (task.due_date === today) return "Today";
    return formatDayMonthName(task.due_date);
  };
  const rowMeta = (task) =>
    [
      squadFor(task),
      duePhrase(task),
      task.estimate_minutes ? `${formatEstimateMinutes(task.estimate_minutes)} est` : "",
    ]
      .filter(Boolean)
      .join(" · ");

  const filterCount = [
    status !== "all",
    priority !== "all",
    project !== "all",
    bucket !== "all",
  ].filter(Boolean).length;
  const summaryLine = [
    `${openMine.length} open`,
    `${openMine.filter(dueToday).length} due today`,
    `${openMine.filter(overdue).length} overdue`,
    `sorted by ${sortLabels[sort]}`,
  ].join(" · ");

  const statusOptions = (
    <>
      <option value="todo">To do</option>
      <option value="in progress">In progress</option>
      <option value="review">Review</option>
      <option value="blocked">Blocked</option>
      <option value="on_hold">On hold</option>
      <option value="cancelled">Cancelled</option>
      <option value="done">Done</option>
    </>
  );

  const renderRow = (task) => {
    const done = task.status === "done";
    const assignee = members.find(
      (member) => String(member.id) === String(task.assignee_id),
    );
    return (
      <article
        key={task.id}
        className="my-task-row group/card flex items-center gap-3 rounded-card border border-border bg-card px-5 py-6 shadow-card"
      >
        <button
          type="button"
          role="checkbox"
          aria-checked={done}
          onClick={() => onComplete(task.id)}
          aria-label={`${done ? "Reopen" : "Complete"} ${task.title}`}
          title={done ? "Reopen task" : "Mark task complete"}
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded-badge border transition-colors",
            done
              ? "border-success bg-success text-white"
              : "border-border-strong text-transparent hover:border-navy",
          )}
        >
          <Check size={14} strokeWidth={3} aria-hidden="true" />
        </button>
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => onOpenTask(task)}
            className={cn(
              "block max-w-full truncate text-left text-body-small font-medium text-text-primary hover:underline",
              done && "text-text-muted line-through",
            )}
          >
            {task.title}
          </button>
          <span className="mt-0.5 block truncate text-caption text-text-muted">
            {rowMeta(task)}
          </span>
        </div>
        <AppSelect
          className={cn("task-status-pill", task.status)}
          value={task.status}
          onChange={(event) => onStatusChange(task.id, event.target.value)}
          aria-label={`Change status for ${task.title}`}
        >
          {statusOptions}
        </AppSelect>
        <span
          className={cn(
            "hidden w-16 shrink-0 text-right text-caption sm:block",
            task.due_date && task.due_date < today && !done
              ? "font-medium text-danger"
              : "text-text-muted",
          )}
        >
          {dueLabel(task)}
        </span>
        {/* The row shows whose task it is, so the picture belongs to the
            assignee rather than to whoever is looking. No presence dot here:
            the design's row circle is bare, and the dot would also read as a
            status mark sitting where the status column already is. */}
        <Avatar
          name={ownerName(task)}
          avatarUrl={assignee?.avatar_url}
          className="row-avatar ml-10"
        />
        {canManageTasks && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={() => onDelete(task.id)}
            aria-label={`Archive ${task.title}`}
            title="Archive task"
            className="opacity-0 transition-opacity group-hover/card:opacity-100 focus-visible:opacity-100"
          >
            <Archive size={14} />
          </Button>
        )}
      </article>
    );
  };

  const activeList = completedOpen ? completedVisible : openVisible;
  const rowGroups = completedOpen
    ? activeList.length
      ? [{ key: "completed", label: "Completed", items: activeList }]
      : []
    : groups;

  return (
    <section className="workspace-view my-tasks-view pb-10">
      <header className="my-task-header flex flex-wrap items-start justify-between gap-4 border-b border-border pb-[18px]">
        <div className="min-w-0">
          <p className="text-overline uppercase text-navy">All work</p>
          <h1 className="mt-1 text-page-heading text-text-primary">My tasks</h1>
          <p className="mt-1.5 text-body-small text-text-muted">{summaryLine}</p>
        </div>
        <Button type="button" size="page" onClick={onAddTask}>
          <Plus size={18} strokeWidth={2} aria-hidden="true" /> New task
        </Button>
      </header>

      <div className="my-task-layout mt-3.5 grid gap-6 lg:grid-cols-[minmax(0,1fr)_376px]">
        <div className="my-task-results min-w-0">
          <div className="my-task-filters flex flex-wrap items-center gap-4">
            <SearchInput
              className="w-full sm:w-[280px]"
              label="Search my tasks"
              placeholder="Search my tasks"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <AppSelect
              className="chip-select w-full sm:w-[200px]"
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
            <Button
              type="button"
              variant="outline"
              onClick={() => setFiltersOpen((open) => !open)}
              aria-expanded={filtersOpen}
            >
              <Filter size={20} aria-hidden="true" /> Filter
              {filterCount > 0 && ` (${filterCount})`}
            </Button>
            <AppSelect
              className="chip-select chip-select-plain"
              value={sort}
              onChange={(event) => setSort(event.target.value)}
              aria-label="Sort tasks"
              renderValue={() => "Sort"}
            >
              <option value="due">Due date</option>
              <option value="priority">Priority</option>
              <option value="recent">Recently completed</option>
            </AppSelect>
          </div>

          {filtersOpen && (
            <div className="my-task-filter-panel mt-3 flex flex-wrap items-center gap-4 rounded-card border border-border bg-card px-5 py-4">
              <AppSelect
                className="chip-select"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                aria-label="Filter by status"
              >
                <option value="all">All statuses</option>
                {statusOptions}
              </AppSelect>
              <AppSelect
                className="chip-select"
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
                className="chip-select"
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
              {filterCount > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setStatus("all");
                    setPriority("all");
                    setProject("all");
                    setBucket("all");
                  }}
                >
                  Clear filters
                </Button>
              )}
            </div>
          )}

          <div className="my-task-groups mt-[30px] grid gap-8">
            {rowGroups.map((group) => (
              <section className="my-task-group" key={group.key}>
                <div className="my-task-group-heading mb-2 flex items-center justify-between gap-3">
                  <h2 className="text-subheading text-text-primary">{group.label}</h2>
                  <span className="text-caption text-text-muted">
                    {group.items.length}{" "}
                    {group.items.length === 1 ? "task" : "tasks"}
                    {estimateTotal(group.items)
                      ? ` · ${formatEstimateMinutes(estimateTotal(group.items))} estimated`
                      : ""}
                  </span>
                </div>
                <div className="grid gap-3">{group.items.map(renderRow)}</div>
              </section>
            ))}

            {!rowGroups.length && (
              <div className="my-task-empty grid justify-items-center gap-2 rounded-card border border-border bg-card px-5 py-12 text-center">
                <CheckCircle2 size={22} className="text-text-muted" aria-hidden="true" />
                <p className="text-body-small text-text-secondary">
                  {completedOpen
                    ? "Nothing completed yet."
                    : query.trim() || filterCount
                      ? "No task matches these filters."
                      : "Nothing is assigned to you. Enjoy the quiet."}
                </p>
                {!completedOpen && !query.trim() && !filterCount && (
                  <Button type="button" variant="ghost" size="sm" onClick={onAddTask}>
                    Add your first task <ArrowUpRight size={14} aria-hidden="true" />
                  </Button>
                )}
              </div>
            )}
          </div>
        </div>

        <aside className="my-task-sidebar grid content-start gap-5">
          <section className="my-task-summary rounded-card border border-border bg-card p-5">
            <h2 className="text-subheading text-text-primary">My workload</h2>
            <p className="mt-[5px] text-caption text-text-muted">
              This week &middot; capacity {capacityHours}h
            </p>
            {hasEstimates ? (
              <>
                <p className="mt-[7px] flex items-baseline gap-1.5">
                  <strong className="text-page-heading text-text-primary">
                    {formatEstimateMinutes(plannedMinutes)}
                  </strong>
                  <span className="text-body-compact text-text-muted">
                    / {capacityHours}h
                  </span>
                </p>
                <div className="mt-[14px] h-2.5 overflow-hidden rounded-full bg-border">
                  <div
                    className="h-full rounded-full bg-navy"
                    style={{ width: `${allocatedPercent}%` }}
                  />
                </div>
                <p className="mt-2 text-caption text-text-muted">
                  {allocatedPercent}% allocated &middot;{" "}
                  {formatEstimateMinutes(remainingMinutes)} remaining
                </p>
              </>
            ) : (
              <p className="mt-3 text-body-small text-text-secondary">
                No estimates yet. Add a time estimate to a task and this fills in.
              </p>
            )}
            <p className="mt-[13px] flex items-center gap-2 text-caption text-text-secondary">
              <span
                className="size-2 shrink-0 rounded-full bg-warning-fill"
                aria-hidden="true"
              />
              {openMine.filter(dueToday).length} due today &middot;{" "}
              {openMine.filter(overdue).length} overdue
            </p>
          </section>

          <section className="my-task-status rounded-card border border-border bg-card p-5">
            <h2 className="text-subheading text-text-primary">By status</h2>
            <div className="mt-[17px] grid gap-[18px]">
              {statusRows.map((row) => (
                <button
                  key={row.key}
                  type="button"
                  onClick={() =>
                    setStatus((current) => (current === row.key ? "all" : row.key))
                  }
                  aria-pressed={status === row.key}
                  className="flex items-center gap-2 text-left"
                >
                  <span
                    className={cn(
                      "size-2 shrink-0 rounded-full",
                      STATUS_MARK[row.key],
                    )}
                    aria-hidden="true"
                  />
                  <span className="w-[104px] shrink-0 text-caption text-text-secondary">
                    {row.label}
                  </span>
                  {/* No track behind the bar: the design draws a bare segment on
                      the card, so an empty status reads as nothing there rather
                      than as a full-width empty rail. */}
                  <span
                    className={cn("ml-0.5 h-1.5 w-40 shrink-0 rounded-full", STATUS_MARK[row.key])}
                    style={{ width: `${(row.count / statusCeiling) * 160}px` }}
                  />
                  <span className="ml-auto text-caption font-semibold text-text-primary">
                    {row.count}
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="my-task-completed rounded-card border border-border bg-card p-5">
            <h2 className="text-subheading text-text-primary">
              Recently completed
            </h2>
            <div className="mt-[17px] grid gap-[21px]">
              {recentlyCompleted.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  onClick={() => onOpenTask(task)}
                  className="flex items-start gap-2 text-left"
                >
                  <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-success-soft text-success">
                    <Check size={12} strokeWidth={3} aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-body-compact text-text-muted line-through">
                      {task.title}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] leading-[13px] text-text-subtle">
                      {formatCompletedAgo(task.completed_at || task.updated_at)}{" "}
                      &middot; {squadFor(task)}
                    </span>
                  </span>
                </button>
              ))}
              {!recentlyCompleted.length && (
                <p className="text-caption text-text-muted">Nothing completed yet.</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setCompletedOpen((open) => !open)}
              className="mt-[9px] text-caption font-medium text-navy transition-colors hover:text-text-primary"
            >
              {completedOpen ? "Back to open work" : "View all completed"}
            </button>
          </section>
        </aside>
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
  design = "default",
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

  if (design === "p32") {
    const openRisks = risks.filter((item) => !["mitigated", "closed"].includes(item.status));
    const openIssues = issues.filter((item) => !["resolved", "closed"].includes(item.status));
    const highRisk = risks.filter((item) => ["high", "critical"].includes(item.severity));
    const escalated = items.filter((item) => item.escalation && !["closed", "resolved"].includes(item.status));
    return (
      <section className="project-risk-design">
        <div className="project-risk-metrics">
          <div><span>Open risks</span><strong>{openRisks.length}</strong><small>Unmitigated threats</small></div>
          <div><span>Open issues</span><strong>{openIssues.length}</strong><small>Active delivery blockers</small></div>
          <div><span>High severity</span><strong>{highRisk.length}</strong><small>Requires attention</small></div>
          <div><span>Escalations</span><strong>{escalated.length}</strong><small>Needs an owner decision</small></div>
        </div>
        <div className="project-risk-design-grid">
          <section className="project-risk-design-card"><div className="project-risk-design-heading"><h2>Risk by status</h2><span>{risks.length} risks</span></div>{["open", "mitigated", "closed"].map((status) => <div className="project-risk-bar" key={status}><span>{status}</span><i><b style={{ width: `${risks.length ? Math.round((risks.filter((item) => item.status === status).length / risks.length) * 100) : 0}%` }} /></i><strong>{risks.filter((item) => item.status === status).length}</strong></div>)}</section>
          <section className="project-risk-design-card"><div className="project-risk-design-heading"><h2>Risk matrix</h2><span>Likelihood × impact</span></div><div className="project-risk-matrix">{["Low", "Medium", "High"].map((impact) => <div key={impact}><span>{impact}</span><b>{risks.filter((item) => String(item.impact || "").toLowerCase() === impact.toLowerCase()).length}</b></div>)}</div></section>
        </div>
        <h2 className="project-risk-summary-label">Risk summary</h2>
        <div className="project-risk-escalation"><strong>Escalation watch</strong><span>{escalated.length ? `${escalated.length} records need a decision owner.` : "No active escalations."}</span><button type="button" onClick={openAddModal}>Add risk or issue <Plus size={14} /></button></div>
        <Card className="project-register-card project-risk-design-table"><div className="project-register-toolbar"><div className="project-register-tabs" role="tablist" aria-label="Project risk register"><button type="button" className={activeTab === "risk" ? "active" : ""} onClick={() => setActiveTab("risk")}>Risk register <span>{risks.length}</span></button><button type="button" className={activeTab === "issue" ? "active" : ""} onClick={() => setActiveTab("issue")}>Issue log <span>{issues.length}</span></button></div>{canManage && <button type="button" className="primary-button project-register-add" onClick={openAddModal}><Plus size={15} /> Add new</button>}</div><div className="project-register-table-wrap"><table className="project-register-table"><thead><tr><th>{activeTab === "risk" ? "Risk" : "Issue"}</th><th>Severity</th><th>Owner</th><th>Target date</th><th>Status</th><th /></tr></thead><tbody>{pageItems.length ? pageItems.map((item) => <tr key={item.id}><td><strong>{item.title}</strong><span>{item.detail || "No description added."}</span></td><td><span className={`record-severity ${item.severity}`}>{item.severity}</span></td><td>{item.owner || <span className="table-muted">Unassigned</span>}</td><td>{item.due || <span className="table-muted">No date</span>}</td><td>{canManage ? <AppSelect value={item.status} onChange={(event) => updateStatus(item.id, event.target.value)} aria-label={`Set status for ${item.title}`}>{statuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</AppSelect> : item.status}</td><td>{canManage && <button type="button" className="inline-delete" onClick={() => remove(item.id)} aria-label={`Delete ${item.title}`}><X size={14} /></button>}</td></tr>) : <tr><td className="project-register-empty" colSpan="6"><Brush size={22} /><strong>No {activeTab === "risk" ? "risks" : "issues"} yet</strong><span>Add a record to begin tracking project controls.</span></td></tr>}</tbody></table></div></Card>
        {modalOpen && <div className="project-register-modal" role="dialog" aria-modal="true"><form onSubmit={addRecord}><div className="drawer-section-heading"><h3>Add {kind}</h3><button type="button" className="inline-delete" onClick={() => setModalOpen(false)} aria-label="Close"><X size={14} /></button></div><label>Title<input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} required /></label><label>Details<textarea value={form.detail} onChange={(event) => setForm((current) => ({ ...current, detail: event.target.value }))} /></label><label>Severity<AppSelect value={form.severity} onChange={(event) => setForm((current) => ({ ...current, severity: event.target.value }))}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option></AppSelect></label><button type="submit" className="primary-button">Save {kind}</button></form></div>}
      </section>
    );
  }

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
  const mine = (shifts || []).filter(
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
    <div className="rounded-container bg-navy p-5 text-text-on-navy">
      <p className="text-caption opacity-70">{headline}</p>
      <strong
        className="mt-1 block text-[32px] font-bold leading-tight tabular-nums"
        role="timer"
        aria-live="off"
        aria-label={`Current shift ${formatShiftDuration(shiftSeconds)}`}
      >
        {formatShiftDuration(shiftSeconds)}
      </strong>
      <p className="mt-1 text-caption opacity-70">
        {dayTotalSeconds
          ? `Today ${formatShiftDuration(dayTotalSeconds)}`
          : "Nothing logged today"}
        {shiftBreakSeconds
          ? ` · Breaks ${formatShiftDuration(shiftBreakSeconds)}`
          : ""}
      </p>
      {onBreak && (
        <p className={`mt-1 text-caption ${breakOverrun ? "font-medium" : "opacity-70"}`}>
          {breakPlanSeconds
            ? breakOverrun
              ? `${BREAK_PRESET_LABEL[openShift.break_plan_minutes]} break is over by ${formatShiftDuration(-breakRemaining)}`
              : `${formatShiftDuration(breakRemaining)} left of your ${BREAK_PRESET_LABEL[openShift.break_plan_minutes]} break`
            : `Break running ${formatShiftDuration(runningBreakSeconds)}`}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {!openShift && (
          <button
            type="button"
            disabled={Boolean(pending)}
            onClick={() => run("clock_in")}
            className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-control bg-white/10 text-caption font-medium transition-colors hover:bg-white/20 disabled:opacity-50"
          >
            <Play size={14} aria-hidden="true" /> Clock in
          </button>
        )}
        {openShift && onBreak && (
          <button
            type="button"
            disabled={Boolean(pending)}
            onClick={() => run("end_break")}
            className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-control bg-white/10 text-caption font-medium transition-colors hover:bg-white/20 disabled:opacity-50"
          >
            <Play size={14} aria-hidden="true" /> Continue
          </button>
        )}
        {openShift &&
          !onBreak &&
          BREAK_PRESETS.map((minutes) => (
            <button
              key={minutes}
              type="button"
              disabled={Boolean(pending)}
              onClick={() => run("start_break", minutes)}
              className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-control bg-white/10 text-caption font-medium transition-colors hover:bg-white/20 disabled:opacity-50"
            >
              <Pause size={14} aria-hidden="true" /> {BREAK_PRESET_LABEL[minutes]}
            </button>
          ))}
      </div>
      {openShift && (
        <button
          type="button"
          disabled={Boolean(pending)}
          onClick={() => run("clock_out")}
          className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-control bg-white text-label font-medium text-navy transition-colors hover:bg-white/90 disabled:opacity-50"
        >
          <Square size={15} aria-hidden="true" /> Clock out
        </button>
      )}
      <div className="mt-2 flex items-center gap-2">
        <span className={`presence-dot presence-${presence}`} aria-hidden="true" />
        <span className="text-caption opacity-70">Status</span>
        <AppSelect
          className="clock-status-select"
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
      </div>
    </div>
  );
}

function ProjectStakeholderResourcePanel({
  project,
  workspaceId,
  canManage,
  tasks = [],
  design = "default",
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
  if (design === "p34") {
    const capacityTotal = resources.reduce((sum, item) => sum + Number(item.capacity_percent || 0), 0);
    const allocationTotal = resources.reduce((sum, item) => sum + Number(item.allocation_percent || 0), 0);
    return (
      <section className="project-resources-design">
        <div className="project-resource-actions-card"><div><p className="eyebrow">Project delivery</p><h2>Resource planning</h2><p>Assign people, capacity, and stakeholders to this project.</p></div>{canManage && <div className="project-resource-actions"><form onSubmit={addResource}><input value={resourceForm.name} onChange={(event) => setResourceForm((current) => ({ ...current, name: event.target.value }))} placeholder="Resource name" aria-label="Resource name" required /><button type="submit" className="primary-button"><Plus size={15} /> Add resource</button></form><form onSubmit={addStakeholder}><input value={stakeholderForm.name} onChange={(event) => setStakeholderForm((current) => ({ ...current, name: event.target.value }))} placeholder="Stakeholder name" aria-label="Stakeholder name" required /><button type="submit" className="secondary-button"><Plus size={15} /> Add stakeholder</button></form></div>}</div>
        <section className="project-resource-stakeholder-table project-resources-design-card"><div className="project-resources-design-heading"><h2>Stakeholders</h2><span>{stakeholders.length}</span></div><div className="project-resources-table-head"><span>Name</span><span>Role</span><span>Influence</span><span>Interest</span></div>{stakeholders.map((item) => <div className="project-resources-table-row" key={item.id}><strong>{item.name}</strong><span>{item.role || "—"}</span><span>{item.influence || "—"}</span><span>{item.interest || "—"}</span></div>)}{!stakeholders.length && <p className="project-detail-empty">No stakeholders assigned yet.</p>}</section>
        <div className="project-resources-lower-grid"><section className="project-resources-design-card project-resource-table"><div className="project-resources-design-heading"><h2>Resources</h2><span>{resources.length}</span></div><div className="project-resources-table-head"><span>Resource</span><span>Role</span><span>Allocation</span><span>Capacity</span></div>{resources.map((item) => <div className="project-resources-table-row" key={item.id}><strong>{item.name}</strong><span>{item.role || item.resource_type || "—"}</span><span>{item.allocation_percent || 0}%</span><span>{item.capacity_percent || 0}%</span></div>)}{!resources.length && <p className="project-detail-empty">No resources assigned yet.</p>}</section><section className="project-resources-design-card project-capacity-card"><div className="project-resources-design-heading"><h2>Capacity</h2><span>{allocationTotal}% allocated</span></div><div className="project-capacity-track"><span style={{ width: `${Math.min(allocationTotal, 100)}%` }} /></div><p>{allocationTotal}% of {capacityTotal || 0}% available capacity allocated.</p><div className="project-capacity-legend"><span><i />Allocated</span><span><i />Available</span></div></section><section className="project-resources-design-card project-influence-card"><div className="project-resources-design-heading"><h2>Influence matrix</h2><span>Stakeholder view</span></div><div className="project-influence-matrix">{["high", "medium", "low"].map((level) => <div key={level}><span>{level} influence</span><strong>{stakeholders.filter((item) => item.influence === level).length}</strong></div>)}</div></section></div>
      </section>
    );
  }

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
  design = "default",
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
  if (design === "p35") {
    const categoryTotals = ["labor", "software", "materials", "travel", "other"].map((category) => ({ category, total: expenses.filter((item) => item.category === category).reduce((sum, item) => sum + Number(item.amount || 0), 0) }));
    const usedPercent = budgetAmount ? Math.min(Math.round((totalSpent / budgetAmount) * 100), 999) : 0;
    return (
      <section className="project-budget-design">
        <div className="project-budget-summary-card project-budget-summary-top"><div className="project-resources-design-heading"><h2>Budget summary</h2><span className="project-currency-badge">{project.budget_currency || "USD"}</span></div><div className="project-budget-summary-values"><div><span>Total budget</span><strong>{budgetAmount === null ? "Not set" : formatMoney(budgetAmount)}</strong></div><div><span>Actual spend</span><strong>{formatMoney(actualSpent)}</strong></div><div><span>Remaining</span><strong>{remaining === null ? "n/a" : formatMoney(remaining)}</strong></div><div><span>Variance</span><strong>{budgetAmount ? `${usedPercent}%` : "n/a"}</strong></div></div><div className="project-budget-usage-track"><span style={{ width: `${usedPercent}%` }} /></div><p className="project-budget-warning">{remaining !== null && remaining < 0 ? "Project is over budget." : "Spend is within the approved project budget."}</p></div>
        <section className="project-budget-expense-table project-budget-card"><div className="project-resources-design-heading"><h2>Expenses</h2><span>{expenses.length} records</span></div><div className="project-resources-table-head"><span>Name</span><span>Category</span><span>Amount</span><span>Date</span></div>{expenses.slice(0, 5).map((item) => <div className="project-resources-table-row" key={item.id}><strong>{item.name}</strong><span>{item.category}</span><span>{formatMoney(item.amount)}</span><span>{item.incurred_on || "—"}</span></div>)}{!expenses.length && <p className="project-detail-empty">No expenses recorded yet.</p>}</section>
        <Card className="project-budget-form-card project-budget-card"><div className="project-resources-design-heading"><h2>Budget target</h2><span>{project.budget_currency || "USD"}</span></div>{canManage && <form className="project-budget-mini-form" onSubmit={saveBudget}><label>Amount<input type="number" min="0" step="0.01" value={budgetForm.budget_amount} onChange={(event) => setBudgetForm((current) => ({ ...current, budget_amount: event.target.value }))} /></label><label>Currency<AppSelect value={budgetForm.budget_currency} onChange={(event) => setBudgetForm((current) => ({ ...current, budget_currency: event.target.value }))}><option value="USD">USD</option><option value="GBP">GBP</option><option value="NGN">NGN</option></AppSelect></label><button type="submit" className="primary-button">Save budget</button></form>}</Card>
        <section className="project-budget-currency-list project-budget-card"><div className="project-resources-design-heading"><h2>Currency</h2><span>Supported</span></div><div className="project-currency-options"><span>USD · US Dollar</span><span>GBP · British Pound</span><span>NGN · Nigerian Naira</span></div></section>
        <section className="project-budget-spend-chart project-budget-card"><div className="project-resources-design-heading"><h2>Spend by category</h2><span>{formatMoney(totalSpent)}</span></div>{categoryTotals.map((item) => <div className="project-budget-category" key={item.category}><span>{item.category}</span><i><b style={{ width: `${totalSpent ? Math.round((item.total / totalSpent) * 100) : 0}%` }} /></i><strong>{formatMoney(item.total)}</strong></div>)}</section>
        <section className="project-budget-add-expense project-budget-card"><div className="project-resources-design-heading"><h2>Add expense</h2><span>Actual or committed</span></div>{canManage && <form className="project-budget-mini-form" onSubmit={addExpense}><label>Name<input value={expenseForm.name} onChange={(event) => setExpenseForm((current) => ({ ...current, name: event.target.value }))} required /></label><label>Amount<input type="number" min="0" step="0.01" value={expenseForm.amount} onChange={(event) => setExpenseForm((current) => ({ ...current, amount: event.target.value }))} required /></label><button type="submit" className="secondary-button"><Plus size={15} /> Add expense</button></form>}</section>
      </section>
    );
  }
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
  onOpenActivity,
  onOpenBoard,
  onComplete,
  onStatusChange,
  onSubmitShift,
  onChangePresence,
}) {
  const [profileMember, setProfileMember] = useState(null);
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
    .slice(0, 20);
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
  // Everything the headline, the tiles and the side rail read is counted from
  // the same lists the panels below render, so a number cannot disagree with
  // the thing it opens.
  const weekAgoKey = addDaysToDateKey(today, -6);
  const completedThisWeek = tasks.filter(
    (task) =>
      task.status === "done" &&
      Boolean(task.completed_at) &&
      toDateKey(task.completed_at) >= weekAgoKey,
  );
  const rowRank = (task) =>
    task.status === "done"
      ? 4
      : task.due === "Overdue"
        ? 0
        : task.due_date === today
          ? 1
          : task.status === "in progress"
            ? 2
            : 3;
  const todayTaskRows = [...myTasks]
    .sort(
      (a, b) =>
        rowRank(a) - rowRank(b) ||
        (a.due_date || "9999").localeCompare(b.due_date || "9999"),
    )
    .slice(0, 6);
  const checkedInCount = checkedInMemberIds.size;
  const memberCount = members.length;
  const pendingCheckIns = missingCheckInMembers.length;
  const checkInPercent = memberCount
    ? Math.round((checkedInCount / memberCount) * 100)
    : 0;
  const checkInPendingLine = pendingCheckIns
    ? `${pendingCheckIns} ${pendingCheckIns === 1 ? "member is" : "members are"} still pending`
    : "Everyone has checked in today.";
  const summaryLine = [
    `${dueToday.length} ${dueToday.length === 1 ? "task" : "tasks"} due today`,
    `${overdue.length} overdue`,
    `${pendingCheckIns} team ${pendingCheckIns === 1 ? "check-in" : "check-ins"} still pending`,
  ].join(" · ");
  const metrics = [
    {
      key: "due-today",
      label: "Due today",
      value: dueToday.length,
      sub: `${overdue.length} overdue`,
      onOpen: () => onOpenBoard("due-today"),
    },
    {
      key: "completed",
      label: "Completed",
      value: completedThisWeek.length,
      sub: "this week",
      onOpen: () => onOpenBoard("completed"),
    },
    {
      key: "blocked",
      label: "Blocked",
      value: blocked.length,
      sub: "needs attention",
      onOpen: () => onOpenBoard("blocked"),
    },
    {
      key: "check-ins",
      label: "Check-ins",
      value: `${checkedInCount} of ${memberCount}`,
      sub: `${pendingCheckIns} pending`,
      onOpen: () => onNavigate("Check-ins"),
    },
  ];
  const assigneeFor = (task) =>
    members.find(
      (member) => String(member.id) === String(task.assignee_id),
    ) || null;
  const taskRowMeta = (task) => {
    const owner = assigneeFor(task);
    return [task.tag, owner ? memberName(owner) : "Unassigned"]
      .filter(Boolean)
      .join(" · ");
  };
  const taskRowDate = (task) => {
    if (task.status === "done") return "Done";
    if (task.due === "Overdue") return "Overdue";
    if (task.due_date === today) return "Today";
    return task.due_date ? formatDayMonthName(task.due_date) : "";
  };
  const eventTimeRange = (event) => {
    const times = [event.start_at, event.end_at || event.start_at]
      .map((value) => formatShiftClock(value))
      .join(" - ");
    const startKey = String(event.start_at || "").slice(0, 10);
    // A time range alone reads as if it started today, so an event carried in
    // from an earlier day keeps the day it began in front of the range.
    return startKey && startKey !== today
      ? `${formatDayMonthName(startKey)} ${times}`
      : times;
  };
  // The design's event pill is the one thing the API does not carry, so it is
  // derived from the clock: a clash with another event today, then a running
  // event, then one starting inside the hour. No pill rather than a wrong one.
  const eventPill = (event) => {
    const start = new Date(event.start_at).getTime();
    const end = new Date(event.end_at || event.start_at).getTime();
    const clashing = todaysEvents.some((other) => {
      if (other.id === event.id) return false;
      const otherStart = new Date(other.start_at).getTime();
      const otherEnd = new Date(other.end_at || other.start_at).getTime();
      return otherStart < end && otherEnd > start;
    });
    if (clashing) {
      return { label: "Overlaps", className: "bg-warning-soft text-warning" };
    }
    const now = Date.now();
    if (start <= now && end >= now) {
      return { label: "Live", className: "bg-success-soft text-success" };
    }
    const minutes = Math.round((start - now) / 60000);
    if (minutes > 0 && minutes <= 90) {
      return { label: `In ${minutes} min`, className: "bg-info-soft text-info" };
    }
    return null;
  };
  const unassignedOpenCount = tasks.filter(
    (task) => !task.assignee_id && isOpen(task),
  ).length;
  const exceptionRows = [
    {
      key: "overdue",
      label: "Overdue tasks",
      count: overdue.length,
      dot: "bg-danger",
      onOpen: () => onOpenBoard("overdue"),
    },
    {
      key: "blocked",
      label: "Blocked tasks",
      count: blocked.length,
      dot: "bg-danger",
      onOpen: () => onOpenBoard("blocked"),
    },
    {
      key: "unassigned",
      label: "Unassigned work",
      count: unassignedOpenCount,
      dot: "bg-warning-fill",
      onOpen: () => onOpenBoard("unassigned"),
    },
  ];
  const eyebrow = formatTodayEyebrow(today) || todayLabel;
  return (
    <section className="pb-10">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-[18px]">
        <div className="min-w-0">
          <p className="text-overline uppercase text-navy">{eyebrow}</p>
          <h1 className="mt-1 text-page-heading text-text-primary">Today</h1>
          <p className="mt-1.5 text-body-small text-text-muted">{summaryLine}</p>
        </div>
        <Button type="button" size="page" onClick={onAddTask}>
          <Plus size={18} strokeWidth={2} aria-hidden="true" /> New task
        </Button>
      </header>

      <section className="mt-7 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <button
            key={metric.key}
            type="button"
            data-metric={metric.key}
            onClick={metric.onOpen}
            className="rounded-card border border-border bg-card p-5 text-left transition-colors hover:border-border-strong"
          >
            <span className="block text-caption text-text-muted">{metric.label}</span>
            <strong className="mt-1 block text-metric text-text-primary">{metric.value}</strong>
            <span className="mt-1.5 block text-caption text-success">{metric.sub}</span>
          </button>
        ))}
      </section>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_376px]">
        <div className="grid content-start gap-8">
          <section data-panel="tasks">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-card-heading text-text-primary">Today's tasks</h2>
              <button
                type="button"
                onClick={() => onNavigate("My tasks")}
                className="text-body-compact font-medium text-navy transition-colors hover:text-text-primary"
              >
                See all tasks
              </button>
            </div>
            <div className="mt-3.5 overflow-hidden rounded-card border border-border bg-card">
              {todayTaskRows.length ? (
                todayTaskRows.map((task) => {
                  const assignee = assigneeFor(task);
                  const done = task.status === "done";
                  return (
                    <article
                      key={task.id}
                      className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0"
                    >
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={done}
                        onClick={() => onComplete(task.id)}
                        aria-label={`${done ? "Reopen" : "Complete"} ${task.title}`}
                        title={done ? "Reopen task" : "Mark task complete"}
                        className={cn(
                          "flex size-5 shrink-0 items-center justify-center rounded-badge border transition-colors",
                          done
                            ? "border-success bg-success text-white"
                            : "border-border-strong text-transparent hover:border-navy",
                        )}
                      >
                        <Check size={14} strokeWidth={3} aria-hidden="true" />
                      </button>
                      <div className="min-w-0 flex-1">
                        <button
                          type="button"
                          onClick={() => onOpenTask(task)}
                          className={cn(
                            "block max-w-full truncate text-left text-body-small font-semibold text-text-primary hover:underline",
                            done && "text-text-muted line-through",
                          )}
                        >
                          {task.title}
                        </button>
                        <span className="mt-0.5 block truncate text-caption text-text-muted">
                          {taskRowMeta(task)}
                        </span>
                      </div>
                      <span
                        className={cn(
                          "hidden shrink-0 rounded-badge px-2 py-0.5 text-caption font-medium sm:inline-block",
                          STATUS_PILL[task.status] || STATUS_PILL.todo,
                        )}
                      >
                        {STATUS_LABEL[task.status] || task.status}
                      </span>
                      <span className="w-16 shrink-0 text-right text-caption text-text-secondary">
                        {taskRowDate(task)}
                      </span>
                      <Avatar
                        name={assignee ? memberName(assignee) : "Unassigned"}
                        avatarUrl={assignee?.avatar_url}
                        presence={assignee ? effectivePresence(assignee) : null}
                        small
                      />
                    </article>
                  );
                })
              ) : (
                <div className="grid justify-items-center gap-2 px-4 py-10 text-center">
                  <CheckCircle2 size={22} className="text-text-muted" aria-hidden="true" />
                  <p className="text-body-small text-text-secondary">
                    Nothing is assigned to you today.
                  </p>
                  <Button type="button" variant="ghost" size="sm" onClick={onAddTask}>
                    Plan a task <ArrowUpRight size={14} aria-hidden="true" />
                  </Button>
                </div>
              )}
            </div>
          </section>

          <section data-panel="check-ins">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-card-heading text-text-primary">Team check-ins</h2>
              <button
                type="button"
                onClick={() => onNavigate("Check-ins")}
                className="text-body-compact font-medium text-navy transition-colors hover:text-text-primary"
              >
                View all
              </button>
            </div>
            <div className="mt-3.5 rounded-card border border-border bg-card p-5">
              <p className="text-body-small font-semibold text-text-primary">
                Daily check-in progress
              </p>
              <p className="mt-1 text-section-heading text-text-primary">
                <strong>
                  {checkedInCount} of {memberCount}
                </strong>{" "}
                received
              </p>
              <p className="mt-1 text-caption text-text-muted">{checkInPendingLine}</p>
              <div
                role="progressbar"
                aria-label="Team check-ins received today"
                aria-valuemin={0}
                aria-valuemax={memberCount}
                aria-valuenow={checkedInCount}
                className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-surface-secondary"
              >
                <div
                  className="h-full rounded-full bg-navy"
                  style={{ width: `${checkInPercent}%` }}
                />
              </div>
              <div className="mt-2 grid">
                {members.slice(0, 4).map((member) => {
                  const submitted = checkedInMemberIds.has(String(member.id));
                  return (
                    <div key={member.id} className="flex items-center gap-3 py-2.5">
                      <Avatar
                        name={memberName(member)}
                        avatarUrl={member.avatar_url}
                        presence={effectivePresence(member)}
                        small
                      />
                      <button
                        type="button"
                        onClick={() => setProfileMember(member)}
                        aria-label={`Open ${memberName(member)} profile`}
                        className="min-w-0 flex-1 truncate text-left text-body-small text-text-primary hover:underline"
                      >
                        {memberName(member)}
                      </button>
                      <span
                        className={cn(
                          "shrink-0 rounded-badge px-2 py-0.5 text-caption font-medium",
                          submitted
                            ? "bg-success-soft text-success"
                            : "bg-warning-soft text-warning",
                        )}
                      >
                        {submitted ? "Submitted" : "Pending"}
                      </span>
                    </div>
                  );
                })}
              </div>
              {memberCount > 4 && (
                <p className="mt-1 text-caption text-text-muted">
                  and {memberCount - 4} more
                </p>
              )}
            </div>
          </section>
        </div>

        <aside className="grid content-start gap-4">
          <ClockInCard
            shifts={workShifts}
            currentUserId={currentUserId}
            presence={currentUserPresence}
            onSubmitShift={onSubmitShift}
            onChangePresence={onChangePresence}
          />

          {todaysEvents.length > 0 && (
            <section className="rounded-card border border-border bg-card p-5">
              <h2 className="text-body-small font-semibold text-text-primary">
                Upcoming events
              </h2>
              <div className="mt-3 grid gap-3">
                {todaysEvents.slice(0, 3).map((event) => {
                  const pill = eventPill(event);
                  return (
                    <button
                      key={event.id}
                      type="button"
                      onClick={() => onOpenEvent?.(event)}
                      className="flex items-start gap-2.5 text-left"
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          "mt-0.5 h-9 w-[3px] shrink-0 rounded-chip",
                          EVENT_BAR_TONE[event.event_type] || "bg-navy",
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-label text-text-primary">
                          {event.title}
                        </span>
                        <span className="block text-caption text-text-muted">
                          {eventTimeRange(event)}
                        </span>
                      </span>
                      {pill && (
                        <span
                          className={cn(
                            "shrink-0 rounded-badge px-2 py-0.5 text-caption font-medium",
                            pill.className,
                          )}
                        >
                          {pill.label}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          <section className="rounded-card border border-border bg-card p-5">
            <h2 className="text-body-small font-semibold text-text-primary">
              Team exceptions
            </h2>
            <div className="mt-3 grid gap-2.5">
              {exceptionRows.map((row) => (
                <button
                  key={row.key}
                  type="button"
                  onClick={row.onOpen}
                  className="flex items-center gap-2.5 text-left"
                >
                  <span
                    aria-hidden="true"
                    className={cn("size-2 shrink-0 rounded-full", row.dot)}
                  />
                  <span className="min-w-0 flex-1 truncate text-label text-text-primary">
                    {row.label}
                  </span>
                  <span className="shrink-0 text-label font-semibold text-text-primary">
                    {row.count}
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-card border border-border bg-card p-5">
            <h2 className="text-body-small font-semibold text-text-primary">
              Quick actions
            </h2>
            <div className="mt-3 grid gap-2">
              <button
                type="button"
                onClick={onAddEvent}
                className="flex h-11 items-center gap-2.5 rounded-control bg-navy px-4 text-label font-medium text-text-on-navy transition-colors hover:bg-navy-hover"
              >
                <Clock3 size={17} aria-hidden="true" /> Log work today
              </button>
              <button
                type="button"
                onClick={onAddTask}
                className="flex h-11 items-center gap-2.5 rounded-control border border-border px-4 text-label text-text-primary transition-colors hover:bg-surface-hover"
              >
                <Plus size={17} aria-hidden="true" /> New task
              </button>
              <button
                type="button"
                onClick={onCheckIn}
                className="flex h-11 items-center gap-2.5 rounded-control border border-border px-4 text-label text-text-primary transition-colors hover:bg-surface-hover"
              >
                <Check size={17} aria-hidden="true" /> Start team check-in
              </button>
            </div>
          </section>
        </aside>
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
