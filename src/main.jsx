import * as Sentry from "@sentry/react";

// Error monitoring is inert unless VITE_SENTRY_DSN is set at build time.
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    tracesSampleRate: 0.1,
  });
}

import { AppSelect } from "./components/ui/select.jsx";
import React, {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import {
  AlertCircle,
  Archive,
  ArrowUpRight,
  BarChart3,
  Bell,
  Brush,
  Building2,
  CalendarDays,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  CircleHelp,
  CircleUserRound,
  Clock3,
  Copy,
  Filter,
  FileText,
  Hash,
  LayoutDashboard,
  LayoutGrid,
  Link2,
  LogOut,
  MessageSquare,
  MoreHorizontal,
  ChevronLeft,
  ChevronRight,
  EyeOff,
  MonitorUp,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Square,
  Target,
  Users,
  Webhook,
  X,
  Sun,
  Moon,
} from "lucide-react";
import "flowbite/dist/flowbite.css";
import "./tijhabooks-theme.css";
import "./index.css";
import { Button } from "./components/ui/button.jsx";
import { Badge } from "./components/ui/badge.jsx";
import { Card, CardContent, CardHeader } from "./components/ui/card.jsx";
import { Tabs, TabsList, TabsTrigger } from "./components/ui/tabs.jsx";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "./components/ui/popover.jsx";
import PlannerBoard from "./components/PlannerBoard.jsx";
import WorkScopeSelector, {
  taskMatchesScope,
} from "./components/WorkScopeSelector.jsx";
const AssistantFlyout = lazy(() =>
  import("./components/WorkspaceTools.jsx").then((module) => ({
    default: module.AssistantFlyout,
  })),
);
const FilesWorkspaceView = lazy(() =>
  import("./components/WorkspaceTools.jsx").then((module) => ({
    default: module.FilesWorkspaceView,
  })),
);
import { Calendar as DatePicker } from "./components/ui/calendar.jsx";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./components/ui/dialog.jsx";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "./components/ui/select.jsx";
import { cn } from "./lib/utils.js";
import toast, { Toaster } from "react-hot-toast";

import {
  Activity,
  AuthScreen,
  InvitationReview,
  NoWorkspaceScreen,
} from "./components/AuthScreen.jsx";
import {
  ClockInCard,
  MyTasksView,
  ProjectCostBudgetPanel,
  ProjectOperationsSummary,
  ProjectProgress,
  ProjectRiskIssuePanel,
  ProjectStakeholderResourcePanel,
  TeamBoardView,
  TodayDashboard,
} from "./components/BoardViews.jsx";
import { WorkspaceComposer } from "./components/WorkspaceComposer.jsx";
const ChatWorkspaceView = lazy(() =>
  import("./components/ChatViews.jsx").then((module) => ({
    default: module.ChatWorkspaceView,
  })),
);
import {
  CalendarEventEditDialog,
  CheckInDetailDialog,
  CheckInEditDialog,
  FollowUpEditDialog,
  ProjectEditDrawer,
} from "./components/RecordDialogs.jsx";
import { TaskCard, TaskDetailDrawer } from "./components/TaskViews.jsx";
import SettingsView from "./components/SettingsView.jsx";
const ScreenSharingView = lazy(() => import("./components/ScreenSharing.jsx"));
const ScreenShareControl = lazy(() =>
  import("./components/ScreenSharing.jsx").then((module) => ({
    default: module.ScreenShareControl,
  })),
);
import ImportView from "./components/ImportView.jsx";
import AppUpdateBanner from "./components/AppUpdateBanner.jsx";
import { startAppUpdateWatch } from "./lib/app-updates.js";
import { startNotificationAlerts } from "./lib/notification-alerts.js";
import { notificationDestinations, parseNotificationDeepLink, resolveNotificationTarget } from "./lib/notification-navigation.js";
import NotificationPermissionPrompt from "./components/NotificationPermissionPrompt.jsx";
import {
  CookieConsent,
  HelpView,
  LegalView,
} from "./components/StaticViews.jsx";
import {
  ConfirmDialog,
  DateField,
  DateTimeField,
  EmptyState,
  SelectField,
  WorkspaceViewHeading,
} from "./components/workspace-ui.jsx";
import {
  BREAK_PRESETS,
  BREAK_PRESET_LABEL,
  PRESENCE_LABEL,
  PRESENCE_OPTIONS,
  WORK_SHIFT_TOAST,
  formatCalendarDate,
  formatHoursLabel,
  formatRelativeActivityTime,
  formatShiftClock,
  formatShiftDuration,
  getCalendarDays,
  getCsrfToken,
  initialsFor,
  mapTaskFromApi,
  readJsonResponse,
  taskDueLabel,
  taskSearchText,
  toDateKey,
  toDateTimeLocal,
  googleCalendarUrl,
} from "./lib/workspace-format.js";

function App() {
  const today = toDateKey(new Date());
  const todayLabel = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${today}T12:00:00`));
  // Supports PWA shortcuts (manifest.webmanifest) and any other deep link that
  // wants to land on a specific view, e.g. /?view=My+tasks.
  const [active, setActive] = useState(() => {
    const requested = new URLSearchParams(window.location.search).get("view");
    const saved = localStorage.getItem("workspace-last-page");
    const page = requested || saved || "Today";
    return ["Files", "Import data"].includes(page) ? "Today" : page;
  });
  useEffect(() => {
    localStorage.setItem("workspace-last-page", active);
  }, [active]);
  // The board's exception filter lives here rather than in the board because the
  // dashboard's headline cards are what set it - Today and the board are rendered by
  // two different components. Leaving the board clears it, so arriving later from the
  // sidebar cannot land you on a filtered board with no memory of why.
  const [teamBoardFocus, setTeamBoardFocus] = useState("all");
  useEffect(() => {
    if (active !== "Team board") setTeamBoardFocus("all");
  }, [active]);
  const [tasks, setTasks] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [confirmState, setConfirmState] = useState(null);
  const confirmAction = (message, options = {}) =>
    new Promise((resolve) => setConfirmState({ message, resolve, ...options }));
  const [taskError, setTaskError] = useState("");
  const [selectedTask, setSelectedTask] = useState(null);
  const taskModalRef = useRef(null);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [screenShareNotificationId, setScreenShareNotificationId] = useState(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const notifRef = useRef(null);
  useEffect(() => {
    if (!showModal) return undefined;
    const previouslyFocused = document.activeElement;
    const onKeyDown = (event) => {
      const dialog = taskModalRef.current;
      if (event.key === "Escape") {
        event.preventDefault();
        setShowModal(false);
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const focusable = [...dialog.querySelectorAll("button, input, textarea, select, [href], [tabindex]:not([tabindex='-1'])")].filter((element) => !element.disabled);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, [showModal]);
  const searchRef = useRef(null);
  const profileMenuRef = useRef(null);
  const workspaceMenuRef = useRef(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem("workspace-sidebar-collapsed") === "true",
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const railCollapsed = sidebarCollapsed && !mobileOpen;
  const [newTask, setNewTask] = useState("");
  const [newTaskTemplate, setNewTaskTemplate] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newAssigneeId, setNewAssigneeId] = useState("");
  const [newProjectId, setNewProjectId] = useState("");
  const [newWorkstreamId, setNewWorkstreamId] = useState("");
  const [newBucket, setNewBucket] = useState("Backlog");
  const [newDueDate, setNewDueDate] = useState("");
  const [newRecurrence, setNewRecurrence] = useState("none");
  const [newPriority, setNewPriority] = useState("normal");
  const [taskSubmitting, setTaskSubmitting] = useState(false);
  const [selectedFilter, setSelectedFilter] = useState("All work");
  const [teamBoardMode, setTeamBoardMode] = useState("people");
  const [searchQuery, setSearchQuery] = useState("");
  const [globalSearchResults, setGlobalSearchResults] = useState([]);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [globalSearchLoading, setGlobalSearchLoading] = useState(false);
  const [theme, setTheme] = useState(
    () => localStorage.getItem("workspace-theme") || "light",
  );
  const [session, setSession] = useState({
    loading: true,
    user: null,
    error: "",
  });
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(null);
  const [notificationUnreadCount, setNotificationUnreadCount] = useState(null);
  useEffect(() => {
    setNotificationUnreadCount(null);
    if (session.user?.id) return startNotificationAlerts(data => setNotificationUnreadCount(data.unread_count));
  }, [session.user?.id]);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState("");
  const [workspaceNotice, setWorkspaceNotice] = useState("");
  const [workspaceReload, setWorkspaceReload] = useState(0);
  const [reportRange, setReportRange] = useState("all");
  const [shiftLogUserId, setShiftLogUserId] = useState("");
  const [shiftLogPage, setShiftLogPage] = useState(1);
  const [reportLastUpdated, setReportLastUpdated] = useState(null);
  const [workspaceData, setWorkspaceData] = useState({
    members: [],
    projects: [],
    events: [],
    checkIns: [],
    workShifts: [],
    messages: [],
    channels: [],
    directConversations: [],
    followUps: [],
    invitations: [],
    notifications: [],
    activity: [],
    auditLogs: [],
    buckets: [],
    savedViews: [],
    lookupValues: [],
    taskTemplates: [],
    projectTemplates: [],
    reports: null,
  });
  const [inviteComposerOpen, setInviteComposerOpen] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: "", role: "member" });
  const [inviteError, setInviteError] = useState("");
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [aiFlyoutOpen, setAiFlyoutOpen] = useState(false);
  const [aiMinimized, setAiMinimized] = useState(false);
  const [aiLauncherHidden, setAiLauncherHidden] = useState(false);
  const aiPreferenceKey = session.user?.id
    ? `workspace-ai-hidden-${session.user.id}`
    : null;
  useEffect(() => {
    try {
      setAiLauncherHidden(
        aiPreferenceKey
          ? localStorage.getItem(aiPreferenceKey) === "true"
          : false,
      );
    } catch (error) {
      console.warn("AI button preference could not be read.", error);
      setAiLauncherHidden(false);
    }
  }, [aiPreferenceKey]);
  const setAiLauncherVisibility = (hidden) => {
    setAiLauncherHidden(hidden);
    setAiMinimized(false);
    if (hidden) setAiFlyoutOpen(false);
    try {
      if (aiPreferenceKey)
        localStorage.setItem(aiPreferenceKey, String(hidden));
    } catch {
      toast.error("Your browser could not save the AI button preference.");
    }
  };

  const [inviteToken, setInviteToken] = useState(() =>
    new URLSearchParams(window.location.search).get("invite"),
  );
  const [inviteInfo, setInviteInfo] = useState(null);
  const [inviteActionError, setInviteActionError] = useState("");
  const [inviteActionBusy, setInviteActionBusy] = useState(false);

  useEffect(() => {
    // Tidy up a ?view= deep link (PWA shortcut, bookmark) once it has been applied
    // to initial state, so it doesn't linger in the address bar or reapply on refresh.
    if (new URLSearchParams(window.location.search).has("view")) {
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  useEffect(() => {
    if (!inviteToken) return;
    // The token is the unguessable secret from the emailed link - this lookup
    // never uses the invitation's (sequential) id, so it cannot be enumerated.
    fetch(`/api/invitations/token/${encodeURIComponent(inviteToken)}/`, {
      credentials: "include",
    })
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((data) => setInviteInfo(data.invitation))
      .catch(() => setInviteToken(null));
  }, [inviteToken]);

  const clearInviteFromUrl = () => {
    const params = new URLSearchParams(window.location.search);
    params.delete("invite");
    window.history.replaceState(
      null,
      "",
      params.toString()
        ? `${window.location.pathname}?${params}`
        : window.location.pathname,
    );
  };

  // Signing in or creating an account never accepts an invitation by itself -
  // it only establishes the session. The explicit InvitationReview screen
  // (rendered below whenever inviteInfo is set) is the only place accept/
  // decline happens, and it stays up after authentication until the user acts.
  const handleAuthenticated = (user) => {
    setSession({ loading: false, user, error: "" });
  };

  const logout = async () => {
    try {
      await fetch("/api/auth/logout/", {
        method: "POST",
        credentials: "include",
        headers: { "X-CSRFToken": await getCsrfToken() },
      });
    } finally {
      setSession({ loading: false, user: null, error: "" });
    }
  };

  // Opens the same explicit InvitationReview screen used for the ?invite= email
  // link, so accept/decline for an in-app "pending invitations" entry goes
  // through the identical review-and-confirm step rather than a one-click accept.
  const reviewInvitation = (invitation) =>
    setInviteInfo({
      id: invitation.id,
      email: session.user?.email,
      workspace_name: invitation.workspace_name,
      role: invitation.role,
      invited_by_name: invitation.invited_by_name,
      expires_at: invitation.expires_at,
      status: "pending",
    });

  const dismissInvite = () => {
    setInviteToken(null);
    setInviteInfo(null);
    setInviteActionError("");
    clearInviteFromUrl();
  };

  const respondToInvite = async (action) => {
    if (!inviteInfo) return;
    setInviteActionError("");
    setInviteActionBusy(true);
    try {
      const response = await fetch(
        `/api/invitations/${inviteInfo.id}/${action}/`,
        {
          method: "POST",
          credentials: "include",
          headers: { "X-CSRFToken": await getCsrfToken() },
        },
      );
      const data = await readJsonResponse(
        response,
        `Invitation could not be ${action === "accept" ? "accepted" : "declined"}.`,
      );
      if (!response.ok)
        throw new Error(
          data.error ||
            `Invitation could not be ${action === "accept" ? "accepted" : "declined"}.`,
        );
      if (action === "accept") {
        const sessionResponse = await fetch("/api/auth/me/", {
          credentials: "include",
        });
        const sessionData = await sessionResponse.json();
        if (sessionResponse.ok && sessionData.user)
          setSession((current) => ({ ...current, user: sessionData.user }));
        setActiveWorkspaceId(data.workspace.id);
        toast.success(`Joined ${data.workspace.name}.`);
      } else {
        toast.success("Invitation declined.");
      }
      dismissInvite();
    } catch (actionError) {
      setInviteActionError(actionError.message);
    } finally {
      setInviteActionBusy(false);
    }
  };

  useEffect(() => {
    const resolvedTheme =
      theme === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : theme;
    document.documentElement.dataset.theme = resolvedTheme;
    localStorage.setItem("workspace-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (theme !== "system") return undefined;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = (event) => {
      document.documentElement.dataset.theme = event.matches ? "dark" : "light";
    };
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem(
      "workspace-sidebar-collapsed",
      String(sidebarCollapsed),
    );
  }, [sidebarCollapsed]);

  useEffect(() => {
    const handler = (event) => {
      if (notifRef.current && !notifRef.current.contains(event.target))
        setNotificationOpen(false);
      if (
        profileMenuRef.current &&
        !profileMenuRef.current.contains(event.target)
      )
        setProfileMenuOpen(false);
      if (
        workspaceMenuRef.current &&
        !workspaceMenuRef.current.contains(event.target)
      )
        setWorkspaceMenuOpen(false);
      if (searchRef.current && !searchRef.current.contains(event.target))
        setGlobalSearchOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    const closeOverlays = (event) => {
      if (event.key !== "Escape") return;
      setNotificationOpen(false);
      setProfileMenuOpen(false);
      setWorkspaceMenuOpen(false);
      setShowModal(false);
      setSelectedTask(null);
    };
    window.addEventListener("keydown", closeOverlays);
    return () => window.removeEventListener("keydown", closeOverlays);
  }, []);

  useEffect(() => {
    if (!workspaceNotice) return undefined;
    const timeout = window.setTimeout(() => setWorkspaceNotice(""), 5000);
    return () => window.clearTimeout(timeout);
  }, [workspaceNotice]);

  // Every save/notice path already funnels through workspaceNotice/workspaceError
  // (state or the workspace:notice event below) - mirroring that into
  // react-hot-toast, the same feedback mechanism TijhaBooks uses, means every
  // existing call site gets a toast for free instead of a one-by-one rewrite.
  useEffect(() => {
    if (workspaceNotice) toast.success(workspaceNotice);
  }, [workspaceNotice]);
  useEffect(() => {
    if (workspaceError) toast.error(workspaceError);
  }, [workspaceError]);

  useEffect(() => {
    const showNotice = (event) =>
      setWorkspaceNotice(String(event.detail || "Saved successfully."));
    window.addEventListener("workspace:notice", showNotice);
    return () => window.removeEventListener("workspace:notice", showNotice);
  }, []);

  useEffect(() => {
    if (!session.user || !workspaceData.events.length) return;
    const remindedEvent = workspaceData.events.find(
      (event) =>
        event.reminder_sent_at &&
        !sessionStorage.getItem(
          `workspace-reminder-${event.id}-${event.reminder_sent_at}`,
        ),
    );
    if (!remindedEvent) return;
    sessionStorage.setItem(
      `workspace-reminder-${remindedEvent.id}-${remindedEvent.reminder_sent_at}`,
      "1",
    );
    setWorkspaceNotice(`Upcoming event: ${remindedEvent.title}`);
    if ("Notification" in window && Notification.permission === "granted")
      new Notification(`Upcoming event: ${remindedEvent.title}`, {
        body: `Starts ${formatCalendarDate(new Date(remindedEvent.start_at), { dateStyle: "medium", timeStyle: "short" })}`,
      });
  }, [session.user, workspaceData.events]);

  useEffect(() => {
    if (
      session.user &&
      !session.user.workspaces.some(
        (workspace) => workspace.id === activeWorkspaceId,
      )
    ) {
      const preferred = session.user.workspaces.find(
        (workspace) => workspace.id === session.user.default_workspace_id,
      );
      setActiveWorkspaceId(
        preferred?.id || session.user.workspaces[0]?.id || null,
      );
    }
  }, [session.user, activeWorkspaceId]);

  useEffect(() => {
    setTasks([]);
    setSelectedTask(null);
    setNotificationOpen(false);
    setWorkspaceData({
      members: [],
      projects: [],
      events: [],
      checkIns: [],
      workShifts: [],
      messages: [],
      channels: [],
      directConversations: [],
      followUps: [],
      invitations: [],
      notifications: [],
      activity: [],
      auditLogs: [],
      buckets: [],
      savedViews: [],
      lookupValues: [],
      taskTemplates: [],
      projectTemplates: [],
      reports: null,
    });
  }, [activeWorkspaceId]);

  useEffect(() => {
    const query = searchQuery.trim();
    if (!activeWorkspaceId || query.length < 2) {
      setGlobalSearchResults([]);
      setGlobalSearchOpen(false);
      return undefined;
    }
    let isCurrent = true;
    setGlobalSearchLoading(true);
    const timer = setTimeout(() => {
      fetch(
        `/api/workspaces/${activeWorkspaceId}/search/?q=${encodeURIComponent(query)}`,
        {
          credentials: "include",
          headers: { "X-Workspace-Id": String(activeWorkspaceId) },
        },
      )
        .then((response) =>
          response.json().then((data) => ({ ok: response.ok, data })),
        )
        .then(({ ok, data }) => {
          if (isCurrent && ok) {
            setGlobalSearchResults(data.results);
            setGlobalSearchOpen(true);
          }
        })
        .catch((error) => {
          if (isCurrent) console.error("Global search failed", error);
        })
        .finally(() => {
          if (isCurrent) setGlobalSearchLoading(false);
        });
    }, 300);
    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
  }, [searchQuery, activeWorkspaceId]);

  useEffect(() => {
    fetch("/api/auth/me/", { credentials: "include" })
      .then((response) =>
        response.json().then((data) => ({ ok: response.ok, data })),
      )
      .then(({ ok, data }) => {
        if (!ok)
          throw new Error(
            data.error || "The authentication service is unavailable.",
          );
        setSession({ loading: false, user: data.user || null, error: "" });
      })
      .catch((error) =>
        setSession({ loading: false, user: null, error: error.message }),
      );
  }, []);

  useEffect(() => {
    if (!session.user) return undefined;
    let isCurrent = true;
    const workspaceId = activeWorkspaceId;
    if (!workspaceId) return undefined;
    setWorkspaceLoading(true);
    setWorkspaceError("");

    const read = (path, fallback = {}) =>
      fetch(path, {
        credentials: "include",
        headers: { "X-Workspace-Id": String(workspaceId) },
      })
        .then((response) => {
          if (!response.ok)
            throw new Error(`${path} returned ${response.status}`);
          return response.json();
        })
        .catch((error) => {
          console.warn(
            "Optional workspace data could not be loaded.",
            error.message,
          );
          return fallback;
        });
    // The task endpoint paginates (200 max per page), so a workspace with more
    // than one page of tasks would otherwise be silently truncated in every board.
    const readAllTasks = async () => {
      const collected = [];
      let pageNumber = 1;
      for (;;) {
        const page = await read(
          `/api/tasks/?page=${pageNumber}&page_size=200`,
          { tasks: [], pagination: null },
        );
        collected.push(...(page.tasks || []));
        if (!page.pagination?.has_next || pageNumber >= 50) break;
        pageNumber += 1;
      }
      return { tasks: collected };
    };
    const workspaceRole = session.user.workspaces.find(
      (workspace) => workspace.id === workspaceId,
    )?.role;
    let refreshInFlight = false;
    const refreshCollaboration = () => {
      if (refreshInFlight) return;
      refreshInFlight = true;
      const auditRequest = ["owner", "manager"].includes(workspaceRole)
        ? read(`/api/workspaces/${workspaceId}/audit-logs/`, { audit_logs: [] })
        : Promise.resolve({ audit_logs: [] });
      const refreshRequest = Promise.all([
        readAllTasks(),
        read(`/api/workspaces/${workspaceId}/members/?page_size=500`, {
          members: [],
        }),
        read(`/api/workspaces/${workspaceId}/projects/?page_size=500`, {
          projects: [],
        }),
        read(`/api/workspaces/${workspaceId}/lookup-values/`, {
          lookup_values: [],
        }),
        read(`/api/workspaces/${workspaceId}/task-templates/?page_size=500`, {
          task_templates: [],
        }),
        read(
          `/api/workspaces/${workspaceId}/project-templates/?page_size=500`,
          { project_templates: [] },
        ),
        read(`/api/workspaces/${workspaceId}/chat-messages/`, { messages: [] }),
        read(`/api/workspaces/${workspaceId}/chat-channels/`, { channels: [] }),
        read(`/api/workspaces/${workspaceId}/direct-conversations/`, {
          conversations: [],
        }),
        read(`/api/workspaces/${workspaceId}/follow-ups/`, { follow_ups: [] }),
        read(`/api/workspaces/${workspaceId}/calendar-events/`, { events: [] }),
        read(`/api/workspaces/${workspaceId}/check-ins/?date=${today}`, {
          check_ins: [],
        }),
        read(`/api/workspaces/${workspaceId}/work-shifts/`, {
          work_shifts: [],
        }),
        read(`/api/workspaces/${workspaceId}/notifications/`, {
          notifications: [],
        }),
        read(`/api/workspaces/${workspaceId}/activity/?page_size=200`, {
          activity: [],
        }),
        read(`/api/workspaces/${workspaceId}/plan-buckets/`, { buckets: [] }),
        read(`/api/workspaces/${workspaceId}/invitations/?page_size=500`, {
          invitations: [],
        }),
        read(`/api/workspaces/${workspaceId}/saved-views/`, {
          saved_views: [],
        }),
        read(
          `/api/workspaces/${workspaceId}/reports/summary/?range=${reportRange}&shift_page=${shiftLogPage}${shiftLogUserId ? `&shift_user_id=${shiftLogUserId}` : ""}`,
          { summary: null },
        ),
        auditRequest,
      ])
        .then(
          ([
            taskData,
            memberData,
            projectData,
            lookupData,
            taskTemplateData,
            projectTemplateData,
            messageData,
            channelData,
            directData,
            followUpData,
            eventData,
            checkInData,
            workShiftData,
            notificationData,
            activityData,
            bucketData,
            invitationData,
            savedViewData,
            reportData,
            auditData,
          ]) => {
            if (!isCurrent) return;
            setTasks(
              taskData.tasks.map((task) =>
                mapTaskFromApi(task, {
                  today,
                  workspaceRole,
                  currentUserId: session.user.id,
                }),
              ),
            );
            setWorkspaceData((current) => ({
              ...current,
              members: memberData.members,
              projects: projectData.projects,
              messages: messageData.messages,
              channels: channelData.channels,
              directConversations: directData.conversations,
              followUps: followUpData.follow_ups,
              events: eventData.events,
              checkIns: checkInData.check_ins,
              workShifts: workShiftData.work_shifts,
              notifications: notificationData.notifications,
              activity: activityData.activity,
              auditLogs: auditData.audit_logs,
              buckets: bucketData.buckets,
              invitations: invitationData.invitations,
              savedViews: savedViewData.saved_views,
              lookupValues: lookupData.lookup_values,
              taskTemplates: taskTemplateData.task_templates,
              projectTemplates: projectTemplateData.project_templates,
              reports: reportData.summary,
            }));
            setReportLastUpdated(new Date());
            setWorkspaceLoading(false);
          },
        )
        .catch((error) => {
          if (!isCurrent) return;
          setWorkspaceLoading(false);
          setWorkspaceError(
            error.message || "Collaboration data could not be refreshed.",
          );
          console.warn(
            "Collaboration data could not be refreshed.",
            error.message,
          );
        });
      return refreshRequest.finally(() => {
        refreshInFlight = false;
      });
    };

    // A full refresh refetches ~20 collections, so don't run one on a timer.
    // Ask the pulse endpoint (a few indexed aggregates) whether anything actually
    // moved, and only pay for the full refresh when the fingerprint changes.
    let lastFingerprint = null;
    const readFingerprint = async () => {
      try {
        const response = await fetch(`/api/workspaces/${workspaceId}/pulse/`, {
          credentials: "include",
          headers: { "X-Workspace-Id": String(workspaceId) },
        });
        return response.ok ? (await response.json()).fingerprint : null;
      } catch {
        return null; // Network blip - keep the current data and try again next tick.
      }
    };
    const refreshIfChanged = async () => {
      if (document.visibilityState !== "visible") return;
      const fingerprint = await readFingerprint();
      if (!isCurrent || fingerprint === null || fingerprint === lastFingerprint)
        return;
      lastFingerprint = fingerprint;
      refreshCollaboration();
    };

    // Read the fingerprint *before* loading, so a change that lands mid-load
    // still trips the next tick rather than being silently absorbed.
    readFingerprint().then((fingerprint) => {
      if (isCurrent) lastFingerprint = fingerprint;
    });
    refreshCollaboration();
    const refreshTimer = window.setInterval(refreshIfChanged, 15000);
    // Coming back to the tab should feel instant, so check immediately on return.
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refreshIfChanged();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      isCurrent = false;
      window.clearInterval(refreshTimer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [
    session.user,
    activeWorkspaceId,
    today,
    workspaceReload,
    reportRange,
    shiftLogUserId,
    shiftLogPage,
  ]);

  useEffect(() => {
    if (selectedTask && !tasks.some((task) => task.id === selectedTask.id))
      setSelectedTask(null);
  }, [tasks, selectedTask]);

  useEffect(() => {
    const mine = session.user
      ? tasks.filter(
          (task) =>
            String(task.assignee_id || "") === String(session.user.id) &&
            (!task.due_date || task.due_date <= today),
        )
      : [];
    const completed = mine.filter((task) => task.status === "done").length;
    document.documentElement.style.setProperty(
      "--focus-progress",
      `${mine.length ? Math.round((completed / mine.length) * 100) : 0}%`,
    );
  }, [tasks, session.user, today]);

  const visibleTasks = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    return tasks.filter((task) => {
      const isDailyBoardTask = !task.due_date || task.due_date <= today;
      const matchesStatus =
        selectedFilter === "All work" || task.status === selectedFilter;
      const matchesSearch =
        !normalizedQuery || taskSearchText(task).includes(normalizedQuery);
      return isDailyBoardTask && matchesStatus && matchesSearch;
    });
  }, [tasks, selectedFilter, searchQuery, today]);
  // Tapping a push opens its deep link, which arrives either as a cold start
  // with the query string or as an OPEN_NOTIFICATION message to a window that
  // is already running. Keep this hook above the session returns so the hook
  // order is identical while auth is loading and after the app is mounted.
  const handledDeepLinkRef = useRef(false);
  useEffect(() => {
    if (!activeWorkspaceId) return undefined;
    const openDeepLink = (value) => {
      const deepLink = parseNotificationDeepLink(value);
      if (deepLink) openNotification(deepLink);
    };
    if (!handledDeepLinkRef.current) {
      handledDeepLinkRef.current = true;
      if (new URLSearchParams(window.location.search).has("notification")) {
        openDeepLink(window.location.search);
        // Drop only the deep link params, so a refresh does not reopen the same
        // notification while an ?invite= or ?view= link in the same url survives.
        const remaining = new URLSearchParams(window.location.search);
        ["notification", "target_type", "target_id"].forEach((key) => remaining.delete(key));
        const query = remaining.toString();
        window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
      }
    }
    const onServiceWorkerMessage = (event) => {
      if (event.data?.type === "OPEN_NOTIFICATION") openDeepLink(event.data.url);
    };
    navigator.serviceWorker?.addEventListener("message", onServiceWorkerMessage);
    return () => navigator.serviceWorker?.removeEventListener("message", onServiceWorkerMessage);
  }, [activeWorkspaceId]);
  if (session.loading) return <BrandedStatusScreen loading />;
  if (!session.user)
    return (
      <AuthScreen
        theme={theme}
        onToggleTheme={() =>
          setTheme((current) => (current === "dark" ? "light" : "dark"))
        }
        onAuthenticated={handleAuthenticated}
        connectionError={session.error}
        inviteInfo={inviteInfo}
      />
    );
  if (inviteInfo)
    return (
      <InvitationReview
        invitation={inviteInfo}
        currentUserEmail={session.user.email}
        submitting={inviteActionBusy}
        error={inviteActionError}
        onAccept={() => respondToInvite("accept")}
        onDecline={() => respondToInvite("decline")}
        onDismiss={dismissInvite}
        onSignOut={logout}
      />
    );
  if (!session.user.workspaces.length)
    return (
      <NoWorkspaceScreen
        pendingInvitations={session.user.pending_invitations || []}
        onReview={reviewInvitation}
        onSignOut={logout}
      />
    );
  const mapApiTask = (apiTask) =>
    mapTaskFromApi(apiTask, {
      today,
      workspaceRole: session.user.workspaces.find(
        (workspace) => workspace.id === activeWorkspaceId,
      )?.role,
      currentUserId: session.user.id,
    });
  const completeTask = async (id) => {
    const previousTask = tasks.find((task) => task.id === id);
    const nextStatus = previousTask?.status === "done" ? "todo" : "done";
    setTasks((current) =>
      current.map((task) =>
        task.id === id
          ? {
              ...task,
              status: nextStatus,
              completed_at:
                nextStatus === "done" ? new Date().toISOString() : "",
            }
          : task,
      ),
    );
    try {
      const response = await fetch(`/api/tasks/${id}/`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": await getCsrfToken(),
          "X-Workspace-Id": String(activeWorkspaceId || ""),
        },
        body: JSON.stringify({ status: nextStatus }),
      });
      const responseData = await readJsonResponse(
        response,
        `Task update returned ${response.status}`,
      );
      if (!response.ok)
        throw new Error(
          responseData.error || `Task update returned ${response.status}`,
        );
      if (responseData.next_task)
        setTasks((current) =>
          current.some((task) => task.id === responseData.next_task.id)
            ? current
            : [...current, mapApiTask(responseData.next_task)],
        );
      toast.success(
        `${previousTask?.title || "Task"} ${nextStatus === "done" ? "completed" : "reopened"}.`,
      );
      setWorkspaceReload((current) => current + 1);
    } catch (error) {
      if (previousTask)
        setTasks((current) =>
          current.map((task) => (task.id === id ? previousTask : task)),
        );
      toast.error(error.message || "Task status could not be saved.");
      console.warn("Task status could not be saved.", error.message);
    }
  };
  const submitWorkShift = async (action, minutes = 0, note = "") => {
    try {
      const response = await fetch(
        `/api/workspaces/${activeWorkspaceId}/work-shifts/`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "X-CSRFToken": await getCsrfToken(),
          },
          body: JSON.stringify({ action, minutes, note }),
        },
      );
      const responseData = await readJsonResponse(
        response,
        "Your clock entry could not be saved.",
      );
      if (!response.ok)
        throw new Error(
          responseData.error || `Clock update returned ${response.status}`,
        );
      setWorkspaceData((current) => ({
        ...current,
        workShifts: [
          responseData.work_shift,
          ...current.workShifts.filter(
            (shift) => shift.id !== responseData.work_shift.id,
          ),
        ],
      }));
      toast.success(WORK_SHIFT_TOAST[action]);
    } catch (error) {
      toast.error(error.message || "Your clock entry could not be saved.");
      console.warn("Work shift could not be saved.", error.message);
      setWorkspaceReload((current) => current + 1);
    }
  };
  const changePresence = async (presence) => {
    const previousPresence = session.user.presence || "available";
    updateSessionUser({ presence });
    try {
      const response = await fetch("/api/auth/me/presence/", {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": await getCsrfToken(),
        },
        body: JSON.stringify({ presence }),
      });
      const responseData = await readJsonResponse(
        response,
        "Your status could not be saved.",
      );
      if (!response.ok)
        throw new Error(
          responseData.error || `Presence update returned ${response.status}`,
        );
    } catch (error) {
      updateSessionUser({ presence: previousPresence });
      toast.error(error.message || "Your status could not be saved.");
      console.warn("Presence could not be saved.", error.message);
    }
  };
  const changeTaskStatus = async (id, status) => {
    const previousTask = tasks.find((task) => task.id === id);
    setTasks((current) =>
      current.map((task) =>
        task.id === id
          ? {
              ...task,
              status,
              completed_at: status === "done" ? new Date().toISOString() : "",
            }
          : task,
      ),
    );
    try {
      const apiStatus = status === "in progress" ? "in_progress" : status;
      const response = await fetch(`/api/tasks/${id}/`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": await getCsrfToken(),
          "X-Workspace-Id": String(activeWorkspaceId || ""),
        },
        body: JSON.stringify({ status: apiStatus }),
      });
      const responseData = await readJsonResponse(
        response,
        `Task update returned ${response.status}`,
      );
      if (!response.ok)
        throw new Error(
          responseData.error || `Task update returned ${response.status}`,
        );
      if (responseData.next_task)
        setTasks((current) =>
          current.some((task) => task.id === responseData.next_task.id)
            ? current
            : [...current, mapApiTask(responseData.next_task)],
        );
      toast.success(
        `${previousTask?.title || "Task"} moved to ${status === "in progress" ? "In progress" : status === "todo" ? "To do" : status.charAt(0).toUpperCase() + status.slice(1)}.`,
      );
      setWorkspaceReload((current) => current + 1);
    } catch (error) {
      if (previousTask)
        setTasks((current) =>
          current.map((task) => (task.id === id ? previousTask : task)),
        );
      toast.error(error.message || "Task status could not be saved.");
      console.warn("Task status could not be saved.", error.message);
    }
  };
  const changeTaskBucket = async (id, bucket) => {
    if (Array.isArray(id)) return reorderPlannerTasks(id);
    const previousTask = tasks.find((task) => task.id === id);
    setTasks((current) =>
      current.map((task) => (task.id === id ? { ...task, bucket } : task)),
    );
    try {
      const response = await fetch(`/api/tasks/${id}/`, {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": await getCsrfToken(),
          "X-Workspace-Id": String(activeWorkspaceId || ""),
        },
        body: JSON.stringify({ bucket }),
      });
      if (!response.ok)
        throw new Error(`Task bucket update returned ${response.status}`);
      setWorkspaceReload((current) => current + 1);
    } catch (error) {
      if (previousTask)
        setTasks((current) =>
          current.map((task) => (task.id === id ? previousTask : task)),
        );
      toast.error(error.message || "Task bucket could not be saved.");
      console.warn("Task bucket could not be saved.", error.message);
    }
  };
  const reorderPlannerTasks = async (columns) => {
    const previousTasks = tasks;
    const placements = new Map();
    columns.forEach((column) =>
      column.task_ids.forEach((id, position) =>
        placements.set(Number(id), { bucket: column.bucket, position }),
      ),
    );
    setTasks((current) =>
      current.map((task) =>
        placements.has(task.id)
          ? { ...task, ...placements.get(task.id) }
          : task,
      ),
    );
    try {
      const response = await fetch(
        `/api/workspaces/${activeWorkspaceId}/tasks/reorder/`,
        {
          method: "PATCH",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "X-CSRFToken": await getCsrfToken(),
            "X-Workspace-Id": String(activeWorkspaceId || ""),
          },
          body: JSON.stringify({ columns }),
        },
      );
      const responseData = await readJsonResponse(
        response,
        "Task order could not be saved.",
      );
      if (!response.ok)
        throw new Error(responseData.error || "Task order could not be saved.");
      setWorkspaceNotice("Planner order saved.");
      return responseData.tasks;
    } catch (error) {
      setTasks(previousTasks);
      toast.error(error.message || "Task order could not be saved.");
      throw error;
    }
  };
  const deleteTask = async (id) => {
    if (
      !(await confirmAction(
        "Archive this task? It will be hidden from active views, but its history and code are kept.",
        { title: "Archive task", confirmLabel: "Archive task" },
      ))
    )
      return false;
    try {
      const response = await fetch(`/api/tasks/${id}/`, {
        method: "DELETE",
        credentials: "include",
        headers: {
          "X-CSRFToken": await getCsrfToken(),
          "X-Workspace-Id": String(activeWorkspaceId || ""),
        },
      });
      if (!response.ok) {
        toast.error("Task could not be archived.");
        return false;
      }
      setTasks((current) => current.filter((task) => task.id !== id));
      setSelectedTask(null);
      setWorkspaceNotice("Task archived.");
      setWorkspaceReload((current) => current + 1);
      return true;
    } catch (error) {
      toast.error(error.message || "Task could not be archived.");
      return false;
    }
  };
  const applyTaskTemplate = (event) => {
    const templateId = event.target.value;
    setNewTaskTemplate(templateId);
    const template = workspaceData.taskTemplates.find(
      (item) => String(item.id) === String(templateId),
    );
    if (template) {
      setNewTask(template.title);
      setNewDescription(template.description || "");
      setNewPriority(template.priority || "normal");
      setNewBucket(template.bucket || "Backlog");
      setNewRecurrence(template.recurrence || "none");
      setNewProjectId(template.project_id || "");
      setNewWorkstreamId(template.workstream_id || "");
      setNewAssigneeId(template.assignee_id || "");
    }
  };
  const openTaskModal = (assigneeId, options = {}) => {
    const requestedBucket = sessionStorage.getItem("workspace-new-task-bucket");
    sessionStorage.removeItem("workspace-new-task-bucket");
    setNewTask("");
    setNewTaskTemplate("");
    setNewDescription("");
    setNewAssigneeId(assigneeId ? String(assigneeId) : "");
    setNewProjectId(options.projectId ? String(options.projectId) : "");
    setNewWorkstreamId("");
    setNewDueDate("");
    const requestedProjectId = options.projectId
      ? String(options.projectId)
      : "";
    const matchingBucket = requestedProjectId
      ? workspaceData.buckets.find(
          (bucket) => String(bucket.project_id || "") === requestedProjectId,
        )
      : null;
    setNewBucket(requestedBucket || matchingBucket?.name || "Backlog");
    setNewRecurrence("none");
    setNewPriority("normal");
    setTaskError("");
    setShowModal(true);
  };
  const openComposer = (type) => {
    if (type === "invite") {
      setInviteForm({ email: "", role: "member" });
      setInviteError("");
      setInviteComposerOpen(true);
    }
  };
  const submitInvite = async (event) => {
    event.preventDefault();
    setInviteError("");
    setInviteSubmitting(true);
    try {
      const response = await fetch(
        `/api/workspaces/${activeWorkspaceId}/invitations/`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "X-CSRFToken": await getCsrfToken(),
            "X-Workspace-Id": String(activeWorkspaceId),
          },
          body: JSON.stringify({
            email: inviteForm.email,
            role: inviteForm.role,
          }),
        },
      );
      const responseData = await readJsonResponse(
        response,
        "Invitation could not be sent.",
      );
      if (!response.ok)
        throw new Error(responseData.error || "Invitation could not be sent.");
      setWorkspaceData((current) => ({
        ...current,
        invitations: [...current.invitations, responseData.invitation],
      }));
      setWorkspaceReload((current) => current + 1);
      setInviteComposerOpen(false);
      toast.success(
        responseData.message || `Invitation sent to ${inviteForm.email}.`,
      );
    } catch (submitError) {
      setInviteError(submitError.message);
    } finally {
      setInviteSubmitting(false);
    }
  };
  const markNotificationsRead = async () => {
    try {
      const response = await fetch(
        `/api/workspaces/${activeWorkspaceId}/notifications/`,
        {
          method: "PATCH",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "X-CSRFToken": await getCsrfToken(),
          },
          body: JSON.stringify({ read_all: true }),
        },
      );
      if (!response.ok)
        return toast.error("Notifications could not be marked as read.");
      window.dispatchEvent(new Event("workspace:notifications-changed"));
      setWorkspaceData((current) => ({
        ...current,
        notifications: current.notifications.map((notification) => ({
          ...notification,
          read: true,
        })),
      }));
    } catch (error) {
      toast.error(
        error.message || "Notifications could not be marked as read.",
      );
    }
  };
  const markNotificationRead = async (notificationId) => {
    try {
      const response = await fetch(
        `/api/workspaces/${activeWorkspaceId}/notifications/`,
        {
          method: "PATCH",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "X-CSRFToken": await getCsrfToken(),
          },
          body: JSON.stringify({ notification_id: notificationId }),
        },
      );
      if (!response.ok)
        return toast.error("Notification could not be marked as read.");
      window.dispatchEvent(new Event("workspace:notifications-changed"));
      setWorkspaceData((current) => ({
        ...current,
        notifications: current.notifications.map((notification) =>
          notification.id === notificationId
            ? { ...notification, read: true }
            : notification,
        ),
      }));
    } catch (error) {
      toast.error(error.message || "Notification could not be marked as read.");
    }
  };
  const openNotification = async (notification) => {
    setNotificationOpen(false);
    markNotificationRead(notification.id);
    const resolved = resolveNotificationTarget(notification, {
      tasks,
      events: workspaceData.events,
      followUps: workspaceData.followUps,
      projects: workspaceData.projects,
      lookupValues: workspaceData.lookupValues,
    });
    if (notification.target_type === "screen_share_session") {
      setScreenShareNotificationId(resolved.targetId);
      setActive("Screen sharing");
      return;
    }
    if (notification.target_type === "check_in") {
      setPendingCheckInId(String(notification.target_id));
      setActive("Check-ins");
      return;
    }
    if (notification.target_type === "workstream") {
      const targetWorkstream = resolved.action === "open" ? resolved.target : null;
      if (targetWorkstream) setPlannerProjectFilter("operations");
      setPendingWorkstreamNotification(notification.target_id);
      setActive("Planner");
      return;
    }
    if (["project", "risk_issue"].includes(notification.target_type)) {
      const targetProject = resolved.action === "open" ? resolved.target : null;
      if (targetProject) {
        setSelectedProjectWorkspace(targetProject);
        setProjectOperation(notification.target_type === "risk_issue" ? "risks" : "");
      } else {
        setPendingProjectNotification({
          id: resolved.targetId,
          operation: resolved.operation || "",
          targetType: notification.target_type,
        });
      }
      setActive("Projects");
      return;
    }
    if (notification.target_type === "calendar_event") {
      const targetEvent = resolved.action === "open" ? resolved.target : null;
      if (targetEvent) setSelectedEvent(targetEvent);
      else setPendingEventId(String(notification.target_id));
      setActive("Calendar");
      return;
    }
    if (notification.target_type === "follow_up") {
      const targetFollowUp = resolved.action === "open" ? resolved.target : null;
      if (targetFollowUp) setSelectedFollowUp(targetFollowUp);
      else setPendingFollowUpId(String(notification.target_id));
      setActive("Follow-up");
      return;
    }
    if (notification.target_type === "task") {
      const targetTask = resolved.action === "open" ? resolved.target : null;
      if (targetTask) {
        setSelectedTask(targetTask);
        return;
      }
      try {
        const response = await fetch(`/api/tasks/${notification.target_id}/`, {
          credentials: "include",
          headers: { "X-Workspace-Id": String(activeWorkspaceId) },
        });
        if (!response.ok) throw new Error("Task could not be loaded.");
        const payload = await response.json();
        setSelectedTask(payload.task);
      } catch {
        toast.error("Task could not be opened.");
      }
      return;
    }
    const destination = notificationDestinations[notification.target_type];
    if (destination) setActive(destination);
  };
  const searchResultDestinations = {
    follow_up: "Follow-up",
    chat_channel: "Channels",
    direct_conversation: "Chats",
    check_in: "Check-ins",
    risk_issue: "Projects",
  };
  const openSearchResult = (result) => {
    setGlobalSearchOpen(false);
    setSearchQuery("");
    if (result.target_type === "task") {
      const targetTask = tasks.find(
        (task) => String(task.id) === String(result.target_id),
      );
      if (targetTask) setSelectedTask(targetTask);
      return;
    }
    const destination = searchResultDestinations[result.target_type];
    if (destination) setActive(destination);
  };
  const searchResultLabels = {
    task: "Task",
    task_comment: "Comment",
    risk_issue: "Risk/Issue",
    chat_message: "Chat",
    direct_message: "Direct message",
    check_in: "Check-in",
    follow_up: "Follow-up",
  };
  const addTask = async (event) => {
    event.preventDefault();
    if (taskSubmitting) return;
    setTaskError("");
    if (!newTask.trim()) {
      setTaskError("Task name is required.");
      return;
    }
    setTaskSubmitting(true);
    try {
      const response = await fetch("/api/tasks/", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": await getCsrfToken(),
          "X-Workspace-Id": String(activeWorkspaceId || ""),
        },
        body: JSON.stringify({
          title: newTask.trim(),
          description: newDescription.trim(),
          assignee_id: newAssigneeId || null,
          project_id: newProjectId || null,
          workstream_id: newWorkstreamId || null,
          bucket: newBucket,
          due_date: newDueDate || null,
          recurrence: newRecurrence,
          priority: newPriority,
        }),
      });
      const data = await readJsonResponse(
        response,
        "Task could not be created.",
      );
      if (!response.ok)
        throw new Error(
          data.error || `Task creation returned ${response.status}`,
        );
      setTasks((current) => [
        ...current,
        {
          id: data.task.id,
          title: data.task.title,
          description: data.task.description || "",
          member: data.task.assignee_name || "Unassigned",
          tag: data.task.project || "General",
          status: data.task.status || "todo",
          priority: data.task.priority || "normal",
          due: taskDueLabel(data.task.due_date, today),
          due_date: data.task.due_date || "",
          estimate: "n/a",
          assignee_id: data.task.assignee_id || "",
          project_id: data.task.project_id || "",
          can_edit:
            ["owner", "manager"].includes(currentWorkspace?.role) ||
            data.task.assignee_id === session.user.id,
          recurrence: data.task.recurrence || "none",
          bucket: data.task.bucket || "Backlog",
          labels: data.task.labels || [],
        },
      ]);
      setNewTask("");
      setNewTaskTemplate("");
      setNewDescription("");
      setNewAssigneeId("");
      setNewProjectId("");
      setNewWorkstreamId("");
      setNewBucket("Backlog");
      setNewDueDate("");
      setNewRecurrence("none");
      setNewPriority("normal");
      setShowModal(false);
      setWorkspaceNotice(
        newDueDate && newDueDate > today
          ? `Task created for ${newDueDate}. Open Planner to see it.`
          : "Task created successfully.",
      );
      setWorkspaceReload((current) => current + 1);
    } catch (error) {
      setTaskError(error.message || "Task could not be created.");
      console.error("Task could not be created.", error.message);
    } finally {
      setTaskSubmitting(false);
    }
  };

  const workspaceId = activeWorkspaceId;
  const currentWorkspace =
    session.user.workspaces.find(
      (workspace) => workspace.id === activeWorkspaceId,
    ) || session.user.workspaces[0];
  const canManageMembers = ["owner", "manager"].includes(
    currentWorkspace?.role,
  );
  const canManageTasks = ["owner", "manager"].includes(currentWorkspace?.role);
  const teamMembers = workspaceData.members.map((member) => ({
    id: member.id,
    name:
      [member.first_name, member.last_name].filter(Boolean).join(" ") ||
      member.email,
    initials:
      [member.first_name, member.last_name]
        .filter(Boolean)
        .map((name) => name[0])
        .join("")
        .slice(0, 2)
        .toUpperCase() || member.email.slice(0, 2).toUpperCase(),
    color: "blue",
    role: member.role,
  }));
  const teamBoardMembers = [
    ...teamMembers,
    {
      id: "unassigned",
      name: "General queue",
      initials: "+",
      color: "navy",
      role: "Shared work",
    },
  ];
  const currentUserName =
    [session.user.first_name, session.user.last_name]
      .filter(Boolean)
      .join(" ") || session.user.email;
  const currentUserInitials =
    [session.user.first_name, session.user.last_name]
      .filter(Boolean)
      .map((name) => name[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || session.user.email.slice(0, 2).toUpperCase();
  const currentUserAvatarUrl = session.user.avatar_url || "";
  const currentUserPresence = session.user.presence || "available";
  const updateSessionUser = (patch) =>
    setSession((current) => ({
      ...current,
      user: { ...current.user, ...patch },
    }));
  const setDefaultWorkspace = async (workspaceId) => {
    try {
      const response = await fetch("/api/auth/me/profile/", {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": await getCsrfToken(),
        },
        body: JSON.stringify({ default_workspace_id: workspaceId }),
      });
      const data = await readJsonResponse(
        response,
        "Default workspace could not be saved.",
      );
      if (!response.ok)
        throw new Error(data.error || "Default workspace could not be saved.");
      setSession((current) => ({ ...current, user: data.user }));
      toast.success("Default workspace saved.");
    } catch (error) {
      toast.error(error.message || "Default workspace could not be saved.");
    }
  };
  const todayTasks = tasks.filter(
    (task) => !task.due_date || task.due_date <= today,
  );
  const completedTaskCount = todayTasks.filter(
    (task) => task.status === "done",
  ).length;
  const attentionTaskCount = todayTasks.filter(
    (task) =>
      ["blocked", "review"].includes(task.status) || task.due === "Overdue",
  ).length;
  const completionPercent = todayTasks.length
    ? Math.round((completedTaskCount / todayTasks.length) * 100)
    : 0;
  const myTasks = tasks.filter(
    (task) =>
      String(task.assignee_id || "") === String(session.user.id) &&
      (!task.due_date || task.due_date <= today),
  );
  const myTodayTasks = myTasks;
  const myCompletedTaskCount = myTodayTasks.filter(
    (task) => task.status === "done",
  ).length;

  // Grouped by what they're for rather than dumped in one flat list: the two
  // screens someone opens every day, the screens where work actually gets
  // planned/tracked, the screens for talking to teammates, and the screens
  // you check but rarely act from.
  const navGroups = [
    {
      heading: "Overview",
      items: [
        { label: "Today", icon: LayoutDashboard },
        { label: "My tasks", icon: CheckCircle2 },
        { label: "Daily operations", icon: ClipboardList },
      ],
    },
    {
      heading: "Collaborate",
      items: [
        {
          label: "Channels",
          icon: Hash,
          badge: workspaceData.notifications.filter(
            (item) => item.target_type === "chat_channel" && !item.read,
          ).length,
          badgeTone: "accent",
        },
        {
          label: "Chats",
          icon: MessageSquare,
          badge: workspaceData.notifications.filter(
            (item) => item.target_type === "direct_conversation" && !item.read,
          ).length,
          badgeTone: "accent",
        },
        {
          label: "Follow-up",
          icon: Bell,
          badge: workspaceData.followUps.filter(
            (item) => item.status !== "completed",
          ).length,
        },
        { label: "Check-ins", icon: Hash },
        { label: "Team board", icon: Users },
      ],
    },
    {
      heading: "Work",
      items: [
        { label: "Planner", icon: LayoutGrid },
        { label: "Projects", icon: Target },
        { label: "Calendar", icon: CalendarDays },
      ],
    },
    {
      heading: "Insights",
      items: [
        { label: "Reports", icon: BarChart3 },
        { label: "Activity", icon: Clock3 },
      ],
    },
    {
      heading: "Resources",
      items: [
        { label: "Screen sharing", icon: MonitorUp },
        { label: "Help", icon: CircleHelp },
        { label: "Legal", icon: FileText },
      ],
    },
  ];

  // ── Mobile bottom pill nav - the four destinations that carry the daily
  //    loop, with everything else behind "More" (the same drawer the header's
  //    hamburger opens). Items are looked up in navGroups rather than
  //    redeclared so labels, icons and unread badges stay in one place.
  const mobilePillLabels = ["Today", "My tasks", "Planner", "Chats"];
  const navItemsByLabel = new Map(
    navGroups.flatMap((group) => group.items).map((item) => [item.label, item]),
  );
  const mobilePillItems = mobilePillLabels
    .map((label) => navItemsByLabel.get(label))
    .filter(Boolean);

  return (
    <div className="flex h-dvh overflow-hidden bg-surface-secondary">
      <Toaster
        position="top-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: "rgba(11, 11, 69, 0.94)",
            color: "#FFFFFF",
            fontSize: "0.875rem",
          },
          success: {
            style: { background: "rgba(8, 127, 115, 0.94)", color: "#FFFFFF" },
            iconTheme: { primary: "#86efac", secondary: "#087f73" },
          },
          error: {
            style: { background: "rgba(180, 35, 24, 0.94)", color: "#FFFFFF" },
            iconTheme: { primary: "#fecaca", secondary: "#b42318" },
          },
          loading: {
            style: { background: "rgba(29, 78, 216, 0.94)", color: "#FFFFFF" },
            iconTheme: { primary: "#bfdbfe", secondary: "#1d4ed8" },
          },
        }}
      />
      <ConfirmDialog
        state={confirmState}
        onClose={() => setConfirmState(null)}
      />
      <Suspense fallback={null}>
        <ScreenShareControl
          workspaceId={workspaceId}
          currentUserId={session.user.id}
          targetSessionId={screenShareNotificationId}
        />
      </Suspense>
      {aiFlyoutOpen && (
        <Suspense fallback={null}>
          <AssistantFlyout
            workspaceId={activeWorkspaceId}
            onClose={() => setAiFlyoutOpen(false)}
            onMinimize={() => {
              setAiFlyoutOpen(false);
              setAiLauncherVisibility(false);
              setAiMinimized(true);
            }}
            onHide={() => setAiLauncherVisibility(true)}
          />
        </Suspense>
      )}
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>

      {/* ── Mobile overlay - stays mounted and fades in step with the drawer's
        slide (both on the same 200ms timing) instead of popping in/out, so
        the dim and the panel read as one motion rather than two. ── */}
      <div
        className={cn(
          "fixed inset-0 z-40 bg-navy/40 backdrop-blur-sm transition-opacity duration-200 ease-in-out lg:hidden",
          mobileOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={() => setMobileOpen(false)}
        aria-hidden="true"
      />

      {/* ── Sidebar ── */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex flex-col bg-navy text-text-on-navy transition-all duration-200 lg:relative",
          "w-64",
          railCollapsed && "lg:w-[4.5rem]",
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        )}
      >
        {/* Logo / brand - desktop only. Mobile header already shows the brand. */}
        <div
          className={cn(
            "hidden lg:flex items-center border-b border-white/10 pb-4",
            railCollapsed
              ? "flex-col justify-center gap-4 px-0 py-5"
              : "gap-3 px-4 pt-8 pb-4",
          )}
        >
          <img
            src="/tijha-logo.png"
            alt="TijhaBooks"
            className="h-7 w-7 shrink-0 rounded-lg object-contain"
          />
          {!railCollapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-bold tracking-tight">
                WorkSpace
              </p>
              <p className="truncate text-[11px] uppercase tracking-wider text-white/40">
                Team Manager
              </p>
            </div>
          )}
        </div>

        {/* Mobile close button - outside the logo block so it survives on phones */}
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 lg:hidden">
          <span className="text-sm font-bold text-white/60">Navigation</span>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="-mr-2 flex h-11 w-11 items-center justify-center rounded-lg text-white/50 hover:bg-white/10 hover:text-white"
            aria-label="Close sidebar"
          >
            <X size={20} />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-2.5 py-4">
          {navGroups.map((group) => (
            <div className="mb-7 last:mb-0" key={group.heading}>
              {!railCollapsed && (
                <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-wider text-white/30">
                  {group.heading}
                </p>
              )}
              <ul className="space-y-1">
                {group.items.map(({ label, icon: Icon, badge, badgeTone }) => (
                  <li key={label}>
                    <button
                      type="button"
                      onClick={() => {
                        setActive(label);
                        setMobileOpen(false);
                      }}
                      title={railCollapsed ? label : undefined}
                      aria-current={active === label ? "page" : undefined}
                      className={cn(
                        "group flex w-full items-center gap-3.5 rounded-xl px-3 py-3 text-[15px] font-medium transition-all",
                        active === label
                          ? "bg-white/10 text-white"
                          : "text-white/60 hover:bg-white/5 hover:text-white",
                        railCollapsed && "justify-center py-3",
                      )}
                    >
                      <Icon size={22} className="shrink-0" />
                      {!railCollapsed && (
                        <span className="truncate">{label}</span>
                      )}
                      {!railCollapsed && badge > 0 && (
                        <span
                          className={cn(
                            "ml-auto flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11px] font-bold",
                            badgeTone === "accent"
                              ? "bg-accent text-navy"
                              : "bg-danger text-white",
                          )}
                        >
                          {badge > 9 ? "9+" : badge}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        {/* Upgrade nudge - mirrors TijhaBooks' plan-upsell card */}
        {!railCollapsed && (
          <div className="sidebar-upgrade-card mx-3 mb-3 rounded-xl bg-gradient-to-br from-primary/30 to-accent/10 p-3.5">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-white">
              <Sparkles size={14} /> Make your week flow
            </p>
            <p className="mt-0.5 text-[11px] leading-snug text-white/55">
              Set your priorities and stay ahead of what's due.
            </p>
          </div>
        )}

        <div className="border-t border-white/10 px-2.5 py-2.5">
          <button
            type="button"
            onClick={() => {
              setActive("Settings");
              setMobileOpen(false);
            }}
            title={railCollapsed ? "Settings" : undefined}
            aria-current={active === "Settings" ? "page" : undefined}
            className={cn(
              "flex w-full items-center gap-3.5 rounded-xl px-3 py-3 text-[15px] font-medium transition-all",
              active === "Settings"
                ? "bg-white/10 text-white"
                : "text-white/60 hover:bg-white/5 hover:text-white",
              railCollapsed && "justify-center py-3",
            )}
          >
            <Settings size={22} className="shrink-0" />
            {!railCollapsed && <span className="truncate">Settings</span>}
          </button>
        </div>
      </aside>

      {/* ── Desktop collapse edge pill - sits on the right edge of the sidebar ── */}
      <button
        type="button"
        hidden={workspaceLoading || Boolean(workspaceError)}
        onClick={() => setSidebarCollapsed((current) => !current)}
        className={`${workspaceLoading || workspaceError ? "hidden" : "hidden lg:flex"} fixed z-50 top-1/2 -translate-y-1/2 h-12 w-6 items-center justify-center rounded-r-lg bg-navy text-white/50 hover:text-white hover:bg-navy-soft transition-colors shadow-md`}
        style={{
          left: sidebarCollapsed ? "4.5rem" : "16rem",
          borderTop: "1px solid rgba(255,255,255,0.1)",
          borderRight: "1px solid rgba(255,255,255,0.1)",
          borderBottom: "1px solid rgba(255,255,255,0.1)",
          borderLeft: "none",
          transition: "left 0.2s",
        }}
        aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {sidebarCollapsed ? (
          <ChevronRight size={12} />
        ) : (
          <ChevronLeft size={12} />
        )}
      </button>

      {/* ── Main ── */}
      <div className="flex flex-1 flex-col min-w-0">
        <header className="relative z-30 flex h-16 shrink-0 items-center gap-3 border-b border-border bg-surface/95 px-4 backdrop-blur lg:px-6">
          <div className="flex min-w-0 items-center gap-2 lg:hidden">
            <img
              src="/tijha-logo.png"
              alt="TijhaBooks"
              className="h-6 w-6 shrink-0 rounded-md object-contain"
            />
            <span className="hidden truncate text-sm font-bold tracking-tight text-navy sm:inline">
              WorkSpace
            </span>
          </div>

          <h1 className="hidden text-base font-bold tracking-tight text-navy lg:block">
            {active}
          </h1>

          {/* Workspace switcher - lives in the header (mirrors TijhaBooks'
            BusinessSwitcher), not the sidebar. Collapses to a static label
            when there's only one workspace to switch to. */}
          {session.user.workspaces.length > 0 && (
            <div className="relative hidden sm:block" ref={workspaceMenuRef}>
              <button
                type="button"
                onClick={() =>
                  session.user.workspaces.length > 1 &&
                  setWorkspaceMenuOpen((current) => !current)
                }
                className={cn(
                  "flex items-center gap-1.5 rounded-full border border-border bg-surface-secondary px-3 py-1.5 text-xs font-semibold text-text-primary",
                  session.user.workspaces.length > 1 &&
                    "hover:bg-border-light transition-colors",
                )}
                aria-haspopup={
                  session.user.workspaces.length > 1 ? "true" : undefined
                }
                aria-expanded={workspaceMenuOpen}
              >
                <Building2 size={14} className="shrink-0 text-text-muted" />
                <span className="max-w-[140px] truncate">
                  {currentWorkspace?.name || "Workspace"}
                </span>
                {session.user.workspaces.length > 1 && (
                  <ChevronDown size={14} className="shrink-0 text-text-muted" />
                )}
              </button>
              {workspaceMenuOpen && (
                <div className="absolute left-0 top-full z-[60] mt-2 w-56 animate-fade-in rounded-xl border border-border bg-surface p-1.5 shadow-elevated">
                  {session.user.workspaces.map((workspace) => (
                    <button
                      type="button"
                      key={workspace.id}
                      onClick={() => {
                        setActiveWorkspaceId(workspace.id);
                        setWorkspaceMenuOpen(false);
                      }}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-secondary",
                        workspace.id === activeWorkspaceId
                          ? "text-primary font-semibold"
                          : "text-text-secondary",
                      )}
                    >
                      <span className="truncate">{workspace.name}</span>
                      {workspace.id === activeWorkspaceId && (
                        <Check size={14} className="shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="hidden flex-1 justify-center md:flex" ref={searchRef}>
            <div className="relative w-full max-w-md">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onFocus={() => {
                  if (globalSearchResults.length) setGlobalSearchOpen(true);
                }}
                placeholder="Search work, chats, check-ins..."
                aria-label="Search workspace"
                className="h-9 w-full rounded-full border border-border bg-surface-secondary pl-10 pr-4 text-sm text-text-primary placeholder:text-text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/10"
              />
              {globalSearchOpen && searchQuery.trim().length >= 2 && (
                <div
                  className="absolute left-0 right-0 top-full z-[60] mt-2 max-h-96 overflow-y-auto rounded-xl border border-border bg-surface shadow-elevated"
                  onMouseDown={(event) => event.preventDefault()}
                >
                  {globalSearchLoading && (
                    <p className="px-4 py-3 text-xs text-text-muted">
                      Searching…
                    </p>
                  )}
                  {!globalSearchLoading && !globalSearchResults.length && (
                    <p className="px-4 py-3 text-xs text-text-muted">
                      No matches for "{searchQuery.trim()}".
                    </p>
                  )}
                  {globalSearchResults.map((result) => (
                    <button
                      key={`${result.kind}-${result.id}`}
                      type="button"
                      onClick={() => openSearchResult(result)}
                      className="flex w-full flex-col items-start gap-1 border-b border-border-light px-4 py-2.5 text-left last:border-0 hover:bg-surface-secondary"
                    >
                      <span className="flex items-center gap-2 text-xs font-semibold text-text-primary">
                        <Badge variant="outline">
                          {searchResultLabels[result.kind] || result.kind}
                        </Badge>
                        {result.title}
                      </span>
                      {result.snippet && (
                        <span className="truncate text-xs text-text-muted">
                          {result.snippet}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-0.5 sm:gap-1.5">
            {!aiLauncherHidden && !aiMinimized && activeWorkspaceId && (
              <button
                type="button"
                onClick={() => setAiFlyoutOpen(true)}
                className="ai-mobile-launcher"
                aria-label="Open Zuri"
                aria-haspopup="dialog"
              >
                <CircleUserRound size={20} />
                <span>Ask Zuri</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => window.location.reload()}
              className="flex h-11 w-11 items-center justify-center rounded-full text-text-muted hover:bg-surface-secondary hover:text-text-primary transition-colors"
              aria-label="Refresh app"
              title="Refresh app"
            >
              <RefreshCw size={18} />
            </button>

            <div className="relative" ref={notifRef}>
              <button
                type="button"
                onClick={() => setNotificationOpen((current) => !current)}
                className="relative flex h-11 w-11 items-center justify-center rounded-full text-text-muted hover:bg-surface-secondary hover:text-text-primary transition-colors"
                aria-label="Open notifications"
              >
                <Bell size={20} />
                {notificationUnreadCount > 0 && (
                  <span aria-label={`${notificationUnreadCount} unread notifications`} className="absolute right-0 top-0 min-w-4 rounded-full bg-danger px-1 text-[10px] font-bold text-white ring-2 ring-surface">{notificationUnreadCount}</span>
                )}
              </button>
              {notificationOpen && (
                <div className="fixed left-4 right-4 top-16 z-[60] mt-2 w-auto max-w-md animate-fade-in rounded-xl border border-border bg-surface shadow-elevated sm:absolute sm:left-auto sm:right-0 sm:top-full sm:w-80">
                  <div className="flex items-center justify-between border-b border-border-light px-4 py-3">
                    <p className="text-sm font-bold text-navy">Notifications</p>
                    <button
                      type="button"
                      onClick={markNotificationsRead}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      Mark all read
                    </button>
                  </div>
                  <div className="max-h-[320px] divide-y divide-border-light overflow-y-auto">
                    {workspaceData.notifications.length ? (
                      workspaceData.notifications
                        .slice(0, 5)
                        .map((notification) => (
                          <button
                            type="button"
                            key={notification.id}
                            onClick={() => openNotification(notification)}
                            aria-label={`Open ${notification.title}`}
                            className="flex w-full flex-col items-start gap-1 px-4 py-3 text-left hover:bg-surface-secondary transition-colors"
                          >
                            <span className="flex items-center gap-1.5 text-sm font-semibold text-text-primary">
                              {notification.title}
                              {!notification.read && (
                                <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />
                              )}
                            </span>
                            <span className="truncate text-xs text-text-muted">
                              {notification.body || "Workspace update"}
                            </span>
                          </button>
                        ))
                    ) : (
                      <EmptyState text="No notifications yet. Updates from your teammates land here, and your own check-ins and actions are listed under Activity." />
                    )}
                  </div>
                  <div className="border-t border-border-light px-4 py-2.5">
                    <button
                      type="button"
                      onClick={() => {
                        setNotificationOpen(false);
                        setActive("Notifications");
                      }}
                      className="text-xs font-semibold text-primary hover:underline"
                    >
                      View all notifications
                    </button>
                  </div>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() =>
                setTheme((currentTheme) =>
                  currentTheme === "dark" ? "light" : "dark",
                )
              }
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
              className="flex h-11 w-11 items-center justify-center rounded-full text-text-muted hover:bg-surface-secondary hover:text-text-primary transition-colors"
            >
              {theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
            </button>

            <button
              type="button"
              onClick={() => setActive("Help")}
              className="hidden items-center gap-1.5 rounded-full px-3 py-2 text-xs font-semibold text-text-muted hover:bg-surface-secondary hover:text-text-primary transition-colors sm:flex"
            >
              <CircleHelp size={16} /> Help
            </button>

            <div className="relative ml-1" ref={profileMenuRef}>
              <button
                type="button"
                onClick={() => setProfileMenuOpen((current) => !current)}
                aria-haspopup="true"
                aria-expanded={profileMenuOpen}
                aria-label={`Account menu for ${currentUserName}`}
                className="flex items-center gap-2 rounded-full py-1 pl-1 pr-1 transition-colors hover:bg-surface-secondary sm:pr-2.5"
              >
                <span className="relative inline-flex h-9 w-9 shrink-0">
                  <span className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-primary to-navy-soft text-xs font-bold text-white">
                    {currentUserAvatarUrl ? (
                      <img
                        src={currentUserAvatarUrl}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      currentUserInitials
                    )}
                  </span>
                  <span
                    className={`presence-dot presence-${currentUserPresence}`}
                    title={
                      PRESENCE_LABEL[currentUserPresence] || currentUserPresence
                    }
                  />
                </span>
                <span className="hidden text-left sm:block">
                  <span className="block max-w-[140px] truncate text-sm font-semibold text-text-primary">
                    {currentUserName}
                  </span>
                  <span className="block max-w-[140px] truncate text-xs text-text-muted">
                    {currentWorkspace?.role || "Member"}
                  </span>
                </span>
              </button>

              {profileMenuOpen && (
                <div className="fixed left-4 right-4 top-16 z-[60] mt-2 w-auto max-w-xs animate-fade-in rounded-xl border border-border bg-surface p-1.5 shadow-elevated sm:absolute sm:left-auto sm:right-0 sm:top-full sm:w-56">
                  <div className="border-b border-border-light px-3 py-2.5">
                    <p className="truncate text-sm font-semibold text-text-primary">
                      {currentUserName}
                    </p>
                    <p className="truncate text-xs text-text-muted">
                      {session.user.email}
                    </p>
                  </div>
                  {currentWorkspace && (
                    <div className="border-b border-border-light px-3 py-2.5">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                        Workspace
                      </p>
                      <p className="truncate text-sm font-semibold text-text-primary">
                        {currentWorkspace.name}
                      </p>
                      <p className="truncate text-xs text-text-muted">
                        {currentWorkspace.role || "Member"}
                      </p>
                    </div>
                  )}
                  {session.user.workspaces.length > 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        setWorkspaceMenuOpen(true);
                        setProfileMenuOpen(false);
                      }}
                      className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-text-secondary hover:bg-surface-secondary sm:hidden"
                    >
                      <Building2 size={16} /> Switch workspace
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setAiLauncherVisibility(!aiLauncherHidden);
                      setProfileMenuOpen(false);
                    }}
                    className="flex min-h-11 w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-text-secondary hover:bg-surface-secondary"
                  >
                    {aiLauncherHidden ? (
                      <CircleUserRound size={16} />
                    ) : (
                      <EyeOff size={16} />
                    )}
                    {aiLauncherHidden ? "Show Zuri button" : "Hide Zuri button"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActive("Settings");
                      setProfileMenuOpen(false);
                    }}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-text-secondary hover:bg-surface-secondary"
                  >
                    <Settings size={16} /> Settings
                  </button>
                  <button
                    type="button"
                    onClick={logout}
                    className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-danger hover:bg-danger-bg"
                  >
                    <LogOut size={16} /> Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>
        <NotificationPermissionPrompt key={session.user.id} unreadCount={notificationUnreadCount} />
        <main
          id="main-content"
          className="main-content flex-1 overflow-y-auto min-w-0"
          tabIndex="-1"
        >
          {/* Bottom padding clears the fixed mobile pill nav; desktop has none. */}
          <div className="page-content pb-28 lg:pb-0">
            {session.user.pending_invitations?.map((invitation) => (
              <div className="workspace-status" key={invitation.id}>
                <span>
                  You are invited to join {invitation.workspace_name} as a{" "}
                  {invitation.role}.
                </span>
                <button
                  className="secondary-button"
                  onClick={() => reviewInvitation(invitation)}
                >
                  Review invitation
                </button>
              </div>
            ))}
            {workspaceLoading && (
              <div className="workspace-status" role="status">
                Loading workspace data...
              </div>
            )}
            {workspaceError && (
              <div className="workspace-status error" role="alert">
                <span>
                  Workspace data could not be loaded: {workspaceError}
                </span>
                <button
                  className="secondary-button"
                  onClick={() => setWorkspaceReload((current) => current + 1)}
                >
                  Retry
                </button>
              </div>
            )}
            {active !== "Today" && (
              <WorkspaceView
                key={workspaceId}
                active={active}
                data={workspaceData}
                tasks={tasks}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                onNavigate={setActive}
                teamBoardFocus={teamBoardFocus}
                onTeamBoardFocusChange={setTeamBoardFocus}
                theme={theme}
                onSetTheme={setTheme}
                sidebarCollapsed={sidebarCollapsed}
                workspaceId={workspaceId}
                currentWorkspace={currentWorkspace}
                currentUserName={
                  [session.user.first_name, session.user.last_name]
                    .filter(Boolean)
                    .join(" ") || session.user.email
                }
                currentUserEmail={session.user.email}
                currentUserId={session.user.id}
                currentUserAvatarUrl={currentUserAvatarUrl}
                currentUserPresence={currentUserPresence}
                currentUserCompany={session.user.company || ''}
                currentUserJobRole={session.user.job_role || ''}
                currentUserWorkspaces={session.user.workspaces}
                defaultWorkspaceId={session.user.default_workspace_id}
                onSetDefaultWorkspace={setDefaultWorkspace}
                onProfileUpdated={updateSessionUser}
                canManageMembers={["owner", "manager"].includes(
                  currentWorkspace?.role,
                )}
                canManageTasks={["owner", "manager"].includes(
                  currentWorkspace?.role,
                )}
                reportRange={reportRange}
                setReportRange={setReportRange}
                shiftLogUserId={shiftLogUserId}
                setShiftLogUserId={setShiftLogUserId}
                shiftLogPage={shiftLogPage}
                setShiftLogPage={setShiftLogPage}
                reportLastUpdated={reportLastUpdated}
                onToggleTheme={() =>
                  setTheme((current) => (current === "dark" ? "light" : "dark"))
                }
                onToggleSidebar={() =>
                  setSidebarCollapsed((current) => !current)
                }
                onComplete={completeTask}
                onStatusChange={changeTaskStatus}
                onBucketChange={changeTaskBucket}
                onDelete={deleteTask}
                onAddTask={() => openTaskModal()}
                onOpenTask={setSelectedTask}
                onOpenNotification={openNotification}
                onMarkNotificationsRead={markNotificationsRead}
                onActionError={(message) => toast.error(message)}
                onRefresh={() => setWorkspaceReload((current) => current + 1)}
                onConfirm={confirmAction}
                screenShareNotificationId={screenShareNotificationId}
              />
            )}
            {active === "Today" && (
              <TodayDashboard
                today={today}
                todayLabel={todayLabel}
                currentUserName={currentUserName}
                workspaceName={currentWorkspace?.name || "your workspace"}
                tasks={tasks}
                events={workspaceData.events}
                followUps={workspaceData.followUps}
                checkIns={workspaceData.checkIns}
                workShifts={workspaceData.workShifts}
                currentUserId={session.user.id}
                currentUserPresence={currentUserPresence}
                onSubmitShift={submitWorkShift}
                onChangePresence={changePresence}
                members={workspaceData.members}
                canManageMembers={canManageMembers}
                onAddTask={() => openTaskModal()}
                onInvite={() => openComposer("invite")}
                onOpenTask={setSelectedTask}
                onNavigate={setActive}
                onOpenBoard={(focus) => {
                  setTeamBoardFocus(focus);
                  setActive("Team board");
                }}
                onComplete={completeTask}
                onStatusChange={changeTaskStatus}
              />
            )}
          </div>
        </main>
      </div>

      {aiLauncherHidden && activeWorkspaceId && (
        <button
          type="button"
          className="ai-restore-tab"
          aria-label="Show Ask Zuri button"
          title="Show Ask Zuri"
          onClick={() => {
            setAiLauncherVisibility(false);
            requestAnimationFrame(() =>
              document
                .querySelector(
                  window.matchMedia("(min-width: 1024px)").matches
                    ? ".ai-desktop-launcher"
                    : ".ai-mobile-launcher",
                )
                ?.focus(),
            );
          }}
        >
          <ChevronLeft size={20} />
        </button>
      )}
      {aiMinimized && !aiLauncherHidden && activeWorkspaceId && (
        <div className="ai-minimized-toast" role="status" aria-live="polite">
          <span className="ai-minimized-icon"><Sparkles size={17} /></span>
          <span className="ai-minimized-copy">
            <strong>Zuri</strong>
            <small>Conversation minimized</small>
          </span>
          <button
            type="button"
            onClick={() => {
              setAiMinimized(false);
              setAiLauncherVisibility(false);
              setAiFlyoutOpen(true);
            }}
          >
            Open
          </button>
        </div>
      )}
      {!aiLauncherHidden && !aiMinimized && activeWorkspaceId && (
        <button
          type="button"
          onClick={() => {
            setAiMinimized(false);
            setAiFlyoutOpen(true);
          }}
          className="ai-desktop-launcher"
          aria-label="Open Zuri"
          aria-haspopup="dialog"
          title="Open Zuri"
        >
          <CircleUserRound size={26} />
        </button>
      )}

      {/* ── Mobile bottom pill nav - four primary destinations plus "More",
        which opens the same drawer as the header hamburger so the full
        navigation stays reachable. Hidden while that drawer is open so the
        pill doesn't sit dimmed under the overlay. ── */}
      <nav
        className={cn(
          "fixed bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-2xl border border-white/10 bg-navy/95 p-1.5 shadow-lg backdrop-blur transition-opacity duration-200 lg:hidden",
          mobileOpen && "pointer-events-none opacity-0",
        )}
        aria-label="Primary"
      >
        {mobilePillItems.map(({ label, icon: Icon, badge, badgeTone }) => (
          <button
            type="button"
            key={label}
            onClick={() => setActive(label)}
            aria-current={active === label ? "page" : undefined}
            className={cn(
              "relative flex h-12 w-[4.5rem] flex-col items-center justify-center gap-0.5 rounded-xl transition-colors",
              active === label
                ? "bg-accent text-navy"
                : "text-white/60 hover:bg-white/5 hover:text-white",
            )}
          >
            <Icon size={19} className="shrink-0" />
            <span className="max-w-full truncate px-1 text-[10px] font-semibold leading-none">
              {label}
            </span>
            {badge > 0 && (
              <span
                className={cn(
                  "absolute right-2.5 top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-bold",
                  badgeTone === "accent"
                    ? "bg-accent text-navy"
                    : "bg-danger text-white",
                  active === label && "bg-navy text-white",
                )}
              >
                {badge > 9 ? "9+" : badge}
              </span>
            )}
          </button>
        ))}

        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-expanded={mobileOpen}
          aria-haspopup="menu"
          className="flex h-12 w-[4.5rem] flex-col items-center justify-center gap-0.5 rounded-xl text-white/60 transition-colors hover:bg-white/5 hover:text-white"
        >
          <MoreHorizontal size={19} className="shrink-0" />
          <span className="text-[10px] font-semibold leading-none">More</span>
        </button>
      </nav>

      {showModal && (
        <div className="modal-backdrop" onMouseDown={() => setShowModal(false)}>
          <form
            className="modal"
            ref={taskModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-task-title"
            onSubmit={addTask}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Quick capture</p>
                <h2 id="add-task-title">Add a task</h2>
              </div>
              <button
                type="button"
                className="close-button"
                onClick={() => setShowModal(false)}
                aria-label="Close add task dialog"
              >
                <X size={18} />
              </button>
            </div>
            <label>
              Task name
              <input
                autoFocus
                value={newTask}
                onChange={(event) => {
                  setNewTask(event.target.value);
                  setTaskError("");
                }}
                placeholder="What needs to happen?"
              />
            </label>
            <label>
              Description
              <textarea
                value={newDescription}
                onChange={(event) => setNewDescription(event.target.value)}
                placeholder="Add more detail about this task"
                maxLength="4000"
              />
            </label>
            <label>
              Apply template
              <AppSelect value={newTaskTemplate} onChange={applyTaskTemplate}>
                <option value="">No template</option>
                {workspaceData.taskTemplates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </AppSelect>
            </label>
            {taskError && (
              <p className="auth-error" role="alert">
                {taskError}
              </p>
            )}
            <div className="modal-grid">
              <label>
                Assign to
                <AppSelect
                  value={newAssigneeId}
                  onChange={(event) => setNewAssigneeId(event.target.value)}
                >
                  <option value="">Unassigned</option>
                  {workspaceData.members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {[member.first_name, member.last_name]
                        .filter(Boolean)
                        .join(" ") || member.email}
                    </option>
                  ))}
                </AppSelect>
              </label>
              <DateField
                label="Due date"
                value={newDueDate}
                onChange={(event) => setNewDueDate(event.target.value)}
              />
            </div>
            <div className="modal-grid">
              <label>
                Project
                <AppSelect
                  value={newProjectId}
                  disabled={Boolean(newWorkstreamId)}
                  onChange={(event) => { setNewProjectId(event.target.value); if (event.target.value) { setNewWorkstreamId(""); setNewBucket("Backlog"); } }}
                >
                  <option value="">General</option>
                  {workspaceData.projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </AppSelect>
              </label>
              <label>
                Workstream
                <AppSelect value={newWorkstreamId} disabled={Boolean(newProjectId)} onChange={(event) => { setNewWorkstreamId(event.target.value); if (event.target.value) { setNewProjectId(""); setNewBucket("Backlog"); } }}>
                  <option value="">No workstream</option>
                  {(workspaceData.lookupValues || []).filter((value) => value.kind === "workstream" && value.is_active && !value.project_id).map((workstream) => <option key={workstream.id} value={workstream.id}>{workstream.name}</option>)}
                </AppSelect>
              </label>
              <label>
                Priority
                <AppSelect
                  value={newPriority}
                  onChange={(event) => setNewPriority(event.target.value)}
                >
                  <option value="urgent">Urgent</option>
                  <option value="high">High</option>
                  <option value="normal">Normal</option>
                  <option value="low">Low</option>
                </AppSelect>
              </label>
            </div>
            <label>
              Planner bucket
              <AppSelect
                value={newBucket}
                onChange={(event) => {
                  const bucket = workspaceData.buckets.find(
                    (item) => String(item.name) === String(event.target.value),
                  );
                  setNewBucket(event.target.value);
                  if (bucket?.project_id) {
                    setNewProjectId(String(bucket.project_id));
                    setNewWorkstreamId("");
                  } else if (bucket?.workstream_id) {
                    setNewWorkstreamId(String(bucket.workstream_id));
                    setNewProjectId("");
                  }
                }}
              >
                {(
                  workspaceData.buckets.length
                    ? workspaceData.buckets
                    : [{ id: "backlog", name: "Backlog" }]
                )
                  .filter((bucket) => {
                    if (!bucket.project_id && !bucket.workstream_id) return true;
                    if (newProjectId) return String(bucket.project_id || "") === String(newProjectId);
                    if (newWorkstreamId) return String(bucket.workstream_id || "") === String(newWorkstreamId);
                    return true;
                  })
                  .map((bucket) => (
                    <option key={bucket.id} value={bucket.name}>
                      {bucket.name}
                    </option>
                  ))}
              </AppSelect>
            </label>
            <label>
              Repeat
              <AppSelect
                value={newRecurrence}
                onChange={(event) => setNewRecurrence(event.target.value)}
              >
                <option value="none">Does not repeat</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </AppSelect>
            </label>
            <button className="primary-button modal-submit">
              Create task <ArrowUpRight size={16} />
            </button>
          </form>
        </div>
      )}
      {inviteComposerOpen && (
        <WorkspaceComposer
          type="invite"
          form={inviteForm}
          setForm={setInviteForm}
          error={inviteError}
          submitting={inviteSubmitting}
          onClose={() => setInviteComposerOpen(false)}
          onSubmit={submitInvite}
        />
      )}
      {selectedTask && (
        <TaskDetailDrawer
          task={selectedTask}
          workspaceId={activeWorkspaceId}
          members={workspaceData.members}
          currentUserId={session.user.id}
          projects={workspaceData.projects}
          buckets={workspaceData.buckets}
          canManageTasks={["owner", "manager"].includes(currentWorkspace?.role)}
          onClose={() => setSelectedTask(null)}
          onDelete={deleteTask}
          onTaskUpdated={(updatedTask) => {
            setTasks((current) =>
              current.map((item) =>
                item.id === updatedTask.id
                  ? { ...item, ...mapApiTask(updatedTask) }
                  : item,
              ),
            );
            setSelectedTask((current) =>
              current && current.id === updatedTask.id
                ? { ...current, ...mapApiTask(updatedTask) }
                : current,
            );
          }}
          tasks={tasks}
        />
      )}
      <CookieConsent onOpenLegal={() => setActive("Legal")} />
    </div>
  );
}

function WorkspaceView({
  active,
  data,
  tasks,
  searchQuery,
  onSearchChange,
  onNavigate,
  teamBoardFocus,
  onTeamBoardFocusChange,
  theme,
  onSetTheme,
  sidebarCollapsed,
  workspaceId,
  currentWorkspace,
  currentUserName,
  currentUserEmail,
  currentUserId,
  currentUserAvatarUrl,
  currentUserPresence,
  currentUserCompany,
  currentUserJobRole,
  currentUserWorkspaces,
  defaultWorkspaceId,
  onSetDefaultWorkspace,
  onProfileUpdated,
  canManageMembers,
  canManageTasks,
  reportRange,
  setReportRange,
  shiftLogUserId,
  setShiftLogUserId,
  shiftLogPage,
  setShiftLogPage,
  reportLastUpdated,
  onToggleTheme,
  onToggleSidebar,
  onComplete,
  onStatusChange,
  onBucketChange,
  onDelete,
  onAddTask,
  onOpenTask,
  onOpenNotification,
  onMarkNotificationsRead,
  onActionError,
  onRefresh,
  onConfirm,
  screenShareNotificationId,
}) {
  const today = toDateKey(new Date());
  const [localData, setLocalData] = useState(data);
  const [calendarView, setCalendarView] = useState("week");
  const [calendarDate, setCalendarDate] = useState(new Date());
  const [calendarFilter, setCalendarFilter] = useState("all");
  const [calendarTaskScope, setCalendarTaskScope] = useState("all");
  const [checkInDate, setCheckInDate] = useState(today);
  const [pendingCheckInId, setPendingCheckInId] = useState(null);
  const [checkInLoading, setCheckInLoading] = useState(false);
  const [checkInError, setCheckInError] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerType, setComposerType] = useState("chat");
  const [composerError, setComposerError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [newBucketName, setNewBucketName] = useState("");
  const [bucketError, setBucketError] = useState("");
  const [bucketSubmitting, setBucketSubmitting] = useState(false);
  const [newWorkstreamName, setNewWorkstreamName] = useState("");
  const [workstreamSubmitting, setWorkstreamSubmitting] = useState(false);
  const [workstreamError, setWorkstreamError] = useState("");
  const [replyTo, setReplyTo] = useState(null);
  const [chatChannel, setChatChannel] = useState("general");
  const [chatSearch, setChatSearch] = useState("");
  const [plannerFilter, setPlannerFilter] = useState("all");
  const [plannerProjectFilter, setPlannerProjectFilter] = useState(() => localStorage.getItem("workspace-project-filter") || "all");
  useEffect(() => { localStorage.setItem("workspace-project-filter", plannerProjectFilter); }, [plannerProjectFilter]);
  const [reportsScope, setReportsScope] = useState("all");
  const [teamBoardScope, setTeamBoardScope] = useState("all");
  const [activitySearch, setActivitySearch] = useState("");
  const [activityActor, setActivityActor] = useState("all");
  const [activityKind, setActivityKind] = useState("all");
  const [activityPage, setActivityPage] = useState(1);
  const [notificationPage, setNotificationPage] = useState(1);
  const [notificationHistory, setNotificationHistory] = useState([]);
  const [notificationPagination, setNotificationPagination] = useState(null);
  const [notificationLoading, setNotificationLoading] = useState(false);
  const [notificationError, setNotificationError] = useState("");
  const [notificationReload, setNotificationReload] = useState(0);
  const [projectQuery, setProjectQuery] = useState("");
  const [projectStatusFilter, setProjectStatusFilter] = useState("all");
  const [projectHealthFilter, setProjectHealthFilter] = useState("all");
  const [projectSort, setProjectSort] = useState("due");
  const [savedViewName, setSavedViewName] = useState("");
  const [selectedSavedView, setSelectedSavedView] = useState("");
  const [selectedProject, setSelectedProject] = useState(null);
  const [selectedProjectWorkspace, setSelectedProjectWorkspace] =
    useState(null);
  const [pendingProjectNotification, setPendingProjectNotification] = useState(null);
  const [pendingWorkstreamNotification, setPendingWorkstreamNotification] = useState(null);
  const [projectOperation, setProjectOperation] = useState("");
  const [selectedFollowUp, setSelectedFollowUp] = useState(null);
  const [pendingFollowUpId, setPendingFollowUpId] = useState(null);
  const [selectedCheckIn, setSelectedCheckIn] = useState(null);
  const [selectedCheckInDetail, setSelectedCheckInDetail] = useState(null);
  const [followUpFilter, setFollowUpFilter] = useState("all");
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [pendingEventId, setPendingEventId] = useState(null);
  const [savedViews, setSavedViews] = useState(data.savedViews || []);
  const canCommentCheckIns = Boolean(currentWorkspace?.permissions?.includes("comment_check_ins"));
  const [form, setForm] = useState({
    title: "",
    name: "",
    description: "",
    start_at: "",
    end_at: "",
    event_type: "meeting",
    reminder_minutes: 15,
    completed: "",
    next_steps: "",
    blockers: "",
    message: "",
    channel: "general",
    note: "",
    due_date: "",
    assigned_to: "",
    task_id: "",
    date: today,
    email: "",
    role: "member",
  });
  // Narrowing the activity filters can shrink the list below the current page,
  // so go back to the first page whenever the filters change.
  useEffect(() => {
    setActivityPage(1);
  }, [activitySearch, activityActor, activityKind]);
  useEffect(() => {
    if (active === "Notifications") setNotificationPage(1);
  }, [active]);
  useEffect(() => {
    if (active !== "Notifications" || !workspaceId) return undefined;
    let current = true;
    setNotificationLoading(true);
    setNotificationError("");
    fetch(`/api/workspaces/${workspaceId}/notifications/?page=${notificationPage}`, {
      credentials: "include",
    })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok)
          throw new Error(payload.error || "Notifications could not be loaded.");
        return payload;
      })
      .then((payload) => {
        if (!current) return;
        setNotificationHistory(payload.notifications || []);
        setNotificationPagination(payload.pagination || null);
      })
      .catch((error) => {
        if (current) setNotificationError(error.message || "Notifications could not be loaded.");
      })
      .finally(() => {
        if (current) setNotificationLoading(false);
      });
    return () => {
      current = false;
    };
  }, [active, workspaceId, notificationPage, notificationReload]);
  useEffect(() => {
    const handleReportFilter = (event) => {
      if (event.detail) setPlannerFilter(event.detail);
    };
    window.addEventListener("planner:filter", handleReportFilter);
    const handleProjectFilter = (event) =>
      setPlannerProjectFilter(event.detail || "all");
    window.addEventListener("planner:project", handleProjectFilter);
    return () => {
      window.removeEventListener("planner:filter", handleReportFilter);
      window.removeEventListener("planner:project", handleProjectFilter);
    };
  }, []);
  useEffect(() => {
    if (active !== "Projects" || selectedProjectWorkspace) return undefined;
    const openProjectCard = (event) => {
      const card = event.target.closest?.(".project-card");
      if (!card || event.target.closest?.("button, select, a, input")) return;
      const projectName = card.querySelector("h3")?.textContent?.trim();
      const project = localData.projects.find(
        (item) => item.name === projectName,
      );
      if (project) setSelectedProjectWorkspace(project);
    };
    const openProjectCardWithKeyboard = (event) => {
      if (!["Enter", " "].includes(event.key)) return;
      const card = event.target.closest?.(".project-card");
      if (!card) return;
      event.preventDefault();
      const projectName = card.querySelector("h3")?.textContent?.trim();
      const project = localData.projects.find(
        (item) => item.name === projectName,
      );
      if (project) setSelectedProjectWorkspace(project);
    };
    const cards = [
      ...document.querySelectorAll(".projects-view .project-card"),
    ];
    cards.forEach((card) => {
      card.tabIndex = 0;
      card.setAttribute("role", "button");
      card.setAttribute(
        "aria-label",
        `Open project ${card.querySelector("h3")?.textContent || ""}`,
      );
    });
    document.addEventListener("click", openProjectCard);
    document.addEventListener("keydown", openProjectCardWithKeyboard);
    return () => {
      document.removeEventListener("click", openProjectCard);
      document.removeEventListener("keydown", openProjectCardWithKeyboard);
    };
  }, [active, selectedProjectWorkspace, localData.projects]);
  useEffect(() => {
    const closeOverlays = (event) => {
      if (event.key !== "Escape") return;
      setComposerOpen(false);
      setReplyTo(null);
      setSelectedProject(null);
      setSelectedFollowUp(null);
      setSelectedCheckIn(null);
      setSelectedEvent(null);
    };
    window.addEventListener("keydown", closeOverlays);
    return () => window.removeEventListener("keydown", closeOverlays);
  }, []);
  useEffect(
    () =>
      setLocalData((current) => ({
        ...data,
        buckets: [
          ...(data.buckets || []),
          ...(current.buckets || []).filter(
            (existing) =>
              !(data.buckets || []).some((bucket) => bucket.id === existing.id),
          ),
        ],
        checkIns: current.checkIns,
      })),
    [data],
  );
  useEffect(() => setSavedViews(data.savedViews || []), [data.savedViews]);

  useEffect(() => {
    if (active === "Planner" && pendingWorkstreamNotification && localData.lookupValues.some((value) => value.kind === "workstream" && String(value.id) === String(pendingWorkstreamNotification))) {
      setPendingWorkstreamNotification(null);
    }
  }, [active, localData.lookupValues, pendingWorkstreamNotification]);

  useEffect(() => {
    if (!workspaceId) return undefined;
    let current = true;
    const read = async (url) => {
      const response = await fetch(url, { credentials: "include" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Notification target could not be loaded.");
      return payload;
    };
    const loadMissingTarget = async () => {
      try {
        if (active === "Follow-up" && pendingFollowUpId && !localData.followUps.some((item) => String(item.id) === String(pendingFollowUpId))) {
          const payload = await read(`/api/workspaces/${workspaceId}/follow-ups/`);
          const target = (payload.follow_ups || []).find((item) => String(item.id) === String(pendingFollowUpId));
          if (current && target) setLocalData((data) => ({ ...data, followUps: [...data.followUps.filter((item) => String(item.id) !== String(target.id)), target] }));
          return;
        }
        if (active === "Calendar" && pendingEventId && !localData.events.some((item) => String(item.id) === String(pendingEventId))) {
          const payload = await read(`/api/workspaces/${workspaceId}/calendar-events/`);
          const target = (payload.events || []).find((item) => String(item.id) === String(pendingEventId));
          if (current && target) setLocalData((data) => ({ ...data, events: [...data.events.filter((item) => String(item.id) !== String(target.id)), target] }));
          return;
        }
        if (active === "Planner" && pendingWorkstreamNotification && !localData.lookupValues.some((item) => item.kind === "workstream" && String(item.id) === String(pendingWorkstreamNotification))) {
          const payload = await read(`/api/workspaces/${workspaceId}/lookup-values/`);
          const target = (payload.lookup_values || []).find((item) => item.kind === "workstream" && String(item.id) === String(pendingWorkstreamNotification));
          if (current && target) setLocalData((data) => ({ ...data, lookupValues: [...data.lookupValues.filter((item) => item.id !== target.id), target] }));
          return;
        }
        if (active === "Projects" && pendingProjectNotification) {
          const { id, operation, targetType } = pendingProjectNotification;
          if (targetType === "risk_issue") {
            const payload = await read(`/api/workspaces/${workspaceId}/risks-issues/`);
            const risk = (payload.records || []).find((item) => String(item.id) === String(id));
            if (!risk?.project_id) return;
            const project = localData.projects.find((item) => String(item.id) === String(risk.project_id));
            if (project && current) {
              setSelectedProjectWorkspace(project);
              setProjectOperation(operation);
              setPendingProjectNotification(null);
            } else {
              const projects = await read(`/api/workspaces/${workspaceId}/projects/?page_size=500`);
              const targetProject = (projects.projects || []).find((item) => String(item.id) === String(risk.project_id));
              if (current && targetProject) {
                setLocalData((data) => ({ ...data, projects: [...data.projects.filter((item) => String(item.id) !== String(targetProject.id)), targetProject] }));
              }
            }
          } else if (!localData.projects.some((item) => String(item.id) === String(id))) {
            const payload = await read(`/api/workspaces/${workspaceId}/projects/?page_size=500`);
            const target = (payload.projects || []).find((item) => String(item.id) === String(id));
            if (current && target) setLocalData((data) => ({ ...data, projects: [...data.projects.filter((item) => String(item.id) !== String(target.id)), target] }));
          }
        }
      } catch (error) {
        if (current) onActionError(error.message || "Notification target could not be loaded.");
      }
    };
    loadMissingTarget();
    return () => { current = false; };
  }, [active, workspaceId, localData.events, localData.followUps, localData.lookupValues, localData.projects, pendingEventId, pendingFollowUpId, pendingProjectNotification, pendingWorkstreamNotification, onActionError]);

  useEffect(() => {
    if (active !== "Projects" || !pendingProjectNotification || pendingProjectNotification.targetType === "risk_issue") return;
    const targetProject = localData.projects.find(
      (project) => String(project.id) === String(pendingProjectNotification.id),
    );
    if (targetProject) {
      setSelectedProjectWorkspace(targetProject);
      setProjectOperation(pendingProjectNotification.operation);
      setPendingProjectNotification(null);
    }
  }, [active, localData.projects, pendingProjectNotification]);

  useEffect(() => {
    if (active !== "Calendar" || !pendingEventId) return;
    const targetEvent = localData.events.find(
      (event) => String(event.id) === String(pendingEventId),
    );
    if (targetEvent) {
      setSelectedEvent(targetEvent);
      setPendingEventId(null);
    }
  }, [active, localData.events, pendingEventId]);

  useEffect(() => {
    if (active === "Follow-up" && pendingFollowUpId) {
      const targetFollowUp = localData.followUps.find(
        (followUp) => String(followUp.id) === String(pendingFollowUpId),
      );
      if (targetFollowUp) {
        setSelectedFollowUp(targetFollowUp);
        setPendingFollowUpId(null);
      }
    }
  }, [active, localData.followUps, pendingFollowUpId]);

  useEffect(() => {
    if (active !== "Check-ins") return undefined;
    let isCurrent = true;
    setCheckInLoading(true);
    setCheckInError("");
    fetch(`/api/workspaces/${workspaceId}/check-ins/?date=${checkInDate}`, {
      credentials: "include",
    })
      .then((response) =>
        response
          .json()
          .then((responseData) => ({ ok: response.ok, responseData })),
      )
      .then(({ ok, responseData }) => {
        if (!isCurrent) return;
        if (!ok)
          throw new Error(
            responseData.error || "Check-ins could not be loaded.",
          );
        setLocalData((current) => ({
          ...current,
          checkIns: responseData.check_ins,
        }));
        const targetCheckIn = responseData.check_ins.find(
          (checkIn) => String(checkIn.id) === String(pendingCheckInId),
        );
        if (targetCheckIn) {
          setSelectedCheckInDetail(targetCheckIn);
          setPendingCheckInId(null);
        }
      })
      .catch((error) => {
        if (isCurrent) setCheckInError(error.message);
      })
      .finally(() => {
        if (isCurrent) setCheckInLoading(false);
      });
    return () => {
      isCurrent = false;
    };
  }, [active, checkInDate, workspaceId, pendingCheckInId]);

  const openComposer = (type) => {
    setComposerType(type);
    setComposerError("");
    setForm((current) => ({
      ...current,
      title: "",
      name: "",
      description: "",
      start_at: "",
      end_at: "",
      reminder_minutes: 15,
      completed: "",
      next_steps: "",
      blockers: "",
      message: "",
      channel: chatChannel,
      note: "",
      due_date: "",
      assigned_to: "",
      task_id: "",
      date: type === "checkin" ? checkInDate : today,
      email: "",
      role: "member",
    }));
    if (type !== "chat") setReplyTo(null);
    setComposerOpen(true);
  };

  const submitComposer = async (event) => {
    event.preventDefault();
    setComposerError("");
    setSubmitting(true);
    const endpoints = {
      calendar: `/api/workspaces/${workspaceId}/calendar-events/`,
      project: `/api/workspaces/${workspaceId}/projects/`,
      checkin: `/api/workspaces/${workspaceId}/check-ins/`,
      chat: `/api/workspaces/${workspaceId}/chat-messages/`,
      followup: `/api/workspaces/${workspaceId}/follow-ups/`,
      invite: `/api/workspaces/${workspaceId}/invitations/`,
    };
    const payloads = {
      calendar: {
        title: form.title,
        description: form.description,
        start_at: form.start_at,
        end_at: form.end_at,
        event_type: form.event_type,
        reminder_minutes: Number(form.reminder_minutes),
      },
      project: {
        name: form.name,
        description: form.description,
        due_date: form.due_date || null,
      },
      checkin: {
        date: form.date,
        completed: form.completed,
        next_steps: form.next_steps,
        blockers: form.blockers,
      },
      chat: {
        channel: form.channel,
        message: form.message,
        parent_id: replyTo?.id || null,
      },
      followup: {
        note: form.note,
        due_date: form.due_date || null,
        assigned_to: form.assigned_to || null,
        task_id: form.task_id || null,
      },
      invite: { email: form.email, role: form.role },
    };
    try {
      const response = await fetch(endpoints[composerType], {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": await getCsrfToken(),
          "X-Workspace-Id": String(workspaceId),
        },
        body: JSON.stringify(payloads[composerType]),
      });
      const responseData = await readJsonResponse(
        response,
        "Unable to save this update.",
      );
      if (!response.ok)
        throw new Error(responseData.error || "Unable to save this update.");
      const collections = {
        calendar: ["events", "event"],
        project: ["projects", "project"],
        checkin: ["checkIns", "check_in"],
        chat: ["messages", "message"],
        followup: ["followUps", "follow_up"],
        invite: ["invitations", "invitation"],
      };
      const [collection, itemKey] = collections[composerType];
      const item = responseData[itemKey];
      setLocalData((current) => ({
        ...current,
        [collection]:
          composerType === "checkin"
            ? [
                ...current[collection].filter(
                  (existing) => existing.id !== item.id,
                ),
                item,
              ]
            : [...current[collection], item],
      }));
      onRefresh();
      setComposerOpen(false);
      setReplyTo(null);
      if (composerType === "invite")
        toast.success(
          responseData.message || `Invitation sent to ${form.email}.`,
        );
    } catch (submitError) {
      setComposerError(submitError.message);
    } finally {
      setSubmitting(false);
    }
  };

  const runAction = async (operation, fallbackMessage) => {
    try {
      const response = await operation();
      const responseData = await readJsonResponse(response, fallbackMessage);
      if (!response.ok) throw new Error(responseData.error || fallbackMessage);
      return responseData;
    } catch (error) {
      onActionError(error.message || fallbackMessage);
      return null;
    }
  };

  const completeFollowUp = async (followUp) => {
    const canEdit =
      canManageMembers ||
      followUp.created_by === currentUserId ||
      followUp.assigned_to === currentUserId;
    if (!canEdit) {
      onActionError(
        "Only the follow-up creator, assignee, or a workspace leader can update it.",
      );
      return;
    }
    const nextStatus = followUp.status === "completed" ? "open" : "completed";
    const responseData = await runAction(
      async () =>
        fetch(`/api/follow-ups/${followUp.id}/`, {
          method: "PATCH",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "X-CSRFToken": await getCsrfToken(),
          },
          body: JSON.stringify({ status: nextStatus }),
        }),
      "Follow-up could not be updated.",
    );
    if (!responseData) return;
    setLocalData((current) => ({
      ...current,
      followUps: current.followUps.map((item) =>
        item.id === followUp.id ? responseData.follow_up : item,
      ),
    }));
    onRefresh();
  };
  const deleteFollowUp = async (followUp) => {
    if (
      !(await onConfirm("Delete this follow-up?", {
        confirmLabel: "Delete follow-up",
      }))
    )
      return;
    const responseData = await runAction(
      async () =>
        fetch(`/api/follow-ups/${followUp.id}/`, {
          method: "DELETE",
          credentials: "include",
          headers: { "X-CSRFToken": await getCsrfToken() },
        }),
      "Follow-up could not be deleted.",
    );
    if (!responseData) return;
    setLocalData((current) => ({
      ...current,
      followUps: current.followUps.filter((item) => item.id !== followUp.id),
    }));
    onRefresh();
  };
  const deleteCalendarEvent = async (eventId) => {
    const responseData = await runAction(
      async () =>
        fetch(`/api/workspaces/${workspaceId}/calendar-events/${eventId}/`, {
          method: "DELETE",
          credentials: "include",
          headers: { "X-CSRFToken": await getCsrfToken() },
        }),
      "Calendar event could not be deleted.",
    );
    if (!responseData) return;
    setLocalData((current) => ({
      ...current,
      events: current.events.filter((event) => event.id !== eventId),
    }));
    onRefresh();
  };
  const createBucket = async (event, scope = null) => {
    event.preventDefault();
    if (bucketSubmitting) return;
    if (!canManageMembers) {
      setBucketError("Only workspace leaders can create Planner buckets.");
      return;
    }
    const name = newBucketName.trim();
    if (!name || !scope) {
      setBucketError(
        "Select a project or workstream before creating a bucket.",
      );
      return;
    }
    setBucketError("");
    setBucketSubmitting(true);
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/plan-buckets/`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "X-CSRFToken": await getCsrfToken(),
            "X-Workspace-Id": String(workspaceId),
          },
          body: JSON.stringify({ name, ...scope }),
        },
      );
      const responseData = await readJsonResponse(
        response,
        "Bucket could not be created.",
      );
      if (!response.ok)
        throw new Error(responseData.error || "Bucket could not be created.");
      setLocalData((current) => ({
        ...current,
        buckets: current.buckets.some(
          (bucket) => bucket.id === responseData.bucket.id,
        )
          ? current.buckets
          : [...current.buckets, responseData.bucket],
      }));
      setNewBucketName("");
      window.dispatchEvent(
        new CustomEvent("workspace:notice", {
          detail: `Bucket “${responseData.bucket.name}” created.`,
        }),
      );
      onRefresh();
    } catch (error) {
      setBucketError(error.message || "Bucket could not be created.");
    } finally {
      setBucketSubmitting(false);
    }
  };

  const createWorkstream = async (event) => {
    event.preventDefault();
    if (workstreamSubmitting) return;
    if (!canManageMembers) {
      setWorkstreamError(
        "Only workspace leaders can create operations workstreams.",
      );
      return;
    }
    const name = newWorkstreamName.trim();
    if (!name) return;
    setWorkstreamError("");
    setWorkstreamSubmitting(true);
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/lookup-values/`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "X-CSRFToken": await getCsrfToken(),
            "X-Workspace-Id": String(workspaceId),
          },
          body: JSON.stringify({ kind: "workstream", name, project_id: null }),
        },
      );
      const responseData = await readJsonResponse(
        response,
        "Workstream could not be created.",
      );
      if (!response.ok)
        throw new Error(
          responseData.error || "Workstream could not be created.",
        );
      setLocalData((current) => ({
        ...current,
        lookupValues: (current.lookupValues || []).some(
          (value) => value.id === responseData.lookup_value.id,
        )
          ? current.lookupValues
          : [...(current.lookupValues || []), responseData.lookup_value],
      }));
      setNewWorkstreamName("");
      window.dispatchEvent(
        new CustomEvent("workspace:notice", {
          detail: `Workstream ${responseData.lookup_value.name} created.`,
        }),
      );
      onRefresh();
    } catch (error) {
      setWorkstreamError(error.message || "Workstream could not be created.");
    } finally {
      setWorkstreamSubmitting(false);
    }
  };

  const archiveBucket = async (bucket) => {
    if (
      !canManageMembers ||
      !(await onConfirm(
        `Archive ${bucket.name}? Tasks can still keep their current bucket label until they are moved.`,
        { title: "Archive bucket", confirmLabel: "Archive bucket" },
      ))
    )
      return;
    setBucketError("");
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/plan-buckets/${bucket.id}/`,
        {
          method: "DELETE",
          credentials: "include",
          headers: { "X-CSRFToken": await getCsrfToken() },
        },
      );
      const data = await readJsonResponse(
        response,
        "Bucket could not be archived.",
      );
      if (!response.ok)
        throw new Error(data.error || "Bucket could not be archived.");
      setLocalData((current) => ({
        ...current,
        buckets: current.buckets.filter((item) => item.id !== bucket.id),
      }));
      window.dispatchEvent(
        new CustomEvent("workspace:notice", {
          detail: `${bucket.name} archived.`,
        }),
      );
      onRefresh();
    } catch (error) {
      setBucketError(error.message || "Bucket could not be archived.");
    }
  };

  const deleteBucket = async (bucket) => {
    if (
      !canManageMembers ||
      !(await onConfirm(
        `Delete ${bucket.name}? Tasks in this bucket will keep their task history but become unbucketed.`,
        { title: "Delete bucket", confirmLabel: "Delete bucket" },
      ))
    )
      return;
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/plan-buckets/${bucket.id}/?permanent=1`,
        {
          method: "DELETE",
          credentials: "include",
          headers: { "X-CSRFToken": await getCsrfToken() },
        },
      );
      const data = await readJsonResponse(
        response,
        "Bucket could not be deleted.",
      );
      if (!response.ok)
        throw new Error(data.error || "Bucket could not be deleted.");
      setLocalData((current) => ({
        ...current,
        buckets: current.buckets.filter((item) => item.id !== bucket.id),
      }));
      onRefresh();
    } catch (error) {
      setBucketError(error.message || "Bucket could not be deleted.");
    }
  };

  const archiveWorkstream = async (value) => {
    if (
      !canManageMembers ||
      !(await onConfirm(
        `Archive ${value.name}? Existing tasks will keep the label but it will no longer appear for new tasks.`,
        { title: "Archive workstream", confirmLabel: "Archive workstream" },
      ))
    )
      return;
    setWorkstreamError("");
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/lookup-values/${value.id}/`,
        {
          method: "DELETE",
          credentials: "include",
          headers: { "X-CSRFToken": await getCsrfToken() },
        },
      );
      const data = await readJsonResponse(
        response,
        "Workstream could not be archived.",
      );
      if (!response.ok)
        throw new Error(data.error || "Workstream could not be archived.");
      setLocalData((current) => ({
        ...current,
        lookupValues: (current.lookupValues || []).filter(
          (item) => item.id !== value.id,
        ),
      }));
      window.dispatchEvent(
        new CustomEvent("workspace:notice", {
          detail: `${value.name} archived.`,
        }),
      );
      onRefresh();
    } catch (error) {
      setWorkstreamError(error.message || "Workstream could not be archived.");
    }
  };

  const reorderBuckets = async (bucketIds) => {
    if (!canManageMembers) return;
    const previousBuckets = [...localData.buckets];
    const byId = new Map(
      previousBuckets.map((bucket) => [Number(bucket.id), bucket]),
    );
    const ids = bucketIds.map(Number);
    if (
      ids.length !== previousBuckets.length ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !byId.has(id))
    ) {
      setBucketError(
        "Bucket order could not be saved. Refresh the page and try again.",
      );
      return;
    }
    const nextBuckets = ids.map((id) => byId.get(id));
    if (
      nextBuckets.every(
        (bucket, index) => bucket.id === previousBuckets[index]?.id,
      )
    )
      return;
    setBucketError("");
    setLocalData((current) => ({ ...current, buckets: nextBuckets }));
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/plan-buckets/reorder/`,
        {
          method: "PATCH",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "X-CSRFToken": await getCsrfToken(),
            "X-Workspace-Id": String(workspaceId),
          },
          body: JSON.stringify({ bucket_ids: ids }),
        },
      );
      const responseData = await readJsonResponse(
        response,
        "Bucket order could not be saved.",
      );
      if (!response.ok)
        throw new Error(
          responseData.error || "Bucket order could not be saved.",
        );
      setLocalData((current) => ({
        ...current,
        buckets: responseData.buckets,
      }));
      window.dispatchEvent(
        new CustomEvent("workspace:notice", { detail: "Bucket order saved." }),
      );
      onRefresh();
    } catch (error) {
      setLocalData((current) => ({ ...current, buckets: previousBuckets }));
      setBucketError(error.message || "Bucket order could not be saved.");
    }
  };
  const calendarDays = getCalendarDays(calendarView, calendarDate);
  const calendarEventsForDay = (day) =>
    localData.events.filter((event) => {
      const eventDate = new Date(event.start_at);
      if (calendarView === "year")
        return (
          eventDate.getFullYear() === day.getFullYear() &&
          eventDate.getMonth() === day.getMonth()
        );
      return toDateKey(event.start_at) === toDateKey(day);
    });
  const upcomingEvents = localData.events
    .filter((event) => new Date(event.start_at) >= new Date())
    .sort((a, b) => new Date(a.start_at) - new Date(b.start_at));
  const calendarHeading =
    calendarView === "year"
      ? formatCalendarDate(calendarDate, { year: "numeric" })
      : formatCalendarDate(calendarDate, { month: "long", year: "numeric" });
  const shiftCalendar = (amount) => {
    const next = new Date(calendarDate);
    if (calendarView === "day" || calendarView === "agenda")
      next.setDate(next.getDate() + amount);
    if (calendarView === "week") next.setDate(next.getDate() + amount * 7);
    if (calendarView === "month") next.setMonth(next.getMonth() + amount);
    if (calendarView === "year") next.setFullYear(next.getFullYear() + amount);
    setCalendarDate(next);
  };
  const updateProjectStatus = async (project, status) => {
    const responseData = await runAction(
      async () =>
        fetch(`/api/workspaces/${workspaceId}/projects/${project.id}/`, {
          method: "PATCH",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "X-CSRFToken": await getCsrfToken(),
          },
          body: JSON.stringify({ status }),
        }),
      "Project status could not be saved.",
    );
    if (!responseData) return;
    setLocalData((current) => ({
      ...current,
      projects: current.projects.map((item) =>
        item.id === project.id ? responseData.project : item,
      ),
    }));
    toast.success(
      `${project.name} moved to ${status.charAt(0).toUpperCase() + status.slice(1)}.`,
    );
    onRefresh();
  };
  const deleteProject = async (project) => {
    if (
      !canManageMembers ||
      !(await onConfirm(`Delete ${project.name}? This cannot be undone.`, {
        title: "Delete project",
        confirmLabel: "Delete project",
      }))
    )
      return;
    const responseData = await runAction(
      async () =>
        fetch(`/api/workspaces/${workspaceId}/projects/${project.id}/`, {
          method: "DELETE",
          credentials: "include",
          headers: { "X-CSRFToken": await getCsrfToken() },
        }),
      "Project could not be deleted.",
    );
    if (!responseData) return;
    setLocalData((current) => ({
      ...current,
      projects: current.projects.filter((item) => item.id !== project.id),
    }));
    toast.success(`${project.name} deleted.`);
    onRefresh();
  };
  const updateMemberRole = async (member, role) => {
    const responseData = await runAction(
      async () =>
        fetch(`/api/workspaces/${workspaceId}/members/${member.id}/`, {
          method: "PATCH",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "X-CSRFToken": await getCsrfToken(),
          },
          body: JSON.stringify({ role }),
        }),
      "Member role could not be updated.",
    );
    if (!responseData) return;
    setLocalData((current) => ({
      ...current,
      members: current.members.map((item) =>
        item.id === member.id ? responseData.member : item,
      ),
    }));
    onRefresh();
  };
  const removeMember = async (member) => {
    if (
      member.role === "owner" ||
      !(await onConfirm(`Remove ${member.email} from this workspace?`, {
        title: "Remove member",
        confirmLabel: "Remove member",
      }))
    )
      return;
    const responseData = await runAction(
      async () =>
        fetch(`/api/workspaces/${workspaceId}/members/${member.id}/`, {
          method: "DELETE",
          credentials: "include",
          headers: { "X-CSRFToken": await getCsrfToken() },
        }),
      "Member could not be removed.",
    );
    if (!responseData) return;
    setLocalData((current) => ({
      ...current,
      members: current.members.filter((item) => item.id !== member.id),
    }));
    onRefresh();
  };
  const cancelInvitation = async (invitation) => {
    if (
      !(await onConfirm(`Revoke invitation for ${invitation.email}?`, {
        title: "Revoke invitation",
        confirmLabel: "Revoke invitation",
      }))
    )
      return;
    const responseData = await runAction(
      async () =>
        fetch(`/api/workspaces/${workspaceId}/invitations/${invitation.id}/`, {
          method: "DELETE",
          credentials: "include",
          headers: { "X-CSRFToken": await getCsrfToken() },
        }),
      "Invitation could not be revoked.",
    );
    if (!responseData) return;
    setLocalData((current) => ({
      ...current,
      invitations: current.invitations.map((item) =>
        item.id === invitation.id ? { ...item, status: "cancelled" } : item,
      ),
    }));
    onRefresh();
  };
  const resendInvitation = async (invitation) => {
    const responseData = await runAction(
      async () =>
        fetch(
          `/api/workspaces/${workspaceId}/invitations/${invitation.id}/resend/`,
          {
            method: "POST",
            credentials: "include",
            headers: { "X-CSRFToken": await getCsrfToken() },
          },
        ),
      "Invitation could not be resent.",
    );
    if (!responseData) return;
    setLocalData((current) => ({
      ...current,
      invitations: current.invitations.map((item) =>
        item.id === invitation.id ? responseData.invitation : item,
      ),
    }));
    toast.success(`Invitation resent to ${invitation.email}.`);
  };
  const title = active === "My tasks" ? "My tasks" : active;
  const subtitle = {
    "My tasks": "Your personal work, deadlines, and follow-ups.",
    "Team board": "See ownership and progress across the workspace.",
    Planner: "Plan work visually across buckets, owners, and priorities.",
    "Daily operations": "Track recurring and day-to-day work outside projects.",
    Calendar: "Meetings, focus time, and deadlines in one view.",
    Reports: "Understand progress, workload, and team health.",
    Settings: "Manage your workspace preferences.",
    Projects: "Keep initiatives, milestones, and ownership visible.",
    Channels: "Shared workspace rooms for topics, projects, and teams.",
    Chats: "Private one-to-one and group conversations.",
    "Follow-up": "A clear queue for work that needs a response.",
    "Check-ins": "Daily updates that keep the team aligned.",
    Help: "Guides for tasks, conversations, and workspace settings.",
    Legal: "Privacy, cookies, terms, and acceptable use.",
  }[active];

  if (active === "Daily operations") {
    const persistedBacklog = localData.buckets.find(
      (bucket) => bucket.name === "Backlog",
    );
    const configuredBuckets = [
      persistedBacklog || { id: "backlog", name: "Backlog" },
      ...localData.buckets.filter((bucket) => bucket.name !== "Backlog"),
    ];
    const configuredNames = new Set(
      configuredBuckets.map((bucket) => bucket.name),
    );
    const buckets = [
      ...configuredBuckets,
      ...[...new Set(tasks.map((task) => task.bucket || "Backlog"))]
        .filter((name) => !configuredNames.has(name))
        .map((name) => ({ id: `legacy-${name}`, name })),
    ];
    const availableMembers = localData.members.filter((member) => member.id);
    return (
      <section className="workspace-view planner-view-wrapper">
        <PlannerBoard
          buckets={buckets}
          tasks={tasks}
          projects={localData.projects}
          lookupValues={localData.lookupValues || []}
          projectFilter="operations"
          scopeMode="operations"
          initialWorkstream={localData.lookupValues.find((value) => value.kind === "workstream" && String(value.id) === String(pendingWorkstreamNotification))?.name || "all"}
          onSearchChange={onSearchChange}
          members={availableMembers}
          searchQuery={searchQuery}
          canManageTasks={canManageTasks}
          canManageBuckets={canManageMembers}
          currentUserId={currentUserId}
          onStatusChange={onStatusChange}
          onOpenTask={onOpenTask}
          onDeleteTask={onDelete}
          onAddTask={() => {
            sessionStorage.setItem("workspace-new-task-scope", "operations");
            onAddTask();
          }}
          onTaskMove={onBucketChange}
          onBucketReorder={reorderBuckets}
          newBucketName={newBucketName}
          setNewBucketName={setNewBucketName}
          bucketSubmitting={bucketSubmitting}
          bucketError={bucketError}
          onCreateBucket={createBucket}
          newWorkstreamName={newWorkstreamName}
          setNewWorkstreamName={setNewWorkstreamName}
          workstreamSubmitting={workstreamSubmitting}
          workstreamError={workstreamError}
          onCreateWorkstream={createWorkstream}
          onArchiveWorkstream={archiveWorkstream}
          onArchiveBucket={archiveBucket}
          externalFilter={plannerFilter}
        />
      </section>
    );
  }

  if (active === "Planner") {
    const persistedBacklog = localData.buckets.find(
      (bucket) => bucket.name === "Backlog",
    );
    const configuredBuckets = [
      persistedBacklog || { id: "backlog", name: "Backlog" },
      ...localData.buckets.filter((bucket) => bucket.name !== "Backlog"),
    ];
    const configuredNames = new Set(
      configuredBuckets.map((bucket) => bucket.name),
    );
    const buckets = [
      ...configuredBuckets,
      ...[...new Set(tasks.map((task) => task.bucket || "Backlog"))]
        .filter((name) => !configuredNames.has(name))
        .map((name) => ({ id: `legacy-${name}`, name })),
    ];
    const availableMembers = localData.members.filter((member) => member.id);
    const saveView = async (event) => {
      event.preventDefault();
      const name = savedViewName.trim();
      if (!name) return;
      setBucketError("");
      try {
        const response = await fetch(
          `/api/workspaces/${workspaceId}/saved-views/`,
          {
            method: "POST",
            credentials: "include",
            headers: {
              "Content-Type": "application/json",
              "X-CSRFToken": await getCsrfToken(),
            },
            body: JSON.stringify({
              name,
              filter: plannerFilter,
              search: searchQuery,
              project_scope: plannerProjectFilter,
            }),
          },
        );
        const responseData = await readJsonResponse(
          response,
          "Saved view could not be created.",
        );
        if (!response.ok)
          return setBucketError(
            responseData.error || "Saved view could not be created.",
          );
        setSavedViews((current) => [
          ...current.filter((view) => view.name !== name),
          responseData.saved_view,
        ]);
        setSavedViewName("");
      } catch (error) {
        setBucketError(error.message || "Saved view could not be created.");
      }
    };
    const applyView = (event) => {
      const name = event.target.value;
      setSelectedSavedView(name);
      const view = savedViews.find((item) => item.name === name);
      if (view) {
        setPlannerFilter(view.filter);
        onSearchChange(view.search || "");
        setPlannerProjectFilter(view.project_scope || "all");
      }
    };
    const deleteSavedView = async () => {
      const view = savedViews.find((item) => item.name === selectedSavedView);
      if (
        !view ||
        !(await onConfirm(`Delete saved view "${view.name}"?`, {
          title: "Delete saved view",
          confirmLabel: "Delete view",
        }))
      )
        return;
      setBucketError("");
      try {
        const response = await fetch(
          `/api/workspaces/${workspaceId}/saved-views/${view.id}/`,
          {
            method: "DELETE",
            credentials: "include",
            headers: { "X-CSRFToken": await getCsrfToken() },
          },
        );
        if (!response.ok)
          return setBucketError("Saved view could not be deleted.");
        setSavedViews((current) =>
          current.filter((item) => item.id !== view.id),
        );
        setSelectedSavedView("");
      } catch (error) {
        setBucketError(error.message || "Saved view could not be deleted.");
      }
    };
    return (
      <section className="workspace-view planner-view-wrapper">
        <div className="planner-saved-views-bar">
          <AppSelect
            value={selectedSavedView}
            onChange={applyView}
            aria-label="Load saved Planner view"
          >
            <option value="">Saved views…</option>
            {savedViews.map((view) => (
              <option key={view.name} value={view.name}>
                {view.name}
              </option>
            ))}
          </AppSelect>
          <button
            type="button"
            className="secondary-button"
            onClick={deleteSavedView}
            disabled={!selectedSavedView}
          >
            Delete view
          </button>
          <form className="bucket-create-form" onSubmit={saveView}>
            <input
              value={savedViewName}
              onChange={(event) => setSavedViewName(event.target.value)}
              placeholder="Save current filter as…"
              aria-label="Saved view name"
              maxLength="100"
            />
            <button type="submit" className="secondary-button">
              Save view
            </button>
          </form>
        </div>
        <PlannerBoard
          buckets={buckets}
          tasks={tasks}
          projects={localData.projects}
          lookupValues={localData.lookupValues || []}
          projectFilter={plannerProjectFilter}
          scopeMode="projects"
          onProjectFilterChange={setPlannerProjectFilter}
          onSearchChange={onSearchChange}
          members={availableMembers}
          searchQuery={searchQuery}
          canManageTasks={canManageTasks}
          canManageBuckets={canManageMembers}
          currentUserId={currentUserId}
          onStatusChange={onStatusChange}
          onOpenTask={onOpenTask}
          onDeleteTask={onDelete}
          onAddTask={() => {
            const projectId =
              plannerProjectFilter && plannerProjectFilter !== "all"
                ? plannerProjectFilter
                : "";
            onAddTask(null, { projectId });
          }}
          onTaskMove={onBucketChange}
          onBucketReorder={reorderBuckets}
          newBucketName={newBucketName}
          setNewBucketName={setNewBucketName}
          bucketSubmitting={bucketSubmitting}
          bucketError={bucketError}
          onCreateBucket={createBucket}
          onArchiveBucket={archiveBucket}
          externalFilter={plannerFilter}
        />
      </section>
    );
  }

  if (active === "Reports") {
    const serverReport = data.reports || {
      total_tasks: 0,
      overdue_tasks: 0,
      due_this_week: 0,
      unassigned_tasks: 0,
      completion_rate: 0,
      blocked_tasks: 0,
      check_ins_today: 0,
      members: 0,
      status_counts: {},
      workload: [],
      time_clock: null,
    };
    const statusLabels = {
      todo: "To do",
      in_progress: "In progress",
      review: "Review",
      blocked: "Blocked",
      on_hold: "On hold",
      cancelled: "Cancelled",
      done: "Done",
    };
    // Task counts/status breakdown are recomputed client-side when a scope is picked, since the
    // server's report summary is workspace-wide. Team workload, check-ins, and the audit trail stay
    // server-provided in every scope - they're people/workspace history, not project-scoped concepts.
    const scopedTasks =
      reportsScope === "all"
        ? null
        : tasks.filter((task) => taskMatchesScope(task, reportsScope));
    const report = scopedTasks
      ? (() => {
          const openTasks = scopedTasks.filter(
            (task) => task.status !== "done",
          );
          const statusCounts = scopedTasks.reduce((counts, task) => {
            const key =
              task.status === "in progress" ? "in_progress" : task.status;
            counts[key] = (counts[key] || 0) + 1;
            return counts;
          }, {});
          const doneCount = statusCounts.done || 0;
          return {
            ...serverReport,
            total_tasks: scopedTasks.length,
            status_counts: statusCounts,
            completion_rate: scopedTasks.length
              ? Math.round((doneCount / scopedTasks.length) * 100)
              : 0,
            overdue_tasks: openTasks.filter(
              (task) => task.due_date && task.due_date < today,
            ).length,
            blocked_tasks: statusCounts.blocked || 0,
            unassigned_tasks: openTasks.filter((task) => !task.assignee_id)
              .length,
          };
        })()
      : serverReport;
    const openPlannerWithFilter = (filter) => {
      onSearchChange("");
      if (reportsScope !== "all" && reportsScope !== "operations")
        window.dispatchEvent(
          new CustomEvent("planner:project", { detail: reportsScope }),
        );
      window.dispatchEvent(
        new CustomEvent("planner:filter", { detail: filter }),
      );
      onNavigate(
        reportsScope === "operations" ? "Daily operations" : "Planner",
      );
    };
    const checkInRate = report.members
      ? Math.round((report.check_ins_today / report.members) * 100)
      : 0;
    const timeClock = report.time_clock || {
      total_seconds: 0,
      break_seconds: 0,
      average_seconds: 0,
      shift_count: 0,
      open_shifts: 0,
      by_member: [],
      recent: [],
      recent_pagination: null,
    };
    const shiftPagination = timeClock.recent_pagination;
    const memberName = (member) =>
      [member.first_name, member.last_name].filter(Boolean).join(" ") ||
      member.email;
    return (
      <section className="workspace-view">
        <WorkspaceViewHeading title="Reports" subtitle={subtitle} />
        <div className="report-toolbar">
          <WorkScopeSelector
            compact
            value={reportsScope}
            onChange={setReportsScope}
            projects={localData.projects}
            label="Scope"
          />
          <label>
            Reporting period
            <AppSelect
              value={reportRange}
              onChange={(event) => {
                setReportRange(event.target.value);
                setShiftLogPage(1);
              }}
            >
              <option value="all">All time</option>
              <option value="week">Last 7 days</option>
              <option value="month">This month</option>
              <option value="quarter">This quarter</option>
              <option value="year">This year</option>
            </AppSelect>
          </label>
          <button
            type="button"
            className="secondary-button"
            onClick={onRefresh}
          >
            Refresh reports
          </button>
          <span className="report-updated">
            {reportLastUpdated
              ? `Updated ${formatCalendarDate(reportLastUpdated, { timeStyle: "short" })}`
              : "Loading report data…"}
          </span>
        </div>
        <div className="report-metrics">
          <button
            type="button"
            className="report-stat report-stat-button"
            onClick={() => onNavigate("Planner")}
          >
            <span>Total tasks</span>
            <strong>{report.total_tasks}</strong>
            <em>{report.completion_rate}% complete</em>
          </button>
          <button
            type="button"
            className="report-stat report-stat-button is-warning"
            onClick={() => openPlannerWithFilter("overdue")}
          >
            <span>Overdue</span>
            <strong>{report.overdue_tasks}</strong>
            <em>Needs attention</em>
          </button>
          <button
            type="button"
            className="report-stat report-stat-button is-danger"
            onClick={() => openPlannerWithFilter("blocked")}
          >
            <span>Blocked</span>
            <strong>{report.blocked_tasks}</strong>
            <em>{report.unassigned_tasks} unassigned open</em>
          </button>
          <Card className="report-stat">
            <span>Check-ins today</span>
            <strong>{checkInRate}%</strong>
            <em>
              {report.check_ins_today} of {report.members} members
            </em>
          </Card>
        </div>
        <div className="report-grid">
          <Card className="report-panel">
            <div className="drawer-section-heading">
              <h3>Task status</h3>
              <span>{report.total_tasks} total</span>
            </div>
            {Object.entries(statusLabels).map(([key, label]) => {
              const count = report.status_counts[key] || 0;
              const percentage = report.total_tasks
                ? Math.round((count / report.total_tasks) * 100)
                : 0;
              return (
                <button
                  type="button"
                  className="report-bar-row report-bar-button"
                  key={key}
                  onClick={() =>
                    openPlannerWithFilter(
                      key === "in_progress" ? "in progress" : key,
                    )
                  }
                >
                  <span>{label}</span>
                  <div>
                    <i style={{ width: `${percentage}%` }} />
                  </div>
                  <strong>{count}</strong>
                  <small>{percentage}%</small>
                </button>
              );
            })}
          </Card>
          <Card className="report-panel">
            <div className="drawer-section-heading">
              <h3>Team workload</h3>
              <span>{report.members} members</span>
            </div>
            {report.workload.length ? (
              report.workload.map((member) => (
                <div className="report-member-row" key={member.user_id}>
                  <span>{member.user_name}</span>
                  <strong>{member.open} open</strong>
                  <em>{member.blocked} blocked</em>
                </div>
              ))
            ) : (
              <EmptyState text="No team workload yet." />
            )}
          </Card>
        </div>
        <div className="report-grid report-risk-grid">
          <Card className="report-panel">
            <div className="drawer-section-heading">
              <h3>Delivery risks</h3>
              <span>Open work</span>
            </div>
            <div className="report-risk-list">
              <button
                type="button"
                onClick={() => openPlannerWithFilter("overdue")}
              >
                <strong>{report.overdue_tasks}</strong>
                <span>Overdue tasks</span>
              </button>
              <button type="button" onClick={() => onNavigate("Calendar")}>
                <strong>{report.due_this_week}</strong>
                <span>Due this week</span>
              </button>
              <button
                type="button"
                onClick={() => openPlannerWithFilter("unassigned")}
              >
                <strong>{report.unassigned_tasks}</strong>
                <span>Unassigned tasks</span>
              </button>
            </div>
          </Card>
          <Card className="report-panel">
            <div className="drawer-section-heading">
              <h3>Report guidance</h3>
              <span>Next actions</span>
            </div>
            <p className="report-guidance">
              Use the period filter to compare recent delivery. Open blocked or
              overdue counts to resolve the underlying tasks, then use Planner
              to rebalance ownership.
            </p>
          </Card>
        </div>
        <Card className="report-panel time-clock-panel">
          <div className="drawer-section-heading">
            <h3>Time clock</h3>
            <span>
              {timeClock.shift_count}{" "}
              {timeClock.shift_count === 1 ? "shift" : "shifts"} logged
            </span>
          </div>
          <div className="time-clock-totals">
            <div>
              <strong>{formatHoursLabel(timeClock.total_seconds)}</strong>
              <span>Hours worked</span>
            </div>
            <div>
              <strong>{formatHoursLabel(timeClock.break_seconds)}</strong>
              <span>Break time</span>
            </div>
            <div>
              <strong>{formatHoursLabel(timeClock.average_seconds)}</strong>
              <span>Average shift</span>
            </div>
            <div>
              <strong>{timeClock.open_shifts}</strong>
              <span>Clocked in now</span>
            </div>
          </div>
          {timeClock.by_member.length ? (
            <div className="time-clock-members">
              {timeClock.by_member.map((member) => (
                <div className="report-member-row" key={member.user_id}>
                  <span>{member.user_name}</span>
                  <strong>{formatHoursLabel(member.worked_seconds)}</strong>
                  <em>
                    {member.day_count} {member.day_count === 1 ? "day" : "days"}{" "}
                    · {formatHoursLabel(member.break_seconds)} break
                  </em>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState text="No time has been clocked in this period." />
          )}
          <div className="time-clock-log">
            <div className="drawer-section-heading">
              <h3>Recent entries</h3>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: ".5rem",
                  fontSize: "11px",
                  fontWeight: 700,
                }}
              >
                Team member
                <AppSelect
                  value={shiftLogUserId}
                  onChange={(event) => {
                    setShiftLogUserId(event.target.value);
                    setShiftLogPage(1);
                  }}
                >
                  <option value="">Everyone</option>
                  {(data.members || []).map((member) => (
                    <option key={member.id} value={member.id}>
                      {memberName(member)}
                    </option>
                  ))}
                </AppSelect>
              </label>
            </div>
            {timeClock.recent.length ? (
              timeClock.recent.map((shift) => (
                <div className="time-clock-row" key={shift.id}>
                  <span
                    className={`clock-state clock-state-${shift.is_open ? (shift.is_on_break ? "break" : "active") : "idle"}`}
                  >
                    {shift.is_open
                      ? shift.is_on_break
                        ? "Break"
                        : "Active"
                      : "Done"}
                  </span>
                  <div>
                    <strong>{shift.user_name}</strong>
                    <span>
                      {shift.date} · {formatShiftClock(shift.started_at)}
                      {shift.ended_at
                        ? ` - ${formatShiftClock(shift.ended_at)}`
                        : " - now"}
                    </span>
                  </div>
                  <em>
                    {formatHoursLabel(shift.worked_seconds)}
                    {shift.break_seconds_total
                      ? ` · ${formatHoursLabel(shift.break_seconds_total)} break`
                      : ""}
                  </em>
                </div>
              ))
            ) : (
              <EmptyState
                text={
                  shiftLogUserId
                    ? "No shifts for this team member in this period."
                    : "No time has been clocked in this period."
                }
              />
            )}
            {shiftPagination &&
              shiftPagination.total_count > shiftPagination.page_size && (
                <div className="activity-pagination">
                  <span>{`${(shiftPagination.page - 1) * shiftPagination.page_size + 1}-${Math.min(shiftPagination.page * shiftPagination.page_size, shiftPagination.total_count)} of ${shiftPagination.total_count}`}</span>
                  <div>
                    <button
                      type="button"
                      disabled={shiftPagination.page === 1}
                      onClick={() =>
                        setShiftLogPage((current) => Math.max(1, current - 1))
                      }
                      aria-label="Previous page"
                    >
                      <ChevronLeft size={15} />
                    </button>
                    <span>
                      Page {shiftPagination.page} of{" "}
                      {shiftPagination.total_pages}
                    </span>
                    <button
                      type="button"
                      disabled={
                        shiftPagination.page === shiftPagination.total_pages
                      }
                      onClick={() => setShiftLogPage((current) => current + 1)}
                      aria-label="Next page"
                    >
                      <ChevronRight size={15} />
                    </button>
                  </div>
                </div>
              )}
          </div>
        </Card>
        <Card className="report-panel audit-panel">
          <div className="drawer-section-heading">
            <h3>Audit trail</h3>
            <span>Latest 12 events</span>
          </div>
          {data.auditLogs?.length ? (
            data.auditLogs.slice(0, 12).map((log) => (
              <div className="audit-row" key={log.id}>
                <span className="audit-action">
                  {log.action.replaceAll("_", " ")}
                </span>
                <div>
                  <strong>{log.actor_name}</strong>
                  <span>
                    {log.target_type}
                    {log.target_id ? ` #${log.target_id}` : ""}
                  </span>
                </div>
                <time dateTime={log.created_at}>
                  {formatCalendarDate(new Date(log.created_at), {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </time>
              </div>
            ))
          ) : (
            <EmptyState text="No audit events recorded yet." />
          )}
        </Card>
      </section>
    );
  }
  if (active === "Activity") {
    const activityKinds = [
      ...new Set(data.activity.map((event) => event.kind).filter(Boolean)),
    ].sort();
    const activityActors = [
      ...new Set(
        data.activity.map((event) => event.actor_name).filter(Boolean),
      ),
    ].sort();
    const visibleActivity = data.activity.filter(
      (event) =>
        (activityActor === "all" || event.actor_name === activityActor) &&
        (activityKind === "all" || event.kind === activityKind) &&
        (!activitySearch.trim() ||
          `${event.actor_name} ${event.message} ${event.kind}`
            .toLowerCase()
            .includes(activitySearch.trim().toLowerCase())),
    );
    const activityPageSize = 40;
    const activityTotalPages = Math.max(
      1,
      Math.ceil(visibleActivity.length / activityPageSize),
    );
    const activityPageSafe = Math.min(activityPage, activityTotalPages);
    const activityStart = (activityPageSafe - 1) * activityPageSize;
    const pagedActivity = visibleActivity.slice(
      activityStart,
      activityStart + activityPageSize,
    );
    const groupedActivity = pagedActivity.reduce((groups, event) => {
      const key = toDateKey(event.created_at);
      (groups[key] ||= []).push(event);
      return groups;
    }, {});
    const activityDateLabel = (key) => {
      const date = new Date(`${key}T12:00:00`);
      const todayKey = toDateKey(new Date());
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayKey = toDateKey(yesterday);
      return key === todayKey
        ? "Today"
        : key === yesterdayKey
          ? "Yesterday"
          : date.toLocaleDateString([], {
              weekday: "long",
              month: "long",
              day: "numeric",
              year: "numeric",
            });
    };
    return (
      <section className="workspace-view">
        <WorkspaceViewHeading
          title="Activity"
          subtitle="A complete recent history of workspace changes."
        />
        <div className="activity-toolbar">
          <label className="activity-search">
            <Search size={15} />
            <input
              value={activitySearch}
              onChange={(event) => setActivitySearch(event.target.value)}
              placeholder="Search activity"
              aria-label="Search activity"
            />
          </label>
          <label>
            Person
            <AppSelect
              value={activityActor}
              onChange={(event) => setActivityActor(event.target.value)}
            >
              <option value="all">Everyone</option>
              {activityActors.map((actor) => (
                <option key={actor} value={actor}>
                  {actor}
                </option>
              ))}
            </AppSelect>
          </label>
          <label>
            Type
            <AppSelect
              value={activityKind}
              onChange={(event) => setActivityKind(event.target.value)}
            >
              <option value="all">All activity</option>
              {activityKinds.map((kind) => (
                <option key={kind} value={kind}>
                  {kind.replaceAll("_", " ")}
                </option>
              ))}
            </AppSelect>
          </label>
          <button
            type="button"
            className="secondary-button"
            onClick={onRefresh}
          >
            Refresh
          </button>
          <span className="activity-count">
            {visibleActivity.length
              ? `${activityStart + 1}-${activityStart + pagedActivity.length} of ${visibleActivity.length}`
              : "0"}{" "}
            events
          </span>
        </div>
        <Card className="activity-history">
          {visibleActivity.length ? (
            Object.entries(groupedActivity).map(([date, events]) => (
              <div className="activity-day" key={date}>
                <h3>{activityDateLabel(date)}</h3>
                <div className="activity-list">
                  {events.map((event) => (
                    <Activity
                      key={`activity-history-${event.id}`}
                      avatar={event.actor_name.slice(0, 2).toUpperCase()}
                      color="blue"
                      kind={event.kind}
                      text={event.actor_name}
                      strong={event.message}
                      suffix=""
                      time={formatRelativeActivityTime(event.created_at)}
                    />
                  ))}
                </div>
              </div>
            ))
          ) : (
            <EmptyState
              text={
                data.activity.length
                  ? "No activity matches these filters."
                  : "No workspace activity yet."
              }
            />
          )}
        </Card>
        {visibleActivity.length > activityPageSize && (
          <div className="activity-pagination">
            <span>{`${activityStart + 1}-${activityStart + pagedActivity.length} of ${visibleActivity.length}`}</span>
            <div>
              <button
                type="button"
                disabled={activityPageSafe === 1}
                onClick={() =>
                  setActivityPage((current) => Math.max(1, current - 1))
                }
                aria-label="Previous page"
              >
                <ChevronLeft size={15} />
              </button>
              <span>
                Page {activityPageSafe} of {activityTotalPages}
              </span>
              <button
                type="button"
                disabled={activityPageSafe === activityTotalPages}
                onClick={() => setActivityPage((current) => current + 1)}
                aria-label="Next page"
              >
                <ChevronRight size={15} />
              </button>
            </div>
          </div>
        )}
      </section>
    );
  }

  if (active === "Settings") {
    return (
      <SettingsView
        theme={theme}
        onSetTheme={onSetTheme || onToggleTheme}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={onToggleSidebar}
        currentWorkspace={currentWorkspace}
        currentUserName={currentUserName}
        currentUserEmail={currentUserEmail}
        currentUserId={currentUserId}
        currentUserAvatarUrl={currentUserAvatarUrl}
        currentUserPresence={currentUserPresence}
        currentUserCompany={currentUserCompany}
        currentUserJobRole={currentUserJobRole}
        onProfileUpdated={onProfileUpdated}
        canManageMembers={canManageMembers}
        members={localData.members}
        notifications={localData.notifications}
        workspaceId={workspaceId}
        workspaces={currentUserWorkspaces}
        defaultWorkspaceId={defaultWorkspaceId}
        onSetDefaultWorkspace={onSetDefaultWorkspace}
        taskTemplates={localData.taskTemplates || []}
        projectTemplates={localData.projectTemplates || []}
        projects={localData.projects}
        onRefresh={onRefresh}
      />
    );
  }
  if (active === "Notifications") {
    const pagination = notificationPagination;
    return (
      <section className="workspace-view">
        <WorkspaceViewHeading
          title="Notifications"
          subtitle="Your workspace notification history."
          action="Mark all read"
          onAction={async () => {
            await onMarkNotificationsRead();
            setNotificationHistory((current) =>
              current.map((notification) => ({ ...notification, read: true })),
            );
          }}
        />
        <Card className="activity-history">
          {notificationLoading ? (
            <p className="p-4 text-sm text-text-muted">Loading notifications...</p>
          ) : notificationError ? (
            <div className="workspace-status error" role="alert">
              <span>{notificationError}</span>
              <button className="secondary-button" onClick={() => setNotificationReload((current) => current + 1)}>
                Retry
              </button>
            </div>
          ) : notificationHistory.length ? (
            <div className="divide-y divide-border-light">
              {notificationHistory.map((notification) => (
                <button
                  type="button"
                  key={notification.id}
                  onClick={() => onOpenNotification(notification)}
                  className="flex w-full flex-col items-start gap-1 px-4 py-3 text-left hover:bg-surface-secondary"
                >
                  <span className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                    {notification.title}
                    <span className="text-xs font-normal text-text-muted">{notification.read ? "Read" : "Unread"}</span>
                  </span>
                  <span className="text-xs text-text-muted">{notification.body || "Workspace update"}</span>
                  <span className="text-xs text-text-muted">{formatRelativeActivityTime(notification.created_at)}</span>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState text="No notifications yet. Updates from your teammates land here, and your own check-ins and actions are listed under Activity." />
          )}
        </Card>
        {pagination && pagination.total_pages > 1 && (
          <div className="activity-pagination">
            <span>{`${(pagination.page - 1) * pagination.page_size + 1}-${Math.min(pagination.page * pagination.page_size, pagination.total_items)} of ${pagination.total_items}`}</span>
            <div>
              <button type="button" disabled={!pagination.has_previous} onClick={() => setNotificationPage((current) => Math.max(1, current - 1))} aria-label="Previous notifications page">
                <ChevronLeft size={15} />
              </button>
              <span>Page {pagination.page} of {pagination.total_pages}</span>
              <button type="button" disabled={!pagination.has_next} onClick={() => setNotificationPage((current) => current + 1)} aria-label="Next notifications page">
                <ChevronRight size={15} />
              </button>
            </div>
          </div>
        )}
      </section>
    );
  }
  if (active === "Screen sharing") {
    return (
      <Suspense fallback={null}>
        <ScreenSharingView
          workspaceId={workspaceId}
          members={localData.members}
          currentUserId={currentUserId}
          role={currentWorkspace?.role}
          targetSessionId={screenShareNotificationId}
        />
      </Suspense>
    );
  }
  if (active === "Import data") return null;
  if (active === "Help") return <HelpView onNavigate={onNavigate} />;
  if (active === "Legal") return <LegalView />;

  if (active === "Calendar") {
    const visibleCalendarEvents = localData.events.filter(
      (event) =>
        calendarFilter === "all" || event.event_type === calendarFilter,
    );
    const calendarVisibleTasks = tasks.filter(
      (task) =>
        task.due_date &&
        task.state !== "archived" &&
        (calendarTaskScope === "all" ||
          (calendarTaskScope === "operations"
            ? !task.project_id
            : String(task.project_id) === String(calendarTaskScope))),
    );
    const upcomingTaskDeadlines = calendarVisibleTasks
      .filter((task) => task.due_date >= today)
      .sort((a, b) => a.due_date.localeCompare(b.due_date))
      .slice(0, 8);
    const upcomingVisibleEvents = visibleCalendarEvents
      .filter((event) => new Date(event.start_at) >= new Date())
      .sort((a, b) => new Date(a.start_at) - new Date(b.start_at))
      .slice(0, 8);
    const agendaStart = new Date(calendarDate);
    agendaStart.setHours(0, 0, 0, 0);
    const agendaEvents = visibleCalendarEvents
      .filter(
        (event) => new Date(event.end_at || event.start_at) >= agendaStart,
      )
      .sort((a, b) => new Date(a.start_at) - new Date(b.start_at));
    const timeGridDays = calendarView === "day" ? [calendarDate] : calendarDays;
    const timeGrid = (
      <div
        className="calendar-time-grid"
        style={{ "--calendar-day-count": timeGridDays.length }}
      >
        <div className="calendar-time-corner" />
        {timeGridDays.map((day) => (
          <div
            className={`calendar-time-day${toDateKey(day) === today ? " is-today" : ""}`}
            key={`head-${day.toISOString()}`}
          >
            {formatCalendarDate(day, { weekday: "short", day: "numeric" })}
          </div>
        ))}
        {Array.from({ length: 24 }, (_, hour) => (
          <React.Fragment key={`hour-${hour}`}>
            <div className="calendar-time-label">
              {formatCalendarDate(new Date(2020, 0, 1, hour), {
                hour: "numeric",
              })}
            </div>
            {timeGridDays.map((day) => (
              <div
                className="calendar-time-slot"
                key={`${day.toISOString()}-${hour}`}
                onDoubleClick={() => {
                  setCalendarDate(new Date(day));
                  openComposer("calendar");
                }}
              >
                {visibleCalendarEvents
                  .filter((event) => {
                    const start = new Date(event.start_at);
                    return (
                      toDateKey(start) === toDateKey(day) &&
                      start.getHours() === hour
                    );
                  })
                  .map((event) => (
                    <button
                      type="button"
                      className={`event-pill event-type-${event.event_type || "meeting"}`}
                      key={event.id}
                      onClick={() => setSelectedEvent(event)}
                    >
                      <span>
                        {formatCalendarDate(new Date(event.start_at), {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </span>
                      {event.title}
                    </button>
                  ))}
              </div>
            ))}
          </React.Fragment>
        ))}
      </div>
    );
    return (
      <section className="workspace-view">
        <WorkspaceViewHeading
          title={title}
          subtitle="Plan meetings, focus time, deadlines, and reminders in one place."
          action="Add event"
          onAction={() => openComposer("calendar")}
        />
        <div className="calendar-layout">
          <Card
            className={`calendar-week calendar-view-${calendarView} gap-0 py-0 overflow-hidden`}
          >
            <CardHeader className="calendar-toolbar items-center flex-wrap gap-3 px-5 py-4 border-b border-border">
              <div className="calendar-toolbar-title flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => shiftCalendar(-1)}
                  aria-label="Previous period"
                >
                  <ChevronLeft size={16} />
                </Button>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      className="px-2.5 text-sm font-extrabold text-foreground hover:bg-muted"
                    >
                      {calendarHeading}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <DatePicker
                      mode="single"
                      selected={calendarDate}
                      defaultMonth={calendarDate}
                      onSelect={(date) => date && setCalendarDate(date)}
                    />
                  </PopoverContent>
                </Popover>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => shiftCalendar(1)}
                  aria-label="Next period"
                >
                  <ChevronRight size={16} />
                </Button>
              </div>
              <div className="calendar-toolbar-actions flex items-center gap-2 flex-wrap">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setCalendarDate(new Date())}
                >
                  Today
                </Button>
                <Tabs value={calendarView} onValueChange={setCalendarView}>
                  <TabsList aria-label="Calendar view">
                    {["day", "week", "month", "year", "agenda"].map((view) => (
                      <TabsTrigger key={view} value={view}>
                        {view[0].toUpperCase() + view.slice(1)}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </Tabs>
              </div>
              <div className="calendar-filter-row">
                <label>
                  Show
                  <AppSelect
                    value={calendarFilter}
                    onChange={(event) => setCalendarFilter(event.target.value)}
                    aria-label="Filter calendar events"
                  >
                    <option value="all">All events</option>
                    <option value="meeting">Meetings</option>
                    <option value="focus">Focus time</option>
                    <option value="deadline">Deadlines</option>
                    <option value="reminder">Reminders</option>
                  </AppSelect>
                </label>
                <label>
                  Work
                  <AppSelect
                    value={calendarTaskScope}
                    onChange={(event) =>
                      setCalendarTaskScope(event.target.value)
                    }
                    aria-label="Filter task deadlines"
                  >
                    <option value="all">All work</option>
                    <option value="operations">Operations</option>
                    {localData.projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </AppSelect>
                </label>
                {(calendarFilter !== "all" || calendarTaskScope !== "all") && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setCalendarFilter("all");
                      setCalendarTaskScope("all");
                    }}
                  >
                    Clear filters
                  </Button>
                )}
              </div>
              <div
                className="calendar-summary-badges"
                aria-label="Calendar summary"
              >
                <span className="calendar-summary-badge">
                  {visibleCalendarEvents.length} events
                </span>
                <span className="calendar-summary-badge">
                  {
                    visibleCalendarEvents.filter(
                      (event) => event.event_type === "meeting",
                    ).length
                  }{" "}
                  meetings
                </span>
                <span className="calendar-summary-badge">
                  {
                    visibleCalendarEvents.filter(
                      (event) => event.event_type === "deadline",
                    ).length
                  }{" "}
                  deadlines
                </span>
                <span className="calendar-summary-badge">
                  {upcomingTaskDeadlines.length} task deadlines
                </span>
              </div>
            </CardHeader>
            <CardContent
              className={
                calendarView === "agenda"
                  ? "calendar-agenda px-5"
                  : calendarView === "day" || calendarView === "week"
                    ? "calendar-time-content px-0"
                    : "calendar-grid px-0"
              }
            >
              {calendarView === "agenda" ? (
                agendaEvents.length ? (
                  agendaEvents.map((event) => (
                    <button
                      type="button"
                      className={`agenda-event-row event-type-${event.event_type || "meeting"}`}
                      key={event.id}
                      onClick={() => setSelectedEvent(event)}
                    >
                      <time>
                        <strong>
                          {formatCalendarDate(new Date(event.start_at), {
                            weekday: "short",
                            month: "short",
                            day: "numeric",
                          })}
                        </strong>
                        <span>
                          {formatCalendarDate(new Date(event.start_at), {
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </span>
                      </time>
                      <div>
                        <strong>{event.title}</strong>
                        <span>
                          {event.event_type || "Event"} ·{" "}
                          {formatCalendarDate(
                            new Date(event.end_at || event.start_at),
                            { hour: "numeric", minute: "2-digit" },
                          )}
                        </span>
                      </div>
                      <ArrowUpRight size={15} />
                    </button>
                  ))
                ) : (
                  <EmptyState text="No upcoming events match this filter." />
                )
              ) : calendarView === "day" || calendarView === "week" ? (
                timeGrid
              ) : (
                calendarDays.map((day) => (
                  <div
                    className={`calendar-day${toDateKey(day) === today ? " is-today" : ""}`}
                    key={day.toISOString()}
                  >
                    <strong>
                      {calendarView === "year"
                        ? formatCalendarDate(day, { month: "short" })
                        : formatCalendarDate(day, {
                            weekday: "short",
                            day: "numeric",
                          })}
                      {toDateKey(day) === today && (
                        <Badge variant="accent" className="today-badge">
                          Today
                        </Badge>
                      )}
                    </strong>
                    <div className="calendar-slot">
                      {calendarEventsForDay(day)
                        .filter(
                          (event) =>
                            calendarFilter === "all" ||
                            event.event_type === calendarFilter,
                        )
                        .map((event) => (
                          <button
                            type="button"
                            className={`event-pill event-type-${event.event_type || "meeting"}`}
                            key={event.id}
                            onClick={() => setSelectedEvent(event)}
                            aria-label={`View ${event.title}`}
                          >
                            <span>
                              {formatCalendarDate(
                                new Date(event.start_at),
                                calendarView === "year"
                                  ? { month: "short", day: "numeric" }
                                  : { hour: "numeric", minute: "2-digit" },
                              )}
                            </span>
                            <span className="event-pill-title">
                              {event.title}
                            </span>
                          </button>
                        ))}
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
          <Card className="workspace-side-card py-5 gap-4">
            <div className="calendar-side-heading">
              <h3>Upcoming</h3>
              <span className="calendar-export-links">
                <a
                  className="calendar-export"
                  href={`/api/workspaces/${workspaceId}/calendar.ics`}
                  download
                >
                  Export ICS
                </a>
                <button
                  type="button"
                  className="calendar-export"
                  onClick={() => onNavigate("Settings")}
                  title="Get a live subscribe link for Outlook or Google Calendar in Settings > Integrations"
                >
                  Subscribe
                </button>
              </span>
            </div>
            {upcomingVisibleEvents.length ? (
              upcomingVisibleEvents.map((event) => (
                <div
                  className={`compact-row event-type-row-${event.event_type || "meeting"}`}
                  key={event.id}
                >
                  <CalendarDays size={15} />
                  <div>
                    <strong>{event.title}</strong>
                    <span>
                      {formatCalendarDate(new Date(event.start_at), {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}{" "}
                      · {event.event_type || "event"}
                    </span>
                    <a
                      className="calendar-google-link"
                      href={googleCalendarUrl(event)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Add to Google Calendar
                    </a>
                  </div>
                  <button
                    type="button"
                    className="inline-edit"
                    onClick={() => setSelectedEvent(event)}
                    aria-label={`View ${event.title}`}
                  >
                    View
                  </button>
                  {(canManageMembers || event.created_by === currentUserId) && (
                    <button
                      type="button"
                      className="inline-delete"
                      onClick={() => deleteCalendarEvent(event.id)}
                      aria-label={`Delete ${event.title}`}
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              ))
            ) : (
              <EmptyState text="No upcoming events match this filter." />
            )}
            <div className="calendar-side-section">
              <div className="calendar-side-heading">
                <h3>Task deadlines</h3>
                <span>{upcomingTaskDeadlines.length}</span>
              </div>
              {upcomingTaskDeadlines.length ? (
                upcomingTaskDeadlines.map((task) => (
                  <button
                    type="button"
                    className="calendar-task-deadline"
                    key={`calendar-task-${task.id}`}
                    onClick={() => onOpenTask(task)}
                  >
                    <CalendarDays size={15} />
                    <span>
                      <strong>{task.title}</strong>
                      <small>
                        {task.due_date}
                        {task.tag && task.tag !== "General"
                          ? ` · ${task.tag}`
                          : ""}
                      </small>
                    </span>
                  </button>
                ))
              ) : (
                <EmptyState text="No upcoming task deadlines." />
              )}
            </div>
          </Card>
        </div>
        {composerOpen && (
          <WorkspaceComposer
            type="calendar"
            form={form}
            setForm={setForm}
            error={composerError}
            submitting={submitting}
            onClose={() => setComposerOpen(false)}
            onSubmit={submitComposer}
          />
        )}
        {selectedEvent && (
          <CalendarEventEditDialog
            event={selectedEvent}
            workspaceId={workspaceId}
            canEdit={
              canManageMembers || selectedEvent.created_by === currentUserId
            }
            onClose={() => setSelectedEvent(null)}
            onUpdated={(updatedEvent) => {
              setLocalData((current) => ({
                ...current,
                events: current.events.map((item) =>
                  item.id === updatedEvent.id ? updatedEvent : item,
                ),
              }));
              onRefresh();
              setSelectedEvent(null);
            }}
          />
        )}
      </section>
    );
  }

  if (active === "Check-ins") {
    return (
      <section className="workspace-view">
        <WorkspaceViewHeading
          title={title}
          subtitle={subtitle}
          action="Start check-in"
          onAction={() => openComposer("checkin")}
        />
        <div className="checkin-toolbar">
          <DateField
            label="View date"
            value={checkInDate}
            onChange={(event) => setCheckInDate(event.target.value)}
          />
          <span>
            {checkInDate === today ? "Today" : "Updates for " + checkInDate}
          </span>
        </div>
        {checkInLoading && (
          <p className="workspace-inline-status" role="status">
            Loading check-ins...
          </p>
        )}
        {checkInError && (
          <p className="auth-error" role="alert">
            {checkInError}
          </p>
        )}
        <div className="checkin-grid">
          {localData.checkIns.length ? (
            localData.checkIns.map((checkIn) => (
              <Card className="px-5" key={checkIn.id}>
                <div className="card-person">
                  <span className="avatar blue small">
                    {checkIn.user_initials}
                  </span>
                  <div>
                    <strong>{checkIn.user_name}</strong>
                    <span>{checkIn.date}</span>
                  </div>
                  {checkIn.user_id === currentUserId && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="ml-auto"
                      onClick={() => setSelectedCheckIn(checkIn)}
                      aria-label={`Edit ${checkIn.user_name}'s check-in`}
                    >
                      <MoreHorizontal size={14} />
                    </Button>
                  )}
                </div>
                <p>
                  <b>Completed</b> {checkIn.completed || "No update yet"}
                </p>
                <p>
                  <b>Next</b> {checkIn.next_steps || "No next step recorded"}
                </p>
                <p>
                  <b>Blockers</b> {checkIn.blockers || "None reported"}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedCheckInDetail(checkIn)}
                >
                  View details
                </Button>
              </Card>
            ))
          ) : (
            <EmptyState
              text={`No check-ins for ${checkInDate === today ? "today" : checkInDate}. Start the first update.`}
            />
          )}
        </div>
        {composerOpen && (
          <WorkspaceComposer
            type="checkin"
            form={form}
            setForm={setForm}
            error={composerError}
            submitting={submitting}
            onClose={() => setComposerOpen(false)}
            onSubmit={submitComposer}
          />
        )}
        {selectedCheckIn && (
          <CheckInEditDialog
            checkIn={selectedCheckIn}
            workspaceId={workspaceId}
            onClose={() => setSelectedCheckIn(null)}
            onUpdated={(updatedCheckIn) => {
              setLocalData((current) => ({
                ...current,
                checkIns: current.checkIns.map((item) =>
                  item.id === updatedCheckIn.id ? updatedCheckIn : item,
                ),
              }));
              onRefresh();
              setSelectedCheckIn(null);
            }}
          />
        )}
        {selectedCheckInDetail && (
          <CheckInDetailDialog
            checkIn={selectedCheckInDetail}
            workspaceId={workspaceId}
            members={localData.members}
            currentUserId={currentUserId}
            canComment={canCommentCheckIns}
            canEdit={selectedCheckInDetail.user_id === currentUserId}
            onClose={() => setSelectedCheckInDetail(null)}
            onEdit={() => {
              setSelectedCheckInDetail(null);
              setSelectedCheckIn(selectedCheckInDetail);
            }}
          />
        )}
      </section>
    );
  }

  if (active === "Projects") {
    // The project list arrives with the server's own health and task counts.
    // This used to be worked out here instead, from a fixed seven day due-soon
    // window and with no notion of on-hold or cancelled tasks, while the reports
    // screen used the workspace settings. The same project could read at-risk on
    // one screen and on-track on another. The counts are still named the way the
    // card below reads them.
    //
    // The fallback covers the projects that reach this list from a single
    // project response (create, edit) in the moment before the list is refetched,
    // since that response carries no metrics. A project with no tasks and no due
    // date is on track, and a completed one is completed, so the fallback is not
    // a guess for those cases.
    const withStats = localData.projects.map((project) => {
      const metrics = project.metrics || {};
      return {
        ...project,
        health:
          project.health ||
          (project.status === "completed" ? "completed" : "on-track"),
        taskCount: metrics.total_tasks ?? 0,
        completed: metrics.completed_tasks ?? 0,
        blocked: metrics.blocked_tasks ?? 0,
        overdue: metrics.overdue_tasks ?? 0,
        completion: metrics.completion_rate ?? 0,
      };
    });
    const visibleProjects = withStats
      .filter(
        (project) =>
          (!projectQuery.trim() ||
            `${project.name} ${project.description}`
              .toLowerCase()
              .includes(projectQuery.trim().toLowerCase())) &&
          (projectStatusFilter === "all" ||
            project.status === projectStatusFilter) &&
          (projectHealthFilter === "all" ||
            project.health === projectHealthFilter),
      )
      .sort((a, b) =>
        projectSort === "name"
          ? a.name.localeCompare(b.name)
          : projectSort === "progress"
            ? b.completion - a.completion
            : projectSort === "updated"
              ? new Date(b.updated_at || 0) - new Date(a.updated_at || 0)
              : (a.due_date || "9999-12-31").localeCompare(
                  b.due_date || "9999-12-31",
                ),
      );
    const summary = {
      active: withStats.filter((project) => project.status === "active").length,
      risk: withStats.filter((project) =>
        ["at-risk", "off-track"].includes(project.health),
      ).length,
      overdue: withStats.filter(
        (project) =>
          project.status !== "completed" &&
          project.due_date &&
          project.due_date < today,
      ).length,
      completed: withStats.filter((project) => project.status === "completed")
        .length,
    };
    if (selectedProjectWorkspace) {
      const openOperation = (operation) => {
        setProjectOperation(operation);
        window.history.replaceState(
          null,
          "",
          `#project/${selectedProjectWorkspace.id}/${operation}`,
        );
      };
      const closeProject = () => {
        setProjectOperation("");
        setSelectedProjectWorkspace(null);
        window.history.replaceState(null, "", window.location.pathname);
      };
      const operationTitle = {
        budget: "Budget & costs",
        resources: "Resources",
        risks: "Risks & issues",
      }[projectOperation];
      return (
        <section className="workspace-view project-detail-view">
          <button
            type="button"
            className="text-button project-back-button"
            onClick={
              projectOperation ? () => setProjectOperation("") : closeProject
            }
          >
            ←{" "}
            {projectOperation ? "Back to project overview" : "Back to projects"}
          </button>
          <WorkspaceViewHeading
            title={
              projectOperation
                ? `${selectedProjectWorkspace.name}: ${operationTitle}`
                : selectedProjectWorkspace.name
            }
            subtitle={
              projectOperation
                ? "Detailed project operational controls."
                : selectedProjectWorkspace.description ||
                  "Project workspace and delivery controls."
            }
            action={canManageMembers ? "Edit project" : undefined}
            onAction={() => setSelectedProject(selectedProjectWorkspace)}
          />
          {!projectOperation && (
            <>
              <div className="project-detail-links">
                <button
                  type="button"
                  onClick={() => {
                    window.dispatchEvent(
                      new CustomEvent("planner:project", {
                        detail: String(selectedProjectWorkspace.id),
                      }),
                    );
                    onNavigate("Planner");
                  }}
                >
                  <strong>Planner</strong>
                  <span>Open tasks for this project</span>
                </button>
              </div>
              <ProjectOperationsSummary
                project={selectedProjectWorkspace}
                workspaceId={workspaceId}
                onOpen={openOperation}
              />
            </>
          )}
          {projectOperation === "risks" && (
            <ProjectRiskIssuePanel
              projects={[selectedProjectWorkspace]}
              workspaceId={workspaceId}
              tasks={tasks}
              canManage={canManageMembers}
            />
          )}
          {projectOperation === "resources" && (
            <ProjectStakeholderResourcePanel
              project={selectedProjectWorkspace}
              workspaceId={workspaceId}
              canManage={canManageMembers}
              tasks={tasks}
            />
          )}
          {projectOperation === "budget" && (
            <ProjectCostBudgetPanel
              project={selectedProjectWorkspace}
              workspaceId={workspaceId}
              canManage={canManageMembers}
              onProjectUpdated={(updatedProject) => {
                setSelectedProjectWorkspace(updatedProject);
                setLocalData((current) => ({
                  ...current,
                  projects: current.projects.map((item) =>
                    item.id === updatedProject.id ? updatedProject : item,
                  ),
                }));
                onRefresh();
              }}
            />
          )}
          {selectedProject && (
            <ProjectEditDrawer
              project={selectedProject}
              workspaceId={workspaceId}
              onClose={() => setSelectedProject(null)}
              onUpdated={(updatedProject) => {
                setSelectedProjectWorkspace(updatedProject);
                setLocalData((current) => ({
                  ...current,
                  projects: current.projects.map((item) =>
                    item.id === updatedProject.id ? updatedProject : item,
                  ),
                }));
                onRefresh();
                setSelectedProject(null);
              }}
            />
          )}
        </section>
      );
    }
    return (
      <section className="workspace-view projects-view">
        <WorkspaceViewHeading
          title={title}
          subtitle={subtitle}
          action={canManageMembers ? "New project" : undefined}
          onAction={() => openComposer("project")}
        />
        <div className="project-summary">
          <div>
            <strong>{summary.active}</strong>
            <span>Active</span>
          </div>
          <div className="is-warning">
            <strong>{summary.risk}</strong>
            <span>At risk</span>
          </div>
          <div className="is-danger">
            <strong>{summary.overdue}</strong>
            <span>Overdue</span>
          </div>
          <div>
            <strong>{summary.completed}</strong>
            <span>Completed</span>
          </div>
        </div>
        <div className="project-toolbar">
          <label className="project-search">
            <Search size={15} />
            <input
              value={projectQuery}
              onChange={(event) => setProjectQuery(event.target.value)}
              placeholder="Search projects"
              aria-label="Search projects"
            />
          </label>
          <AppSelect
            value={projectStatusFilter}
            onChange={(event) => setProjectStatusFilter(event.target.value)}
            aria-label="Filter projects by status"
          >
            <option value="all">All statuses</option>
            <option value="planning">Planning</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="completed">Completed</option>
          </AppSelect>
          <AppSelect
            value={projectHealthFilter}
            onChange={(event) => setProjectHealthFilter(event.target.value)}
            aria-label="Filter projects by health"
          >
            <option value="all">All health</option>
            <option value="on-track">On track</option>
            <option value="at-risk">At risk</option>
            <option value="off-track">Off track</option>
            <option value="completed">Completed</option>
          </AppSelect>
          <AppSelect
            value={projectSort}
            onChange={(event) => setProjectSort(event.target.value)}
            aria-label="Sort projects"
          >
            <option value="due">Due date</option>
            <option value="progress">Progress</option>
            <option value="updated">Recently updated</option>
            <option value="name">Name</option>
          </AppSelect>
          <span>
            {visibleProjects.length} of {withStats.length} projects
          </span>
        </div>
        <div className="project-grid">
          {visibleProjects.length ? (
            visibleProjects.map((project) => (
              <Card
                className={`project-card project-health-${project.health} px-5`}
                key={project.id}
              >
                <div className="project-card-top">
                  <span className="project-icon">
                    <Target size={17} />
                  </span>
                  <span className={`project-health ${project.health}`}>
                    {project.health.replace("-", " ")}
                  </span>
                  <AppSelect
                    className={`project-status ${project.status}`}
                    value={project.status}
                    onChange={(event) =>
                      updateProjectStatus(project, event.target.value)
                    }
                    disabled={!canManageMembers}
                    aria-label={`Change status for ${project.name}`}
                  >
                    <option value="planning">Planning</option>
                    <option value="active">Active</option>
                    <option value="paused">Paused</option>
                    <option value="completed">Completed</option>
                  </AppSelect>
                  {canManageMembers && (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => setSelectedProject(project)}
                        aria-label={`Edit ${project.name}`}
                      >
                        <MoreHorizontal size={14} />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => deleteProject(project)}
                        aria-label={`Delete ${project.name}`}
                      >
                        <X size={14} />
                      </Button>
                    </>
                  )}
                </div>
                <h3>{project.name}</h3>
                <p>{project.description || "No project description yet."}</p>
                <ProjectProgress project={project} tasks={tasks} />
                <div className="project-task-stats">
                  <span>{project.taskCount - project.completed} open</span>
                  <span className={project.blocked ? "risk" : ""}>
                    {project.blocked} blocked
                  </span>
                  <span className={project.overdue ? "danger" : ""}>
                    {project.overdue} overdue
                  </span>
                </div>
                <div className="project-footer">
                  <div>
                    <span>
                      {project.due_date
                        ? `Due ${project.due_date}`
                        : "No due date"}
                    </span>
                    {project.updated_at && (
                      <small>
                        Updated {formatRelativeActivityTime(project.updated_at)}
                      </small>
                    )}
                  </div>
                  <button
                    type="button"
                    className="project-task-link"
                    onClick={() => {
                      setSelectedProjectWorkspace(project);
                      setProjectOperation("");
                    }}
                    aria-label={`Open ${project.name}`}
                  >
                    Open project <ArrowUpRight size={15} />
                  </button>
                </div>
              </Card>
            ))
          ) : (
            <EmptyState
              text={
                localData.projects.length
                  ? "No projects match these filters."
                  : "No projects have been created yet."
              }
            />
          )}
        </div>
        <ProjectRiskIssuePanel
          projects={localData.projects}
          workspaceId={workspaceId}
          tasks={tasks}
          canManage={canManageMembers}
        />
        {composerOpen && (
          <WorkspaceComposer
            type="project"
            form={form}
            setForm={setForm}
            error={composerError}
            submitting={submitting}
            onClose={() => setComposerOpen(false)}
            onSubmit={submitComposer}
            projectTemplates={localData.projectTemplates || []}
          />
        )}
        {selectedProject && (
          <ProjectEditDrawer
            project={selectedProject}
            workspaceId={workspaceId}
            onClose={() => setSelectedProject(null)}
            onUpdated={(updatedProject) => {
              setLocalData((current) => ({
                ...current,
                projects: current.projects.map((item) =>
                  item.id === updatedProject.id ? updatedProject : item,
                ),
              }));
              onRefresh();
              setSelectedProject(null);
            }}
          />
        )}
      </section>
    );
  }

  if (active === "Files") {
    return (
      <Suspense fallback={null}>
        <FilesWorkspaceView workspaceId={workspaceId} currentUserId={currentUserId} />
      </Suspense>
    );
  }

  if (active === "Channels" || active === "Chats") {
    return (
      <Suspense fallback={null}>
        <ChatWorkspaceView
          viewType={active === "Channels" ? "channels" : "direct"}
          data={localData}
          workspaceId={workspaceId}
          currentUserId={currentUserId}
          onRefresh={onRefresh}
          onError={onActionError}
          onConfirm={onConfirm}
          onNavigate={onNavigate}
        />
      </Suspense>
    );
  }

  if (active === "Follow-up") {
    const isOverdueFollowUp = (followUp) =>
      followUp.status === "open" &&
      followUp.due_date &&
      followUp.due_date < today;
    const visibleFollowUps = localData.followUps.filter(
      (followUp) =>
        followUpFilter === "all" ||
        followUp.status === followUpFilter ||
        (followUpFilter === "overdue" && isOverdueFollowUp(followUp)),
    );
    return (
      <section className="workspace-view">
        <WorkspaceViewHeading
          title={title}
          subtitle={subtitle}
          action="Add follow-up"
          onAction={() => openComposer("followup")}
        />
        <div className="follow-up-toolbar">
          <label>
            Filter follow-ups
            <AppSelect
              value={followUpFilter}
              onChange={(event) => setFollowUpFilter(event.target.value)}
              aria-label="Filter follow-ups"
            >
              <option value="all">All follow-ups</option>
              <option value="open">Open</option>
              <option value="completed">Completed</option>
              <option value="overdue">Overdue</option>
            </AppSelect>
          </label>
          <span>{visibleFollowUps.length} shown</span>
        </div>
        <Card className="follow-up-list px-5">
          {visibleFollowUps.length ? (
            visibleFollowUps.map((followUp) => {
              const linkedTask = tasks.find(
                (task) => task.id === followUp.task_id,
              );
              const canEdit =
                canManageMembers ||
                followUp.created_by === currentUserId ||
                followUp.assigned_to === currentUserId;
              return (
                <div className="follow-up-row" key={followUp.id}>
                  <span
                    className={`follow-up-status ${followUp.status} ${isOverdueFollowUp(followUp) ? "overdue" : ""}`}
                  />{" "}
                  <div>
                    <strong>{followUp.note}</strong>
                    <span>
                      {followUp.due_date
                        ? `Due ${followUp.due_date}`
                        : "No due date"}
                      {linkedTask ? ` | ${linkedTask.title}` : ""}
                      {followUp.assigned_to_name
                        ? ` | ${followUp.assigned_to_name}`
                        : ""}
                    </span>
                  </div>
                  <div className="follow-up-actions">
                    {canEdit && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedFollowUp(followUp)}
                      >
                        Edit
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => completeFollowUp(followUp)}
                    >
                      {followUp.status === "completed" ? "Reopen" : "Mark done"}
                    </Button>
                    {(canManageMembers ||
                      followUp.created_by === currentUserId) && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => deleteFollowUp(followUp)}
                        aria-label={`Delete ${followUp.note}`}
                      >
                        <X size={14} />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })
          ) : (
            <EmptyState text="Nothing needs follow-up right now." />
          )}
        </Card>
        {composerOpen && (
          <WorkspaceComposer
            type="followup"
            form={form}
            setForm={setForm}
            error={composerError}
            submitting={submitting}
            onClose={() => setComposerOpen(false)}
            onSubmit={submitComposer}
            members={localData.members}
            tasks={tasks}
          />
        )}
        {selectedFollowUp && (
          <FollowUpEditDialog
            followUp={selectedFollowUp}
            members={localData.members}
            tasks={tasks}
            workspaceId={workspaceId}
            canManageMembers={canManageMembers}
            currentUserId={currentUserId}
            onClose={() => setSelectedFollowUp(null)}
            onUpdated={(updatedFollowUp) => {
              setLocalData((current) => ({
                ...current,
                followUps: current.followUps.map((item) =>
                  item.id === updatedFollowUp.id ? updatedFollowUp : item,
                ),
              }));
              onRefresh();
              setSelectedFollowUp(null);
            }}
          />
        )}
      </section>
    );
  }

  if (active === "Team board") {
    return (
      <>
        <TeamBoardView
          tasks={tasks}
          members={localData.members}
          projects={localData.projects}
          scope={teamBoardScope}
          onScopeChange={setTeamBoardScope}
          focus={teamBoardFocus}
          onFocusChange={onTeamBoardFocusChange}
          invitations={localData.invitations}
          canManageMembers={canManageMembers}
          onInvite={() => openComposer("invite")}
          onComplete={onComplete}
          onStatusChange={onStatusChange}
          onOpenTask={onOpenTask}
          onUpdateMemberRole={updateMemberRole}
          onRemoveMember={removeMember}
          onCancelInvitation={cancelInvitation}
          onResendInvitation={resendInvitation}
          onNavigate={onNavigate}
        />
        {composerOpen && (
          <WorkspaceComposer
            type="invite"
            form={form}
            setForm={setForm}
            error={composerError}
            submitting={submitting}
            onClose={() => setComposerOpen(false)}
            onSubmit={submitComposer}
          />
        )}
      </>
    );
  }

  if (active === "My tasks") {
    return (
      <MyTasksView
        tasks={tasks}
        currentUserId={currentUserId}
        currentUserName={currentUserName}
        projects={localData.projects}
        buckets={localData.buckets}
        onAddTask={onAddTask}
        onOpenTask={onOpenTask}
        onComplete={onComplete}
        onStatusChange={onStatusChange}
        onDelete={onDelete}
        canManageTasks={canManageTasks}
      />
    );
  }

  const normalizedSearch = searchQuery.trim().toLowerCase();
  const filteredTasks = tasks
    .filter(
      (task) =>
        active !== "My tasks" ||
        String(task.assignee_id || "") === String(currentUserId),
    )
    .filter(
      (task) =>
        !normalizedSearch || taskSearchText(task).includes(normalizedSearch),
    );
  return (
    <section className="workspace-view">
      <WorkspaceViewHeading
        title={title}
        subtitle={subtitle}
        action="Add task"
        onAction={onAddTask}
      />
      <Card className="task-list-view px-5">
        {active === "Team board" && (
          <div className="member-summary">
            <Users size={18} />
            <strong>{localData.members.length || 0} members</strong>
            <span>across this workspace</span>
          </div>
        )}
        {filteredTasks.length ? (
          filteredTasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onComplete={onComplete}
              onStatusChange={onStatusChange}
              onDelete={onDelete}
              onOpenTask={onOpenTask}
              canDelete={canManageTasks}
            />
          ))
        ) : (
          <EmptyState text="No tasks match this view yet." />
        )}
      </Card>
    </section>
  );
}

class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <BrandedStatusScreen error="The workspace could not render this view." />
    );
  }
}

function BrandedStatusScreen({ loading = false, error = "" }) {
  return (
    <main
      className={`branded-status-screen ${error ? "is-error" : "is-loading"}`}
      role={error ? "alert" : "status"}
    >
      <section className="branded-status-content">
        <img
          className="branded-status-logo"
          src="/tijha-logo.png"
          alt="TijhaBooks"
        />
        <p className="branded-status-wordmark">WorkSpace</p>
        <div className="branded-status-mark">{error ? "!" : ""}</div>
        <p className="eyebrow">{error ? "WorkSpace error" : "WorkSpace"}</p>
        <h1>{error ? "There was an error" : "Loading WorkSpace"}</h1>
        <p>{error || "Preparing your workspace..."}</p>
        {error && (
          <button
            className="primary-button"
            onClick={() => window.location.reload()}
          >
            Try again
          </button>
        )}
      </section>
    </main>
  );
}

// The banner sits outside the error boundary on purpose: if a bad build has
// taken the app down to the error screen, offering the new one is exactly what
// the user needs, and the boundary would otherwise replace the banner too.
createRoot(document.getElementById("root")).render(
  <>
    <AppUpdateBanner />
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </>,
);

// Production only: a dev-registered service worker fights Vite's HMR (it can
// serve a stale cached module instead of the one Vite just recompiled).
if (import.meta.env.PROD) {
  window.addEventListener("load", startAppUpdateWatch);
}
