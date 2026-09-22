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
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import {
  Activity as ActivityIcon,
  AlertCircle,
  AlertTriangle,
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
  CircleSlash,
  ClipboardList,
  Clock3,
  Copy,
  Download,
  File,
  Filter,
  Flag,
  Folder,
  Hash,
  Home,
  Info,
  LayoutGrid,
  Link2,
  List,
  LogOut,
  Menu,
  Megaphone,
  MessageSquare,
  MoreHorizontal,
  ChevronLeft,
  ChevronRight,
  EyeOff,
  MonitorUp,
  Pause,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Square,
  Upload,
  Users,
  Webhook,
  X,
  Sun,
  Moon,
} from "lucide-react";
import "./pencil.css";
import {
  applyWorkspaceTheme,
  readWorkspaceTheme,
  resolveWorkspaceTheme,
} from "./lib/theme.js";
import { ThemeInit } from "../.flowbite-react/init.jsx";
import { ThemeProvider } from "flowbite-react";
import { flowbiteTheme } from "./lib/flowbite-theme.js";
import { Button } from "./components/ui/button.jsx";
import { Badge } from "./components/ui/badge.jsx";
import { Alert } from "./components/ui/alert.jsx";
import { Card, CardContent, CardHeader } from "./components/ui/card.jsx";
import { Tabs, TabsList, TabsTrigger } from "./components/ui/tabs.jsx";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "./components/ui/popover.jsx";
import PlannerBoard from "./components/PlannerBoard.jsx";
import ProjectKanbanBoard from "./components/ProjectKanbanBoard.jsx";
import ProjectTaskTable from "./components/ProjectTaskTable.jsx";
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
import Avatar from "./components/Avatar.jsx";
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
  ProjectEditDialog,
} from "./components/RecordDialogs.jsx";
import {
  AssigneePicker,
  TaskCard,
  TaskDetailDrawer,
} from "./components/TaskViews.jsx";
import SettingsView from "./components/SettingsView.jsx";
import CreateWorkspaceDialog from "./components/CreateWorkspaceDialog.jsx";
const ScreenSharingView = lazy(() => import("./components/ScreenSharing.jsx"));
const ScreenShareControl = lazy(() =>
  import("./components/ScreenSharing.jsx").then((module) => ({
    default: module.ScreenShareControl,
  })),
);
import ImportView from "./components/ImportView.jsx";
import PersonalPlanner from "./components/PersonalPlanner.jsx";
import { releaseNotesUnread } from "./lib/release-notes.js";
import AppUpdateBanner from "./components/AppUpdateBanner.jsx";
import BrandedStatusScreen from "./components/BrandedStatusScreen.jsx";
import { startAppUpdateWatch } from "./lib/app-updates.js";
import { startNotificationAlerts, updateAppBadge } from "./lib/notification-alerts.js";
import { announceNotificationChange } from "./lib/notification-events.js";
import { notificationDestinations, parseNotificationDeepLink, resolveNotificationTarget } from "./lib/notification-navigation.js";
import { requestChatThread } from "./lib/chat-navigation.js";
import { startInstallPromptCapture } from "./lib/install-prompt.js";
import {
  CookieConsent,
  HelpView,
  InstallAppView,
  LegalView,
  WhatsNew,
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
  CHECK_IN_RANGES,
  PRESENCE_LABEL,
  PRESENCE_OPTIONS,
  WORK_SHIFT_TOAST,
  filterCheckInsByRange,
  formatCalendarDate,
  formatDate,
  formatDateTime,
  formatDay,
  formatDayMonth,
  formatHoursLabel,
  formatLongDate,
  formatRelativeActivityTime,
  formatShiftClock,
  formatShiftDuration,
  getCalendarDays,
  getCsrfToken,
  initialsFor,
  mapTaskFromApi,
  readJsonResponse,
  taskAssigneeLabel,
  taskIsAssignedTo,
  taskSearchText,
  toDateKey,
  toDateTimeLocal,
  googleCalendarUrl,
  calendarEventConflictCounts,
  calendarUpcomingGroup,
} from "./lib/workspace-format.js";

const isConversationNotification = (notification) =>
  ["chat_channel", "direct_conversation"].includes(notification?.target_type);

const notificationBadgeLabel = (count, max = 99) =>
  count > max ? `${max}+` : String(count);

const formatAuditAction = (action = "") =>
  String(action)
    .replaceAll("_", " ")
    .replace(/^./, (character) => character.toUpperCase());

const notificationPanelVisual = (notification) => {
  const kind = notification.kind || "";
  if (kind === "mention") return { Icon: MessageSquare, tone: "mention" };
  if (["direct_message", "channel_message"].includes(kind)) {
    return { Icon: MessageSquare, tone: "message" };
  }
  if (
    [
      "risk_issue_assigned",
      "manager_activity",
      "membership_change",
      "invitation_response",
    ].includes(kind)
  ) {
    return {
      Icon: kind === "risk_issue_assigned" ? Flag : Users,
      tone: "risk",
    };
  }
  if (kind.startsWith("check_in")) return { Icon: CheckCircle2, tone: "complete" };
  if (kind.startsWith("calendar")) return { Icon: CalendarDays, tone: "calendar" };
  if (kind.includes("document") || kind.includes("attachment")) {
    return { Icon: File, tone: "file" };
  }
  return { Icon: ClipboardList, tone: "task" };
};

function NotificationIndicator({
  count,
  countKnown,
  label,
  max = 99,
  className = "",
  dotClassName = "",
}) {
  if (count <= 0) return null;

  if (!countKnown) {
    return <span aria-label={`Unread ${label}`} className={dotClassName} />;
  }

  return (
    <span aria-label={`${count} unread ${label}`} className={className}>
      {notificationBadgeLabel(count, max)}
    </span>
  );
}

function App() {
  const today = toDateKey(new Date());
  const todayLabel = formatLongDate(today);
  // Supports PWA shortcuts (manifest.webmanifest) and any other deep link that
  // wants to land on a specific view, e.g. /?view=My+tasks.
  const [active, setActive] = useState(() => {
    const requested = new URLSearchParams(window.location.search).get("view");
    const saved = localStorage.getItem("workspace-last-page");
    const requestedPage = requested || saved || "Today";
    const page = requestedPage === "Team board" ? "Team" : requestedPage;
    return page;
  });
  useEffect(() => {
    localStorage.setItem("workspace-last-page", active);
  }, [active]);
  // Where the user has been, so every page can offer a way back. The app moves
  // between pages by setting state rather than by URL, and there are two dozen
  // places that do it - a notification opening a task, a card opening a project,
  // the sidebar. Recording the move here rather than at each call site means a
  // new one is covered the day it is written.
  const [pageHistory, setPageHistory] = useState([]);
  const previousPageRef = useRef(active);
  // Set while going back, so returning does not itself become a step forward
  // and trap the user bouncing between two pages.
  const goingBackRef = useRef(false);
  useEffect(() => {
    if (previousPageRef.current === active) return;
    const cameFrom = previousPageRef.current;
    previousPageRef.current = active;
    if (goingBackRef.current) {
      goingBackRef.current = false;
      return;
    }
    // Capped: this is a breadcrumb for the last few moves, not a session log.
    setPageHistory((current) => [...current, cameFrom].slice(-20));
  }, [active]);
  const goBack = () => {
    if (!pageHistory.length) return;
    goingBackRef.current = true;
    setActive(pageHistory[pageHistory.length - 1]);
    setPageHistory((current) => current.slice(0, -1));
  };
  const backLabel = pageHistory.length
    ? `Back to ${pageHistory[pageHistory.length - 1]}`
    : "Back";
  // The board's exception filter lives here rather than in the board because the
  // dashboard's headline cards are what set it - Today and the board are rendered by
  // two different components. Leaving the board clears it, so arriving later from the
  // sidebar cannot land you on a filtered board with no memory of why.
  const [teamBoardFocus, setTeamBoardFocus] = useState("all");
  useEffect(() => {
    if (active !== "Team") setTeamBoardFocus("all");
  }, [active]);
  const [tasks, setTasks] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [confirmState, setConfirmState] = useState(null);
  const confirmAction = (message, options = {}) =>
    new Promise((resolve) => setConfirmState({ message, resolve, ...options }));
  const [taskError, setTaskError] = useState("");
  const [selectedTask, setSelectedTask] = useState(null);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [selectedFollowUp, setSelectedFollowUp] = useState(null);
  const [pendingComposer, setPendingComposer] = useState(null);
  const taskModalRef = useRef(null);
  const [notificationOpen, setNotificationOpen] = useState(false);
  // The activity panel and the account menu each have a home in both bars,
  // and both bars stay mounted, so the origin says which one raised it. Without
  // it a single click would leave the same panel in the DOM twice.
  const [notificationOrigin, setNotificationOrigin] = useState("header");
  const [messagesOpen, setMessagesOpen] = useState(false);
  // Which control opened the messages panel. The header button and the mobile
  // bottom-nav pill share this panel, but they sit at opposite ends of the
  // screen: below 1024px the panel has to rise from the pill instead of hanging
  // off the header it is rendered next to.
  const [messagesOrigin, setMessagesOrigin] = useState("header");
  const [screenShareNotificationId, setScreenShareNotificationId] = useState(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [profileMenuOrigin, setProfileMenuOrigin] = useState("header");
  // The design gives the account menu two triggers - the header avatar and the
  // sidebar's overflow button - and both are mounted at once on desktop, so
  // they cannot share one open flag without drawing the menu twice.
  const [sidebarProfileOpen, setSidebarProfileOpen] = useState(false);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  // Held in state rather than read on each render so opening the page clears the
  // sidebar marker without needing a reload.
  const [whatsNewUnread, setWhatsNewUnread] = useState(() => releaseNotesUnread());
  const markWhatsNewSeen = useCallback(() => setWhatsNewUnread(false), []);
  const [createWorkspaceOpen, setCreateWorkspaceOpen] = useState(false);
  const notifRef = useRef(null);
  const notificationPanelRef = useRef(null);
  const messagesRef = useRef(null);
  const messagesNavPanelRef = useRef(null);
  const mobileNavRef = useRef(null);
  useEffect(() => {
    if (!showModal) return undefined;
    const previouslyFocused = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
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
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, [showModal]);
  const searchRef = useRef(null);
  const searchInputRef = useRef(null);
  const profileMenuRef = useRef(null);
  const appbarNotificationRef = useRef(null);
  const appbarProfileRef = useRef(null);
  const appbarProfileMenuRef = useRef(null);
  const sidebarProfileRef = useRef(null);
  const workspaceMenuRef = useRef(null);
  const workspaceMenuRefMobile = useRef(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem("workspace-sidebar-collapsed") === "true",
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const railCollapsed = sidebarCollapsed && !mobileOpen;
  const [newTask, setNewTask] = useState("");
  const [newTaskTemplate, setNewTaskTemplate] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newAssigneeIds, setNewAssigneeIds] = useState([]);
  const [newProjectId, setNewProjectId] = useState("");
  const [newWorkstreamId, setNewWorkstreamId] = useState("");
  const [newBucket, setNewBucket] = useState("Backlog");
  const [newDueDate, setNewDueDate] = useState("");
  const [newRecurrence, setNewRecurrence] = useState("none");
  const [newPriority, setNewPriority] = useState("normal");
  const [newTaskStatus, setNewTaskStatus] = useState("todo");
  const [taskSubmitting, setTaskSubmitting] = useState(false);
  const [selectedFilter, setSelectedFilter] = useState("All work");
  const [searchQuery, setSearchQuery] = useState("");
  const [globalSearchResults, setGlobalSearchResults] = useState([]);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [globalSearchLoading, setGlobalSearchLoading] = useState(false);
  const [theme, setTheme] = useState(readWorkspaceTheme);
  const [systemPrefersDark, setSystemPrefersDark] = useState(
    () =>
      window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ?? false,
  );
  const resolvedTheme = resolveWorkspaceTheme(theme, systemPrefersDark);
  const [session, setSession] = useState({
    loading: true,
    user: null,
    error: "",
  });
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(null);
  // Bumped on every "open this thread" request so an already-mounted Chats view
  // re-reads the hand-off instead of only a newly-mounted one.
  const [chatThreadRequest, setChatThreadRequest] = useState(0);
  const [pendingActivity, setPendingActivity] = useState(null);
  const clearPendingActivity = useCallback(() => setPendingActivity(null), []);
  // Activity rows live in the App header, but their detail state belongs to the
  // workspace view. Hold the pending targets here so a bell click can switch
  // views first and let the destination load or open the exact record.
  const [pendingCheckInId, setPendingCheckInId] = useState(null);
  const [pendingDocumentId, setPendingDocumentId] = useState(null);
  const [pendingEventId, setPendingEventId] = useState(null);
  const [pendingFollowUpId, setPendingFollowUpId] = useState(null);
  const [pendingProjectNotification, setPendingProjectNotification] = useState(null);
  const [pendingWorkstreamNotification, setPendingWorkstreamNotification] = useState(null);
  // A workspace refresh reads notification rows separately from the summary
  // poll. If a read or arrival lands while that refresh is in flight, its
  // notification payload is older than the authoritative event and must not be
  // allowed to put the badge or dismissed rows back.
  const notificationStateRevisionRef = useRef(0);
  useEffect(() => {
    setPendingCheckInId(null);
    setPendingDocumentId(null);
    setPendingEventId(null);
    setPendingFollowUpId(null);
    setPendingProjectNotification(null);
    setPendingWorkstreamNotification(null);
  }, [activeWorkspaceId]);
  useEffect(() => {
    if (session.user?.id && activeWorkspaceId) {
      return startNotificationAlerts(() => {}, undefined, undefined, activeWorkspaceId);
    }
  }, [session.user?.id, activeWorkspaceId]);
  // The two popups read independent workspace feeds: activity for the bell and
  // conversations for Messages. Loading them separately keeps either category
  // from filling the other's 20-row page with unrelated alerts.
  useEffect(() => {
    if (!activeWorkspaceId || session.loading || !session.user?.id) return undefined;
    let reloadSequence = 0;
    let activeReload = true;
    const reloadNotifications = (event) => {
      notificationStateRevisionRef.current += 1;
      const requestSequence = ++reloadSequence;
      const loadFeed = (query) =>
        fetch(`/api/workspaces/${activeWorkspaceId}/notifications/?${query}`, { credentials: "include" })
          .then((response) => (response.ok ? response.json() : null));
      Promise.all([loadFeed("exclude_chat=1&sort=newest"), loadFeed("only_conversation=1")])
        .then(([activityPayload, conversationPayload]) => {
          if (!activeReload || requestSequence !== reloadSequence) return;
          if (!activityPayload && !conversationPayload) return;
          const authoritativeActivityCount = event?.detail?.unreadCount;
          setWorkspaceData((current) => {
            const serverCounts = activityPayload?.unread_counts ?? conversationPayload?.unread_counts ?? current.notificationCounts;
            const notificationCounts = typeof authoritativeActivityCount === "number" && serverCounts
              ? { ...serverCounts, activity: Math.max(0, authoritativeActivityCount) }
              : serverCounts;
            return {
              ...current,
              notifications: [
                ...(conversationPayload?.notifications || []),
                ...(activityPayload?.notifications || []),
              ],
              activityNotifications: activityPayload?.notifications || [],
              conversationNotifications: conversationPayload?.notifications || [],
              notificationCounts,
            };
          });
        })
        .catch((error) => console.warn("Notifications could not be refreshed.", error));
    };
    window.addEventListener("workspace:notifications-changed", reloadNotifications);
    return () => {
      activeReload = false;
      window.removeEventListener("workspace:notifications-changed", reloadNotifications);
    };
  }, [activeWorkspaceId, session.loading, session.user?.id]);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState("");
  const [workspaceNotice, setWorkspaceNotice] = useState("");
  const [workspaceReload, setWorkspaceReload] = useState(0);
  const activeRef = useRef(active);
  const previousActiveRef = useRef(active);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);
  useEffect(() => {
    const previous = previousActiveRef.current;
    previousActiveRef.current = active;
    if (previous === "Team" && active !== "Team") {
      setWorkspaceReload((current) => current + 1);
    }
  }, [active]);
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
    archivedConversations: [],
    followUps: [],
    invitations: [],
    notifications: [],
    activityNotifications: [],
    conversationNotifications: [],
    // Unread totals counted server-side over every row, so the badges do not
    // shrink to whatever the 20-item notification page happens to hold.
    notificationCounts: null,
    activity: [],
    auditLogs: [],
    buckets: [],
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
  const [pendingInvitationBusyId, setPendingInvitationBusyId] = useState(null);

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

  const declinePendingInvitation = async (invitation) => {
    if (!invitation?.id || pendingInvitationBusyId) return;
    setInviteActionError("");
    setPendingInvitationBusyId(invitation.id);
    try {
      const response = await fetch(`/api/invitations/${invitation.id}/decline/`, {
        method: "POST",
        credentials: "include",
        headers: { "X-CSRFToken": await getCsrfToken() },
      });
      const data = await readJsonResponse(
        response,
        "Invitation could not be declined.",
      );
      if (!response.ok)
        throw new Error(data.error || "Invitation could not be declined.");
      const sessionResponse = await fetch("/api/auth/me/", {
        credentials: "include",
      });
      const sessionData = await sessionResponse.json();
      if (sessionResponse.ok && sessionData.user)
        setSession((current) => ({ ...current, user: sessionData.user }));
      toast.success("Invitation declined.");
    } catch (actionError) {
      setInviteActionError(
        actionError.message || "Invitation could not be declined.",
      );
    } finally {
      setPendingInvitationBusyId(null);
    }
  };

  const handleWorkspaceCreated = (data) => {
    if (data?.user) setSession((current) => ({ ...current, user: data.user }));
    if (data?.workspace?.id) setActiveWorkspaceId(data.workspace.id);
    setWorkspaceNotice(`${data?.workspace?.name || "Workspace"} created.`);
  };

  useLayoutEffect(() => {
    applyWorkspaceTheme(theme, { prefersDark: systemPrefersDark });
  }, [theme, systemPrefersDark]);

  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!media) return undefined;
    const update = (event) => setSystemPrefersDark(event.matches);
    setSystemPrefersDark(media.matches);
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);

  useEffect(() => {
    localStorage.setItem(
      "workspace-sidebar-collapsed",
      String(sidebarCollapsed),
    );
  }, [sidebarCollapsed]);

  useEffect(() => {
    const handler = (event) => {
      if (
        !notifRef.current?.contains(event.target) &&
        !appbarNotificationRef.current?.contains(event.target) &&
        !notificationPanelRef.current?.contains(event.target)
      )
        setNotificationOpen(false);
      // The mobile pill nav opens the same panel as the header icon, and when it
      // does the panel renders beside the nav rather than inside the header, so
      // a click on the pill, on the panel, or in the header control all have to
      // count as inside it or the panel closes and reopens under the same click.
      if (
        messagesRef.current &&
        !messagesRef.current.contains(event.target) &&
        !mobileNavRef.current?.contains(event.target) &&
        !messagesNavPanelRef.current?.contains(event.target)
      )
        setMessagesOpen(false);
      const profileSurfaces = [
        profileMenuRef.current,
        appbarProfileRef.current,
        appbarProfileMenuRef.current,
      ].filter(Boolean);
      if (
        profileSurfaces.length &&
        profileSurfaces.every((surface) => !surface.contains(event.target))
      )
        setProfileMenuOpen(false);
      if (
        sidebarProfileRef.current &&
        !sidebarProfileRef.current.contains(event.target)
      )
        setSidebarProfileOpen(false);
      // The switcher renders in the sidebar and again in the mobile drawer, and
      // both stay mounted (the drawer is only translated off-screen), so a click
      // counts as "outside" only when it misses both.
      if (
        !workspaceMenuRef.current?.contains(event.target) &&
        !workspaceMenuRefMobile.current?.contains(event.target)
      )
        setWorkspaceMenuOpen(false);
      if (searchRef.current && !searchRef.current.contains(event.target))
        setGlobalSearchOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // The header prints a "/" key hint in the search field, so "/" has to do what
  // it says. Ignored while the caret is already in a field, or while a modifier
  // is held, so it never eats a character someone meant to type.
  useEffect(() => {
    const focusSearch = (event) => {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey)
        return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      )
        return;
      if (!searchInputRef.current) return;
      event.preventDefault();
      searchInputRef.current.focus();
      searchInputRef.current.select();
    };
    document.addEventListener("keydown", focusSearch);
    return () => document.removeEventListener("keydown", focusSearch);
  }, []);

  useEffect(() => {
    const closeOverlays = (event) => {
      if (event.key !== "Escape") return;
      setNotificationOpen(false);
      setMessagesOpen(false);
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
        body: `Starts ${formatDateTime(remindedEvent.start_at)}`,
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
      archivedConversations: [],
      followUps: [],
      invitations: [],
      notifications: [],
      activityNotifications: [],
      conversationNotifications: [],
      notificationCounts: null,
      activity: [],
      auditLogs: [],
      buckets: [],
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

  const refreshSession = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/me/", { credentials: "include" });
      const data = await response.json();
      if (!response.ok)
        throw new Error(
          data.error || "The authentication service is unavailable.",
        );
      setSession({ loading: false, user: data.user || null, error: "" });
    } catch (error) {
      setSession({ loading: false, user: null, error: error.message });
    }
  }, []);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  useEffect(() => {
    window.addEventListener("workspace:auth-required", refreshSession);
    return () =>
      window.removeEventListener("workspace:auth-required", refreshSession);
  }, [refreshSession]);

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
      const notificationStateRevision = notificationStateRevisionRef.current;
      const auditRequest = ["owner", "manager"].includes(workspaceRole)
        ? read(`/api/workspaces/${workspaceId}/audit-logs/`, { audit_logs: [] })
        : Promise.resolve({ audit_logs: [] });
      // Team owns its own paginated task query. Skipping the full task table
      // here keeps that page from re-downloading every task on every refresh.
      const taskRequest =
        activeRef.current === "Team"
          ? Promise.resolve({ tasks: [] })
          : readAllTasks();
      const refreshRequest = Promise.all([
        taskRequest,
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
        read(`/api/workspaces/${workspaceId}/direct-conversations/?archived=true`, {
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
        read(`/api/workspaces/${workspaceId}/notifications/?exclude_chat=1&sort=newest`, {
          notifications: [],
        }),
        read(`/api/workspaces/${workspaceId}/notifications/?only_conversation=1`, {
          notifications: [],
        }),
        read(`/api/workspaces/${workspaceId}/activity/?page_size=50&date_from=${today}&include_filters=0&include_summary=0`, {
          activity: [],
        }),
        read(`/api/workspaces/${workspaceId}/plan-buckets/`, { buckets: [] }),
        read(`/api/workspaces/${workspaceId}/invitations/?page_size=500`, {
          invitations: [],
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
            archivedDirectData,
            followUpData,
            eventData,
            checkInData,
            workShiftData,
            activityNotificationData,
            conversationNotificationData,
            activityData,
            bucketData,
            invitationData,
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
              archivedConversations: archivedDirectData.conversations,
              followUps: followUpData.follow_ups,
              events: eventData.events,
              checkIns: checkInData.check_ins,
              workShifts: workShiftData.work_shifts,
              ...(notificationStateRevision === notificationStateRevisionRef.current
                ? {
                    notifications: [
                      ...(conversationNotificationData.notifications || []),
                      ...(activityNotificationData.notifications || []),
                    ],
                    activityNotifications: activityNotificationData.notifications || [],
                    conversationNotifications: conversationNotificationData.notifications || [],
                    notificationCounts: activityNotificationData.unread_counts ?? conversationNotificationData.unread_counts ?? null,
                  }
                : {}),
              activity: activityData.activity,
              auditLogs: auditData.audit_logs,
              buckets: bucketData.buckets,
              invitations: invitationData.invitations,
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
    if (
      active !== "Team" &&
      selectedTask &&
      !tasks.some((task) => task.id === selectedTask.id)
    )
      setSelectedTask(null);
  }, [active, tasks, selectedTask]);

  useEffect(() => {
    const mine = session.user
      ? tasks.filter(
          (task) =>
            taskIsAssignedTo(task, session.user.id) &&
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
        ["notification", "target_type", "target_id", "message_id"].forEach((key) => remaining.delete(key));
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
      <>
        <NoWorkspaceScreen
          currentUserEmail={session.user.email}
          pendingInvitations={session.user.pending_invitations || []}
          onCreate={() => setCreateWorkspaceOpen(true)}
          onReview={reviewInvitation}
          onDecline={declinePendingInvitation}
          onSignOut={logout}
          decliningInvitationId={pendingInvitationBusyId}
          error={inviteActionError}
        />
        <CreateWorkspaceDialog
          open={createWorkspaceOpen}
          onOpenChange={setCreateWorkspaceOpen}
          onCreated={handleWorkspaceCreated}
        />
      </>
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
      return true;
    } catch (error) {
      if (previousTask)
        setTasks((current) =>
          current.map((task) => (task.id === id ? previousTask : task)),
        );
      toast.error(error.message || "Task status could not be saved.");
      console.warn("Task status could not be saved.", error.message);
      return false;
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
      return true;
    } catch (error) {
      if (previousTask)
        setTasks((current) =>
          current.map((task) => (task.id === id ? previousTask : task)),
        );
      toast.error(error.message || "Task bucket could not be saved.");
      console.warn("Task bucket could not be saved.", error.message);
      return false;
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
  // The request without the confirmation. A bulk action asks once for the whole
  // selection, so it cannot use the single-task handlers, which ask every time.
  const archiveTaskRequest = async (id) => {
    try {
      const response = await fetch(`/api/tasks/${id}/`, {
        method: "DELETE",
        credentials: "include",
        headers: {
          "X-CSRFToken": await getCsrfToken(),
          "X-Workspace-Id": String(activeWorkspaceId || ""),
        },
      });
      if (!response.ok) return false;
      setTasks((current) => current.filter((task) => task.id !== id));
      return true;
    } catch {
      return false;
    }
  };
  const deleteTaskPermanentlyRequest = async (id) => {
    try {
      const response = await fetch(`/api/tasks/${id}/?permanent=1`, {
        method: "DELETE",
        credentials: "include",
        headers: {
          "X-CSRFToken": await getCsrfToken(),
          "X-Workspace-Id": String(activeWorkspaceId || ""),
        },
      });
      if (!response.ok) return false;
      setTasks((current) => current.filter((task) => task.id !== id));
      return true;
    } catch {
      return false;
    }
  };
  const deleteTask = async (id) => {
    if (
      !(await confirmAction(
        "Archive this task? It will be hidden from active task views, but its history is kept.",
        { title: "Archive task", confirmLabel: "Archive task" },
      ))
    )
      return false;
    if (!(await archiveTaskRequest(id))) {
      toast.error("Task could not be archived.");
      return false;
    }
    setSelectedTask(null);
    setWorkspaceNotice("Task archived.");
    setWorkspaceReload((current) => current + 1);
    return true;
  };
  // Archiving keeps the task and its history; this is the only path that destroys
  // it, and the API reserves it for workspace owners (tasks/views.py task_detail).
  // It exists because archive was previously the only outcome available anywhere in
  // the UI, which left the endpoint unreachable.
  const deleteTaskPermanently = async (task) => {
    if (
      !(await confirmAction(
        `Delete "${task.title}" permanently? Its history and attachments are removed and this cannot be undone.`,
        { title: "Delete task permanently", confirmLabel: "Delete permanently" },
      ))
    )
      return false;
    if (!(await deleteTaskPermanentlyRequest(task.id))) {
      toast.error("Task could not be deleted.");
      return false;
    }
    setSelectedTask(null);
    setWorkspaceNotice("Task deleted.");
    setWorkspaceReload((current) => current + 1);
    return true;
  };
  // Bulk actions drive the same per-task endpoints the single-card menus use,
  // one request each, rather than a bulk endpoint that would have to restate
  // the permission and audit rules those already carry. They run in sequence so
  // a large selection does not arrive as a burst, they ask once for the whole
  // selection, and they report what actually happened: some of a selection
  // failing is the normal case when one task has already been removed by
  // somebody else.
  const runBulkTaskAction = async (ids, perform) => {
    let done = 0;
    for (const id of ids) {
      if (await perform(id)) done += 1;
    }
    return { done, failed: ids.length - done };
  };
  const reportBulkOutcome = ({ done, failed }, verb) => {
    if (done) setWorkspaceNotice(`${done} ${done === 1 ? "task" : "tasks"} ${verb}.`);
    if (failed) toast.error(`${failed} ${failed === 1 ? "task" : "tasks"} could not be ${verb}.`);
    if (done) setWorkspaceReload((current) => current + 1);
    return done;
  };
  const bulkArchiveTasks = async (ids) => {
    if (!ids.length) return 0;
    if (
      !(await confirmAction(
        `Archive ${ids.length} ${ids.length === 1 ? "task" : "tasks"}? They will be hidden from active task views, but their history is kept.`,
        { title: "Archive tasks", confirmLabel: `Archive ${ids.length}` },
      ))
    )
      return 0;
    return reportBulkOutcome(await runBulkTaskAction(ids, archiveTaskRequest), "archived");
  };
  const bulkDeleteTasksPermanently = async (ids) => {
    if (!ids.length) return 0;
    if (
      !(await confirmAction(
        `Delete ${ids.length} ${ids.length === 1 ? "task" : "tasks"} permanently? Their history and attachments are removed and this cannot be undone.`,
        { title: "Delete tasks permanently", confirmLabel: `Delete ${ids.length}` },
      ))
    )
      return 0;
    return reportBulkOutcome(await runBulkTaskAction(ids, deleteTaskPermanentlyRequest), "deleted");
  };
  const bulkMoveTasksToBucket = async (ids, bucket) => {
    if (!ids.length || !bucket) return 0;
    const outcome = await runBulkTaskAction(ids, (id) => changeTaskBucket(id, bucket));
    return reportBulkOutcome(outcome, `moved to ${bucket}`);
  };
  const bulkChangeTaskStatus = async (ids, status) => {
    if (!ids.length || !status) return 0;
    const outcome = await runBulkTaskAction(ids, (id) => changeTaskStatus(id, status));
    return reportBulkOutcome(outcome, `moved to ${status}`);
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
      setNewAssigneeIds(
        template.assignee_id ? [String(template.assignee_id)] : [],
      );
    }
  };
  const openTaskModal = (assigneeId, options = {}) => {
    const requestedBucket = sessionStorage.getItem("workspace-new-task-bucket");
    sessionStorage.removeItem("workspace-new-task-bucket");
    setNewTask("");
    setNewTaskTemplate("");
    setNewDescription("");
    setNewAssigneeIds(assigneeId ? [String(assigneeId)] : []);
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
    setNewTaskStatus(options.status || "todo");
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
          body: JSON.stringify({ read_all: true, exclude_chat: true }),
        },
      );
      if (!response.ok)
        return toast.error("Notifications could not be marked as read.");
      announceNotificationChange("activity-read", { unreadCount: 0 });
      void updateAppBadge(0);
      setWorkspaceData((current) => ({
        ...current,
        notifications: current.notifications.map((notification) => ({
          ...notification,
          read: isConversationNotification(notification) ? notification.read : true,
        })),
        activityNotifications: (current.activityNotifications || []).map((notification) => ({
          ...notification,
          read: true,
        })),
        // The bell only ever clears activity, so its own total drops to zero
        // while chat and channel alerts stay unread for their own views.
        notificationCounts: current.notificationCounts
          ? { ...current.notificationCounts, activity: 0 }
          : current.notificationCounts,
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
      const countedNotification = workspaceData.notifications.find(
        (notification) => notification.id === notificationId,
      );
      const currentActivityCount = workspaceData.notificationCounts?.activity;
      const nextActivityCount = typeof currentActivityCount === "number"
        && countedNotification
        && !countedNotification.read
        && !isConversationNotification(countedNotification)
        ? Math.max(0, currentActivityCount - 1)
        : currentActivityCount;
      if (typeof nextActivityCount === "number") {
        announceNotificationChange("notification-read", { unreadCount: nextActivityCount });
        void updateAppBadge(nextActivityCount);
      } else {
        announceNotificationChange("notification-read");
      }
      setWorkspaceData((current) => {
        const cleared = current.notifications.find(
          (notification) => notification.id === notificationId,
        );
        const counts = current.notificationCounts;
        let notificationCounts = counts;
        if (counts && cleared && !cleared.read) {
          const bucket =
            cleared.target_type === "chat_channel"
              ? "channel"
              : cleared.target_type === "direct_conversation"
                ? "direct"
                : "activity";
          notificationCounts = {
            ...counts,
            [bucket]: Math.max(0, (counts[bucket] || 0) - 1),
            ...(bucket === "activity"
              ? {}
              : { conversation: Math.max(0, (counts.conversation || 0) - 1) }),
          };
        }
        return {
          ...current,
          notifications: current.notifications.map((notification) =>
            notification.id === notificationId
              ? { ...notification, read: true }
              : notification,
          ),
          activityNotifications: (current.activityNotifications || []).map((notification) =>
            notification.id === notificationId ? { ...notification, read: true } : notification,
          ),
          conversationNotifications: (current.conversationNotifications || []).map((notification) =>
            notification.id === notificationId ? { ...notification, read: true } : notification,
          ),
          notificationCounts,
        };
      });
    } catch (error) {
      toast.error(error.message || "Notification could not be marked as read.");
    }
  };
  const openNotification = async (notification) => {
    setNotificationOpen(false);
    setMessagesOpen(false);
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
    if (notification.target_type === "document") {
      setPendingDocumentId(String(notification.target_id));
      setActive("Files");
      return;
    }
    if (notification.target_type === "workstream") {
      setPendingWorkstreamNotification(notification.target_id);
      setActive("Planner");
      return;
    }
    if (["project", "risk_issue", "risk"].includes(notification.target_type)) {
      setPendingProjectNotification({
        id: resolved.targetId,
        operation: resolved.operation || "",
        targetType: notification.target_type,
      });
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
    if (resolved.action === "chat") {
      requestChatThread(notification.target_type, notification.target_id, resolved.messageId);
      setChatThreadRequest((current) => current + 1);
      setActive(resolved.destination);
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
          // Omitted when nobody is picked rather than sent empty: the server
          // treats a present key as an explicit choice and would skip the
          // member-defaults-to-self rule.
          ...(newAssigneeIds.length
            ? { assignee_ids: newAssigneeIds.map(Number) }
            : {}),
          project_id: newProjectId || null,
          workstream_id: newWorkstreamId || null,
          bucket: newBucket,
          due_date: newDueDate || null,
          recurrence: newRecurrence,
          priority: newPriority,
          status: newTaskStatus,
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
        mapTaskFromApi(data.task, {
          today,
          workspaceRole: currentWorkspace?.role,
          currentUserId: session.user.id,
        }),
      ]);
      setNewTask("");
      setNewTaskTemplate("");
      setNewDescription("");
      setNewAssigneeIds([]);
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
  const workspaceMenu = (
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
      {session.user.workspaces.length > 0 && (
        <div className="my-1 h-px bg-border" />
      )}
      <button
        type="button"
        onClick={() => {
          setWorkspaceMenuOpen(false);
          setCreateWorkspaceOpen(true);
        }}
        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold text-text-secondary transition-colors hover:bg-surface-secondary hover:text-foreground"
      >
        <Plus size={14} className="shrink-0" />
        <span>Create workspace</span>
      </button>
    </div>
  );
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
  // The design tiles both the header breadcrumb and the sidebar switcher with
  // the workspace's own initial rather than a generic mark.
  const workspaceInitial = (currentWorkspace?.name || "W")
    .trim()
    .slice(0, 1)
    .toUpperCase();
  // The workspace's own mark: its logo when it has one, its initial when it
  // does not. The header breadcrumb and the sidebar switcher both draw it, at
  // different sizes, and they should not drift apart.
  const workspaceMark = (sizeClass, textClass) =>
    currentWorkspace?.logo_url ? (
      <img
        src={currentWorkspace.logo_url}
        alt=""
        className={`${sizeClass} shrink-0 rounded-badge object-contain`}
      />
    ) : (
      <span
        aria-hidden="true"
        className={`flex ${sizeClass} shrink-0 items-center justify-center rounded-badge bg-primary ${textClass} font-bold text-primary-foreground`}
      >
        {workspaceInitial}
      </span>
    );

  const closeProfileMenu = () => {
    setProfileMenuOpen(false);
    setSidebarProfileOpen(false);
  };

  // One account menu, three triggers that the design draws - the desktop header
  // avatar, the mobile header avatar, and the sidebar overflow button. Every
  // call site wraps the shared body in its own positioned container, so actions
  // close whichever surface opened them.
  const renderProfileMenuBody = ({ showWorkspaceSwitcher = false } = {}) => (
    <>
      <div className="border-b border-border-light px-3 py-2.5">
        <p className="truncate text-sm font-semibold text-text-primary">
          {currentUserName}
        </p>
        <p className="truncate text-xs text-text-muted">{session.user.email}</p>
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
      {showWorkspaceSwitcher && session.user.workspaces.length > 1 && (
        <button
          type="button"
          onClick={() => {
            setMobileOpen(true);
            closeProfileMenu();
          }}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-text-secondary hover:bg-surface-secondary"
        >
          <Building2 size={16} /> Switch workspace
        </button>
      )}
      <button
        type="button"
        onClick={() => {
          setAiLauncherVisibility(!aiLauncherHidden);
          closeProfileMenu();
        }}
        className="flex min-h-11 w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-text-secondary hover:bg-surface-secondary"
      >
        {aiLauncherHidden ? <Sparkles size={16} /> : <EyeOff size={16} />}
        {aiLauncherHidden ? "Show Zuri button" : "Hide Zuri button"}
      </button>
      <button
        type="button"
        onClick={() => {
          setActive("Settings");
          closeProfileMenu();
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
    </>
  );
  const currentUserPresence = session.user.presence || "available";
  const updateSessionUser = (patch) =>
    setSession((current) => ({
      ...current,
      user: { ...current.user, ...patch },
    }));
  const updateWorkspaceLogo = (workspaceId, logoUrl) =>
    setSession((current) => ({
      ...current,
      user: {
        ...current.user,
        workspaces: (current.user.workspaces || []).map((workspace) =>
          String(workspace.id) === String(workspaceId)
            ? { ...workspace, logo_url: logoUrl }
            : workspace,
        ),
      },
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
      taskIsAssignedTo(task, session.user.id) &&
      (!task.due_date || task.due_date <= today),
  );
  const myTodayTasks = myTasks;
  const myCompletedTaskCount = myTodayTasks.filter(
    (task) => task.status === "done",
  ).length;
  const activityNotifications = workspaceData.activityNotifications || [];
  const unreadConversationNotifications = (workspaceData.conversationNotifications || []).filter(
    (notification) => isConversationNotification(notification) && !notification.read,
  );
  // The badge reads the server's totals, which cover every unread row. The list
  // these badges sit next to is one capped page, so its length is only a
  // fallback for a payload that predates the totals.
  const unreadConversationCount =
    workspaceData.notificationCounts?.conversation ??
    unreadConversationNotifications.length;
  const unreadActivityNotificationCount =
    workspaceData.notificationCounts?.activity ??
    activityNotifications.filter((notification) => !notification.read).length;
  // The two halves of the conversation total, kept apart so Channels and Chats
  // can each say how much is waiting on them.
  const unreadChannelCount =
    workspaceData.notificationCounts?.channel ??
    (workspaceData.conversationNotifications || []).filter(
      (notification) => notification.target_type === "chat_channel" && !notification.read,
    ).length;
  const unreadDirectCount =
    workspaceData.notificationCounts?.direct ??
    (workspaceData.conversationNotifications || []).filter(
      (notification) => notification.target_type === "direct_conversation" && !notification.read,
    ).length;
  const conversationCountKnown = Number.isFinite(
    workspaceData.notificationCounts?.conversation,
  );
  const activityCountKnown = Number.isFinite(
    workspaceData.notificationCounts?.activity,
  );
  // Newest first. The panel is a list to pick from, so it keeps every unread
  // alert rather than the single newest one it used to jump straight into.
  const conversationAlerts = [...unreadConversationNotifications].sort(
    (left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime(),
  );
  const toggleMessages = (origin = "header") => {
    setNotificationOpen(false);
    setMessagesOrigin(origin);
    setMessagesOpen((current) => !current);
  };

  // Grouped by what they're for rather than dumped in one flat list: the two
  // screens someone opens every day, the screens where work actually gets
  // planned/tracked, the screens for talking to teammates, and the screens
  // you check but rarely act from.
  const navGroups = [
    {
      heading: "Overview",
      items: [
        { label: "Today", icon: Home },
        { label: "My tasks", icon: ClipboardList },
        { label: "My planner", icon: List },
        { label: "Daily operations", icon: RefreshCw },
        { label: "Team", icon: Users },
      ],
    },
    {
      heading: "Collaborate",
      items: [
        {
          label: "Channels",
          icon: Hash,
          badge: unreadChannelCount,
          badgeTone: "info",
        },
        {
          label: "Chats",
          icon: MessageSquare,
          badge: unreadDirectCount,
          badgeTone: "info",
        },
        {
          label: "Follow-up",
          icon: Flag,
          badge: workspaceData.followUps.filter(
            (item) => item.status !== "completed",
          ).length,
          badgeTone: "warning",
        },
        { label: "Check-ins", icon: Check },
      ],
    },
    {
      heading: "Work",
      items: [
        { label: "Planner", icon: LayoutGrid },
        { label: "Projects", icon: Folder },
        { label: "Calendar", icon: CalendarDays },
        { label: "Import data", icon: Upload },
      ],
    },
    {
      heading: "Insights",
      items: [
        { label: "Reports", icon: BarChart3 },
        { label: "Activity", icon: ActivityIcon },
      ],
    },
  ];
  // What's new, Install app and Screen sharing moved to Settings under the same
  // Resources heading. They are still their own pages and still routed by the
  // same labels, so notification deep links are unaffected; only the way in
  // changed.

  // -- Mobile TabBar - the design's four destinations along the bottom edge,
  //    with "More" as the fifth. The pages are looked up in navGroups so labels
  //    and icons stay in one place; "More" slides the sidebar in, which is how
  //    the rest of the nav stays reachable on a phone.
  const navItemsByLabel = new Map(
    navGroups.flatMap((group) => group.items).map((item) => [item.label, item]),
  );
  const mobileTabItems = [
    ["Today", "Today"],
    // The design labels this tab "Tasks"; the page it opens is "My tasks".
    ["Tasks", "My tasks"],
    ["Planner", "Planner"],
    ["Chats", "Chats"],
  ]
    .map(([label, page]) => {
      const item = navItemsByLabel.get(page);
      if (!item) return null;
      // Chats opens the chat panel rather than the Chats page, which is what the
      // bottom bar did before the design; the page is reachable from "More".
      return label === "Chats"
        ? { ...item, label, onSelect: () => toggleMessages("nav") }
        : { ...item, label };
    })
    .filter(Boolean);
  const renderMobileTab = ({ label, icon: Icon, active: itemActive, onSelect }) => {
    const isItemActive = itemActive ?? active === label;
    return (
      <button
        type="button"
        key={label}
        onClick={onSelect || (() => setActive(label))}
        aria-current={isItemActive ? "page" : undefined}
        className={cn(
          "flex h-full min-w-0 max-w-[66px] flex-1 flex-col items-center gap-1 pt-3.5 font-medium transition-colors",
          isItemActive
            ? "text-[var(--pencil-bronze-soft)]"
            : "text-[#93B4D4] hover:text-white",
        )}
      >
        <Icon size={20} className="shrink-0" aria-hidden="true" />
        <span className="max-w-full truncate text-[10px] leading-none">
          {label}
        </span>
      </button>
    );
  };

  // The search results list is one piece of markup with two homes - the desktop
  // header field and the mobile AppBar's search row - so it is written once.
  // Both are gated on the same state and each sits inside a container that is
  // display:none at the other's width, so only one is ever on screen.
  const renderSearchResults = () => (
    <div
      className="absolute left-0 right-0 top-full z-[60] mt-2 max-h-96 overflow-y-auto rounded-xl border border-border bg-surface shadow-elevated"
      onMouseDown={(event) => event.preventDefault()}
    >
      {globalSearchLoading && (
        <p className="px-4 py-3 text-xs text-text-muted">Searching…</p>
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
  );

  // Same again for the activity list: the desktop header and mobile AppBar both
  // anchor it under their bell. Each caller supplies its own positioning class.
  const renderNotificationsPanel = (positionClass, panelRef) => (
    <div
      ref={panelRef}
      className={cn(
        "workspace-popup-panel z-[60] mt-2 max-w-md origin-top-right animate-fade-in",
        positionClass,
      )}
    >
      <div className="workspace-popup-header">
        <span className="workspace-popup-mark" aria-hidden="true">
          <Bell size={18} />
        </span>
        <span className="workspace-popup-heading">
          <h2>Notifications</h2>
          <p>Workspace updates outside chats and channels.</p>
        </span>
        <button
          type="button"
          onClick={markNotificationsRead}
          className="workspace-popup-action"
          aria-label="Mark all read"
          title="Mark all read"
        >
          <Check size={14} aria-hidden="true" />
          <span className="hidden sm:inline">Mark all read</span>
        </button>
      </div>
      <div className="workspace-popup-list">
        {activityNotifications.length ? (
          activityNotifications.slice(0, 5).map((notification) => {
            const visual = notificationPanelVisual(notification);
            const TypeIcon = visual.Icon;
            return (
              <button
                type="button"
                key={notification.id}
                onClick={() => openNotification(notification)}
                aria-label={`Open ${notification.title}`}
                className={`workspace-popup-row ${notification.read ? "is-read" : "is-unread"}`}
              >
                <span
                  className={`workspace-popup-row-icon workspace-popup-icon-${visual.tone}`}
                  aria-hidden="true"
                >
                  <TypeIcon size={17} strokeWidth={1.8} />
                </span>
                <span className="workspace-popup-copy">
                  <span className="text-xs font-semibold leading-4 text-text-primary">
                    {notification.title}
                  </span>
                  <span className="line-clamp-2 text-[11px] leading-4 text-text-muted">
                    {notification.body || "Workspace update"}
                  </span>
                  <span className="workspace-popup-meta">
                    <time
                      className="flex items-center gap-1 text-[10px] font-medium tabular-nums text-text-muted"
                      dateTime={notification.created_at}
                    >
                      <Clock3 size={10} aria-hidden="true" />
                      {formatDateTime(notification.created_at)}
                    </time>
                    {!notification.read && (
                      <span className="workspace-popup-state">Unread</span>
                    )}
                  </span>
                </span>
                <span className="workspace-popup-row-dot" aria-hidden="true" />
              </button>
            );
          })
        ) : (
          <div className="workspace-popup-empty">
            <EmptyState text="No workspace activity yet." />
          </div>
        )}
      </div>
      <div className="workspace-popup-footer">
        <button
          type="button"
          onClick={() => {
            setNotificationOpen(false);
            setActive("Notifications");
          }}
          className="workspace-popup-footer-button is-primary"
        >
          <span>View all workspace activity</span>
          <ArrowUpRight size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  );

  // One panel, two places to stand it. The header owns a backdrop-filter, which
  // makes it the containing block for its fixed descendants, so a panel rendered
  // inside it is measured against the header rather than the viewport. That is
  // fine while it hangs off the header, and wrong the moment the mobile pill
  // opens it, because the panel has to sit just above the pill at the bottom of
  // the screen. So the pill's panel is rendered outside the header, and only the
  // bottom offset differs between the two.
  const renderMessagesPanel = (position) => (
    <div
      className={cn(
        "workspace-popup-panel z-[60] animate-fade-in",
        position,
      )}
    >
      <div className="workspace-popup-header">
        <span className="workspace-popup-mark is-messages" aria-hidden="true">
          <MessageSquare size={18} />
        </span>
        <span className="workspace-popup-heading">
          <h2>Messages</h2>
          <p>Channel and direct conversations.</p>
        </span>
        <span className="workspace-popup-count">
          {unreadConversationCount} unread
        </span>
      </div>
      <div className="workspace-popup-list">
        {conversationAlerts.length ? (
          conversationAlerts.slice(0, 6).map((notification) => (
            <button
              type="button"
              key={notification.id}
              onClick={() => openNotification(notification)}
              aria-label={`Open ${notification.title}`}
              className={`workspace-popup-row ${notification.read ? "is-read" : "is-unread"}`}
            >
              <span
                className={`workspace-popup-row-icon workspace-popup-icon-${notification.target_type === "chat_channel" ? "channel" : "direct"}`}
                aria-hidden="true"
              >
                {notification.target_type === "chat_channel" ? (
                  <Hash size={17} strokeWidth={1.8} />
                ) : (
                  <MessageSquare size={17} strokeWidth={1.8} />
                )}
              </span>
              <span className="workspace-popup-copy">
                <span className="text-xs font-semibold leading-4 text-text-primary">
                  {notification.title}
                </span>
                {notification.body && (
                  <span className="line-clamp-2 text-[11px] leading-4 text-text-muted">
                    {notification.body}
                  </span>
                )}
                <span className="workspace-popup-meta">
                  <time className="flex items-center gap-1 text-[10px] font-medium tabular-nums text-text-muted" dateTime={notification.created_at}>
                    <Clock3 size={10} aria-hidden="true" />
                    {formatDateTime(notification.created_at)}
                  </time>
                  <span className="workspace-popup-kind">
                    {notification.target_type === "chat_channel" ? "Channel" : "Direct"}
                  </span>
                </span>
              </span>
              <span className="workspace-popup-row-dot" aria-hidden="true" />
            </button>
          ))
        ) : (
          <div className="workspace-popup-empty">
            <EmptyState text="No unread messages." />
          </div>
        )}
      </div>
      {/* Both halves of the conversation total get a way out of this panel. A
          channel alert used to be listed with nowhere to go but Chats, which is
          a different screen from the one the alert came from. Each link carries
          what is waiting for it so the two totals stay legible. */}
      <div className="workspace-popup-footer">
        <button
          type="button"
          onClick={() => {
            setMessagesOpen(false);
            setActive("Channels");
          }}
          className="workspace-popup-footer-button"
        >
          Open Channels{unreadChannelCount > 0 ? ` (${unreadChannelCount})` : ""}
        </button>
        <button
          type="button"
          onClick={() => {
            setMessagesOpen(false);
            setActive("Chats");
          }}
          className="workspace-popup-footer-button"
        >
          Open Chats{unreadDirectCount > 0 ? ` (${unreadDirectCount})` : ""}
        </button>
      </div>
    </div>
  );

  return (
    <div
      className={cn(
        "workspace-app-shell flex h-dvh overflow-hidden bg-surface-secondary",
        mobileOpen && "is-mobile-nav-open",
      )}
    >
      <Toaster
        position="top-right"
        containerClassName="workspace-toaster"
        toastOptions={{
          className: "workspace-toast",
          duration: 4000,
          style: {
            background: "rgba(14, 42, 71, 0.94)",
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
          />
        </Suspense>
      )}
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>

      {/* -- Mobile overlay - stays mounted and fades in step with the drawer's
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

      {/* -- Sidebar -- */}
      <aside
        className={cn(
          "mobile-nav-drawer fixed inset-y-0 left-0 z-50 flex flex-col bg-navy text-white transition-all duration-200 lg:relative",
          "w-[264px]",
          railCollapsed && "lg:w-[4.5rem]",
          railCollapsed && "is-sidebar-collapsed",
          mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        )}
      >
        {/* Logo / brand - desktop only, and the workspace switcher. The header
            used to carry this; it now holds only the page title and search.
            Collapsed to the rail the logo alone is the trigger. */}
        <div
          className={cn(
            "hidden flex-col lg:flex",
            railCollapsed
              ? "items-center justify-center gap-4 px-0 py-5"
              : "items-stretch gap-3 px-5 pt-5",
          )}
        >
          {railCollapsed ? (
            <div className="relative" ref={workspaceMenuRef}>
              <button
                type="button"
                onClick={() => setWorkspaceMenuOpen((current) => !current)}
                className="flex size-9 items-center justify-center rounded-icon transition-colors hover:bg-surface-secondary"
                aria-haspopup="true"
                aria-expanded={workspaceMenuOpen}
                aria-label={`Workspace: ${currentWorkspace?.name || "Workspace"}`}
                title={currentWorkspace?.name || "Workspace"}
              >
                <img
                  src={currentWorkspace?.logo_url || "/tijha-logo.png"}
                  alt=""
                  className="sidebar-brand-logo size-8 shrink-0 rounded-icon object-contain"
                />
              </button>
              {workspaceMenuOpen && workspaceMenu}
            </div>
          ) : (
            <>
              {/* The product mark sits on its own row and the workspace switcher
                  on the next, the way the design's sidebar stacks them. Sharing
                  one row squeezed the switcher to half the rail and left the
                  workspace name as the only thing naming the product. */}
              <div className="flex items-center gap-2">
                <img
                  src="/tijha-logo.png"
                  alt="TijhaBooks"
                  className="sidebar-brand-logo size-8 shrink-0 rounded-icon object-contain"
                />
                <span className="truncate text-[15px] font-bold tracking-[-0.2px] text-text-primary">
                  WorkSpace
                </span>
              </div>

              <div className="relative" ref={workspaceMenuRef}>
                <button
                  type="button"
                  onClick={() => setWorkspaceMenuOpen((current) => !current)}
                  className="flex h-[42px] w-full items-center gap-2 rounded-[10px] border border-border bg-background pl-2 pr-2 text-left transition-colors hover:bg-surface-secondary"
                  aria-haspopup="true"
                  aria-expanded={workspaceMenuOpen}
                >
                  {workspaceMark("size-6", "text-[12px]")}
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-text-primary">
                    {currentWorkspace?.name || "Workspace"}
                  </span>
                  <ChevronDown size={16} className="shrink-0 text-text-muted" />
                </button>
                {workspaceMenuOpen && workspaceMenu}
              </div>

              {/* Inset rather than a border on the block, so it spans the same
                  232px as the nav rows beneath it. */}
              <div className="-mx-1 h-px bg-border" />
            </>
          )}
        </div>

        {/* Mobile drawer header - carries the workspace switcher, since the
            header no longer does and the sidebar brand block is desktop only.
            Close button sits outside the switcher so it survives on phones. */}
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3 lg:hidden">
          <div className="relative min-w-0" ref={workspaceMenuRefMobile}>
            <button
              type="button"
              onClick={() => setWorkspaceMenuOpen((current) => !current)}
              className="flex min-w-0 items-center gap-1.5 rounded-control py-1 text-sm font-semibold text-text-primary transition-colors hover:text-text-muted"
              aria-haspopup="true"
              aria-expanded={workspaceMenuOpen}
            >
              <span className="truncate">
                {currentWorkspace?.name || "Workspace"}
              </span>
              <ChevronDown size={14} className="shrink-0" />
            </button>
            {workspaceMenuOpen && workspaceMenu}
          </div>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            className="-mr-2 flex size-11 items-center justify-center rounded-control text-text-muted hover:bg-surface-secondary hover:text-text-primary"
            aria-label="Close sidebar"
          >
            <X size={20} />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-4 pb-2 pt-4">
          {navGroups.map((group) => (
            <div className="mb-5 last:mb-0" key={group.heading}>
              {/* The design stores these labels in title case and renders them
                  upper at 1.6px tracking, which is what text-overline carries -
                  reading the node's raw text rather than its textCase would get
                  the case wrong. */}
              {!railCollapsed && (
                <p className="mb-1.5 px-3 text-overline uppercase text-text-muted">
                  {group.heading}
                </p>
              )}
              <ul className="space-y-0.5">
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
                        "group relative flex h-10 w-full items-center gap-2.5 rounded-icon px-3 text-sm leading-5 transition-colors",
                        active === label
                          ? "bg-selected font-semibold text-primary"
                          : "text-text-secondary hover:bg-surface-secondary hover:text-text-primary",
                        railCollapsed && "justify-center px-0",
                      )}
                    >
                      {/* The design marks the open item with a bar as well as a
                          fill, so the state survives for anyone who cannot pick
                          the two greys apart. Navy in light, the theme's own
                          accent in dark, where navy would vanish into the fill. */}
                      {active === label && (
                        <span
                          aria-hidden="true"
                          className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-chip bg-primary"
                        />
                      )}
                      <Icon size={20} className="shrink-0" />
                      {!railCollapsed && (
                        <span className="truncate">{label}</span>
                      )}
                      {!railCollapsed && badge > 0 && (
                        <span
                          className={cn(
                            "ml-auto flex h-[18px] min-w-6 items-center justify-center rounded-[9px] px-1.5 text-[11px] font-bold text-white",
                            badgeTone === "info"
                              ? "bg-primary"
                              : badgeTone === "warning"
                                ? "bg-warning-fill"
                                : "bg-danger",
                          )}
                        >
                          {notificationBadgeLabel(badge, 9)}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        {/* Account block - the design ends the sidebar on the signed-in user
            rather than on a Settings row. Settings is the first item in this
            menu, so the destination the old row carried is still one click
            away, and the collapse control has moved up to the brand row. */}
        <div className="sidebar-account px-4 pb-3 pt-3">
          <div className="h-px bg-border" />
          <div className="relative mt-3 flex items-center gap-2.5" ref={sidebarProfileRef}>
            {railCollapsed ? (
              <button
                type="button"
                onClick={() => setSidebarProfileOpen((current) => !current)}
                className="flex w-full items-center justify-center"
                aria-haspopup="true"
                aria-expanded={sidebarProfileOpen}
                aria-label={`More account options for ${currentUserName}`}
              >
                <Avatar
                  name={currentUserName}
                  avatarUrl={currentUserAvatarUrl}
                  presence={currentUserPresence}
                  className="shell-avatar-rail"
                />
              </button>
            ) : (
              <>
                <Avatar
                  name={currentUserName}
                  avatarUrl={currentUserAvatarUrl}
                  presence={currentUserPresence}
                  className="shell-avatar-expanded"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-text-primary">
                    {currentUserName}
                  </span>
                  <span className="block truncate text-caption text-text-muted">
                    {currentWorkspace?.role || "Member"}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setSidebarProfileOpen((current) => !current)}
                  aria-haspopup="true"
                  aria-expanded={sidebarProfileOpen}
                  aria-label={`More account options for ${currentUserName}`}
                  className="flex size-6 shrink-0 items-center justify-center rounded-chip text-text-muted transition-colors hover:bg-surface-secondary hover:text-text-primary"
                >
                  <MoreHorizontal size={20} />
                </button>
              </>
            )}
            {sidebarProfileOpen && (
              <div
                className={cn(
                  "absolute z-[60] max-h-[calc(100dvh-5rem)] w-56 max-w-[calc(100vw-2rem)] overflow-y-auto animate-fade-in rounded-xl border border-border bg-surface p-1.5 shadow-elevated",
                  // Expanded, the menu rises from the account row it belongs to.
                  // Collapsed, that row is a 40px column against the left edge
                  // of the screen, so a 224px menu anchored to its right runs
                  // off the viewport; it opens alongside the rail instead, the
                  // way the expand flyout already does.
                  railCollapsed
                    ? "bottom-0 left-full ml-5"
                    : "bottom-full right-0 mb-2",
                )}
              >
                {renderProfileMenuBody()}
              </div>
            )}
          </div>
        </div>

        {!mobileOpen && (
          <button
            type="button"
            className={`sidebar-expand-flyout${railCollapsed ? ' is-collapsed' : ' is-expanded'}`}
            onClick={() => setSidebarCollapsed((current) => !current)}
            aria-expanded={!sidebarCollapsed}
            aria-label={railCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={railCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {railCollapsed ? <ChevronRight size={16} aria-hidden="true" /> : <ChevronLeft size={16} aria-hidden="true" />}
          </button>
        )}
      </aside>

      {/* -- Main -- */}
      <div className="shell-main flex flex-1 flex-col min-w-0">
        {/* -- Mobile AppBar - the design's phone bar. It is one 56px row with
            the page title at 16 and five 28px controls whose right edge lands
            on 374, which is the 390 frame less its 16 margin. Hidden at lg,
            where the header below takes over. */}
        <div className="flex h-14 shrink-0 items-center gap-1 border-b border-border bg-surface px-4 lg:hidden">
          {pageHistory.length > 0 && (
            <button
              type="button"
              onClick={goBack}
              aria-label={backLabel}
              className="-ml-1 flex size-7 shrink-0 items-center justify-center rounded-badge text-text-secondary transition-colors hover:bg-surface-secondary hover:text-text-primary"
            >
              <ChevronLeft size={20} />
            </button>
          )}
          <span className="min-w-0 flex-1 truncate text-[16px] font-semibold text-text-primary">
            {active}
          </span>

          <div className="shell-appbar-controls flex shrink-0 items-center gap-2">
            {/* The design draws the search as an icon rather than a field, so
                tapping it reveals the field in a row under the bar. It is the
                same query as the desktop header's - one state, two fields, and
                never both on screen. */}
            <button
              type="button"
              onClick={() => setMobileSearchOpen((current) => !current)}
              aria-expanded={mobileSearchOpen}
              aria-label="Open search"
              className="flex size-7 shrink-0 items-center justify-center rounded-badge text-text-secondary transition-colors hover:bg-surface-secondary hover:text-text-primary"
            >
              <Search size={20} />
            </button>

            {/* The AppBar's assistant is not the header's Assistant button. The
                design strokes this one with its navy on the navy tint, where the
                header button uses the info pair. bg-selected is the app's name
                for that tint and it has a dark counterpart, which a hardcoded
                #E7EEF6 would not. */}
            {!aiLauncherHidden && !aiMinimized && activeWorkspaceId && (
              <button
                type="button"
                onClick={() => setAiFlyoutOpen(true)}
                className="mobile-nav-zuri flex size-7 shrink-0 items-center justify-center rounded-badge bg-selected text-primary transition-colors hover:bg-alert-info-stroke/40"
                aria-label="Ask Zuri"
                aria-haspopup="dialog"
                title="Ask Zuri"
              >
                <Sparkles size={20} />
              </button>
            )}

            <button
              type="button"
              onClick={() =>
                setTheme(resolvedTheme === "dark" ? "light" : "dark")
              }
              aria-label={`Switch to ${resolvedTheme === "dark" ? "light" : "dark"} mode`}
              className="flex size-7 shrink-0 items-center justify-center rounded-badge text-text-secondary transition-colors hover:bg-surface-secondary hover:text-text-primary"
            >
              {resolvedTheme === "dark" ? <Moon size={20} /> : <Sun size={20} />}
            </button>

            <div className="relative shrink-0">
              <button
                ref={appbarNotificationRef}
                type="button"
                onClick={() => {
                  setNotificationOrigin("appbar");
                  setNotificationOpen((current) => !current);
                }}
                className="relative flex size-7 shrink-0 items-center justify-center rounded-badge text-text-secondary transition-colors hover:bg-surface-secondary hover:text-text-primary"
                aria-label="Open workspace activity"
                aria-expanded={notificationOpen && notificationOrigin === "appbar"}
              >
                <Bell size={20} />
                {/* The design puts the count on the bell's own 28px box rather
                    than on the bar, a 14px roundel against that box's top-right
                    corner, and draws no ring around it. */}
                <NotificationIndicator
                  count={unreadActivityNotificationCount}
                  countKnown={activityCountKnown}
                  max={9}
                  label="workspace notifications"
                  className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-danger px-0.5 text-[9px] font-bold leading-none text-white"
                  dotClassName="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-danger ring-2 ring-surface"
                />
              </button>
              {notificationOpen &&
                notificationOrigin === "appbar" &&
                renderNotificationsPanel(
                  "absolute right-0 top-full w-[min(calc(100vw-4.5rem),380px)]",
                  notificationPanelRef,
                )}
            </div>

            <button
              ref={appbarProfileRef}
              type="button"
              onClick={() => {
                setProfileMenuOrigin("appbar");
                setProfileMenuOpen((current) => !current);
              }}
              aria-haspopup="true"
              aria-expanded={profileMenuOpen}
              aria-label={`Open account menu for ${currentUserName}`}
              className="shell-appbar-avatar-button flex size-8 shrink-0 items-center justify-center rounded-full"
            >
              <Avatar
                name={currentUserName}
                avatarUrl={currentUserAvatarUrl}
                presence={currentUserPresence}
                className="shell-avatar-mobile"
              />
            </button>
          </div>
        </div>

        {/* The revealed search field. Rendered under the bar rather than in it,
            because the design's bar holds an icon at that slot and nothing else
            - a field dropped in beside it would push all five controls off the
            right edge. The field itself is the design's mobile search: 40 tall,
            radius 12, on #F9FAFB with a hairline stroke, icon at 12 and the
            hint at 40, and 16 of padding either side. */}
        {mobileSearchOpen && (
          <div
            className="relative z-30 border-b border-border bg-surface px-4 py-4 lg:hidden"
            ref={searchRef}
          >
            <div className="relative flex h-10 w-full items-center rounded-xl border border-border bg-background transition-colors focus-within:border-info">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-text-muted" />
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onFocus={() => {
                  if (globalSearchResults.length) setGlobalSearchOpen(true);
                }}
                placeholder="Search Workspace"
                aria-label="Search workspace"
                autoFocus
                className="shell-search h-full w-full bg-transparent pl-10 pr-4 text-[13px] text-text-primary outline-none placeholder:text-text-muted"
              />
              {globalSearchOpen &&
                searchQuery.trim().length >= 2 &&
                renderSearchResults()}
            </div>
          </div>
        )}

        {profileMenuOpen && profileMenuOrigin === "appbar" && (
          <div
            ref={appbarProfileMenuRef}
            className="fixed left-4 right-4 top-[60px] z-[60] mt-2 max-h-[calc(100dvh-5rem)] w-auto max-w-[calc(100vw-2rem)] animate-fade-in overflow-y-auto rounded-xl border border-border bg-surface p-1.5 shadow-elevated lg:hidden"
          >
            {renderProfileMenuBody({ showWorkspaceSwitcher: true })}
          </div>
        )}

        {/* The design gives phones their own bar - a menu button, the page title,
            and four controls - so this header is desktop only and the AppBar
            above carries the small screens. */}
      <header className="shell-header relative z-30 hidden h-16 shrink-0 items-center border-b border-border bg-surface px-4 lg:flex lg:gap-6 lg:px-6">
          {/* The column is a fixed 272px so the search after it starts on the
              design's 320px, and the utility cluster is pushed right by ml-auto
              rather than by a matching flex-1 on this side. */}
          <div className="shell-header-context min-w-0 items-center gap-2">
            {pageHistory.length > 0 && (
              <button
                type="button"
                onClick={goBack}
                aria-label={backLabel}
                title={backLabel}
                className="flex size-7 shrink-0 items-center justify-center rounded-badge text-text-secondary transition-colors hover:bg-surface-secondary hover:text-text-primary"
              >
                <ChevronLeft size={18} />
              </button>
            )}
            {workspaceMark("size-7", "text-body-compact")}
            <span className="min-w-0 truncate text-label text-text-primary">
              {currentWorkspace?.name || "Workspace"}
            </span>
            <ChevronRight
              size={14}
              aria-hidden="true"
              className="shrink-0 text-text-muted"
            />
            <span className="truncate text-label font-semibold text-text-primary">
              {active}
            </span>
          </div>

          <div className="shell-header-search relative min-w-0" ref={searchRef}>
            {/* The field surface sits on the wrapper, not the input. Every plain
                input in this app is repainted by an !important soft-field rule
                further down the stylesheet, so an input styled here would look
                right in the markup and wrong on screen. */}
            <div className="relative flex h-10 w-full items-center rounded-control border border-border bg-background transition-colors focus-within:border-info">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-text-muted" />
              <input
                ref={searchInputRef}
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onFocus={() => {
                  if (globalSearchResults.length) setGlobalSearchOpen(true);
                }}
                placeholder="Search Workspace"
                aria-label="Search workspace"
                className="shell-search h-full w-full bg-transparent pl-[42px] pr-12 text-sm text-text-primary outline-none placeholder:text-text-muted"
              />
              {/* The design marks up a "/" key hint. It is a real shortcut, so
                  the hint is drawn from the handler below rather than pasted in
                  as decoration that does nothing. */}
              <kbd
                aria-hidden="true"
                className="pointer-events-none absolute right-3 hidden h-5 w-7 items-center justify-center rounded-badge border border-border bg-card text-[11px] font-medium text-text-muted md:flex"
              >
                /
              </kbd>
              {globalSearchOpen &&
                searchQuery.trim().length >= 2 &&
                renderSearchResults()}
            </div>
          </div>

          <div className="shell-header-actions ml-auto flex min-w-0 shrink-0 items-center gap-1">
            {/* The design's Assistant lives in the header rather than on a
                launcher floating over the page, and opens the same flyout. */}
            <button
              type="button"
              onClick={() => {
                setAiMinimized(false);
                setAiLauncherVisibility(false);
                setAiFlyoutOpen(true);
              }}
              className="shell-header-assistant hidden size-9 items-center justify-center gap-2 rounded-[10px] border border-alert-info-stroke bg-alert-info-fill text-body-compact font-medium text-assistant-accent transition-colors hover:bg-alert-info-stroke/40 lg:flex"
              aria-haspopup="dialog"
              aria-label="Open Zuri"
              title="Ask Zuri"
            >
              <Sparkles size={18} />
              <span>Assistant</span>
            </button>

            <button
              type="button"
              onClick={() =>
                setTheme(resolvedTheme === "dark" ? "light" : "dark")
              }
              aria-label={`Switch to ${resolvedTheme === "dark" ? "light" : "dark"} mode`}
              className="shell-header-icon flex size-9 items-center justify-center rounded-[10px] text-text-secondary transition-colors hover:bg-surface-secondary hover:text-text-primary"
            >
              {resolvedTheme === "dark" ? <Moon size={20} /> : <Sun size={20} />}
            </button>

            <button
              type="button"
              onClick={() => setActive("Help")}
              className="shell-header-icon hidden size-9 items-center justify-center rounded-[10px] text-text-secondary transition-colors hover:bg-surface-secondary hover:text-text-primary sm:flex"
              aria-label="Help"
              title="Help"
            >
              <Info size={20} />
            </button>

            <div className="relative" ref={messagesRef}>
              <button
                type="button"
                onClick={() => toggleMessages("header")}
                className="shell-header-icon relative hidden size-9 items-center justify-center rounded-[10px] text-text-secondary transition-colors hover:bg-surface-secondary hover:text-text-primary sm:flex"
                aria-label="Open messages"
                title="Open chats and channels"
              >
                <MessageSquare size={20} />
                <NotificationIndicator
                  count={unreadConversationCount}
                  countKnown={conversationCountKnown}
                  label="messages"
                  className="absolute right-0 top-0 min-w-4 rounded-full bg-danger px-1 text-center text-[10px] font-bold text-white ring-2 ring-surface"
                  dotClassName="absolute right-0.5 top-0.5 size-2.5 rounded-full bg-danger ring-2 ring-surface"
                />
              </button>
              {messagesOpen &&
                messagesOrigin === "header" &&
                renderMessagesPanel(
                  "fixed left-4 right-4 top-16 mt-2 w-auto max-w-md sm:absolute sm:left-auto sm:right-0 sm:top-full sm:w-[380px]",
                )}
            </div>

            <div className="relative" ref={notifRef}>
              <button
                type="button"
                onClick={() => {
                  setNotificationOrigin("header");
                  setNotificationOpen((current) => !current);
                }}
                className="shell-header-icon relative flex size-9 items-center justify-center rounded-[10px] text-text-secondary transition-colors hover:bg-surface-secondary hover:text-text-primary"
                aria-label="Open workspace activity notifications"
              >
                <Bell size={20} />
                <NotificationIndicator
                  count={unreadActivityNotificationCount}
                  countKnown={activityCountKnown}
                  label="workspace notifications"
                  className="absolute right-0 top-0 min-w-4 rounded-full bg-danger px-1 text-[10px] font-bold text-white ring-2 ring-surface"
                  dotClassName="absolute right-0.5 top-0.5 size-2.5 rounded-full bg-danger ring-2 ring-surface"
                />
              </button>
              {notificationOpen &&
                notificationOrigin === "header" &&
                renderNotificationsPanel(
                  "fixed left-4 right-4 top-16 sm:absolute sm:left-auto sm:right-0 sm:top-full sm:w-[380px]",
                )}
            </div>

            {/* The design leaves 12px before this rule and 23px after it, so
                the avatar lands on 1096 rather than on the cluster's own gap. */}
            <span
              aria-hidden="true"
              className="shell-header-divider hidden h-7 w-px shrink-0 bg-border 2xl:block"
            />

            <div className="relative" ref={profileMenuRef}>
              <button
                type="button"
                onClick={() => {
                  setProfileMenuOrigin("header");
                  setProfileMenuOpen((current) => !current);
                }}
                aria-haspopup="true"
                aria-expanded={profileMenuOpen}
                aria-label={`Account menu for ${currentUserName}`}
                className="shell-header-account flex items-center gap-2 rounded-control py-1 pl-1 transition-colors hover:bg-surface-secondary"
              >
                <Avatar
                  name={currentUserName}
                  avatarUrl={currentUserAvatarUrl}
                  presence={currentUserPresence}
                  className="shell-avatar-header"
                />
                <span className="shell-header-account-name hidden max-w-36 truncate text-label font-semibold text-text-primary">
                  {currentUserName}
                </span>
                <ChevronDown
                  size={16}
                  aria-hidden="true"
                  className="hidden shrink-0 text-text-muted sm:block"
                />
              </button>

              {profileMenuOpen && profileMenuOrigin === "header" && (
                <div className="absolute right-0 top-full z-[60] mt-2 max-h-[calc(100dvh-5rem)] w-56 max-w-[calc(100vw-2rem)] overflow-y-auto animate-fade-in rounded-xl border border-border bg-surface p-1.5 shadow-elevated">
                  {renderProfileMenuBody()}
                </div>
              )}
            </div>
          </div>
        </header>
        <main
          id="main-content"
          className="main-content flex-1 overflow-y-auto min-w-0"
          tabIndex="-1"
        >
          {/* Bottom padding clears the fixed mobile TabBar; desktop has none. */}
          <div className="page-content pb-24 lg:pb-0">
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
              <Alert
                tone="danger"
                title="Workspace data could not be loaded"
                action={
                  <button
                    className="secondary-button"
                    onClick={() => setWorkspaceReload((current) => current + 1)}
                  >
                    Retry
                  </button>
                }
              >
                {workspaceError}
              </Alert>
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
                chatThreadRequest={chatThreadRequest}
                onWhatsNewSeen={markWhatsNewSeen}
                whatsNewUnread={whatsNewUnread}
                teamBoardFocus={teamBoardFocus}
                onTeamBoardFocusChange={setTeamBoardFocus}
                theme={theme}
                onSetTheme={setTheme}
                sidebarCollapsed={sidebarCollapsed}
                workspaceId={workspaceId}
                workspaceLoading={workspaceLoading}
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
                onCreateWorkspace={() => setCreateWorkspaceOpen(true)}
                onSwitchWorkspace={setActiveWorkspaceId}
                onProfileUpdated={updateSessionUser}
                onWorkspaceLogoUpdated={(logoUrl) =>
                  updateWorkspaceLogo(currentWorkspace?.id, logoUrl)
                }
                onSignOut={logout}
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
                onDeletePermanently={deleteTaskPermanently}
                onBulkArchive={bulkArchiveTasks}
                onBulkDelete={bulkDeleteTasksPermanently}
                onBulkMoveToBucket={bulkMoveTasksToBucket}
                onBulkChangeStatus={bulkChangeTaskStatus}
                onAddTask={openTaskModal}
                onOpenTask={setSelectedTask}
                selectedEvent={selectedEvent}
                setSelectedEvent={setSelectedEvent}
                selectedFollowUp={selectedFollowUp}
                setSelectedFollowUp={setSelectedFollowUp}
                pendingComposer={pendingComposer}
                onPendingComposerHandled={() => setPendingComposer(null)}
                onOpenNotification={openNotification}
                onMarkNotificationsRead={markNotificationsRead}
                onActionError={(message) => toast.error(message)}
                onRefresh={() => setWorkspaceReload((current) => current + 1)}
                onConfirm={confirmAction}
                screenShareNotificationId={screenShareNotificationId}
                pendingActivity={pendingActivity}
                onPendingActivityHandled={clearPendingActivity}
                pendingCheckInId={pendingCheckInId}
                setPendingCheckInId={setPendingCheckInId}
                pendingDocumentId={pendingDocumentId}
                setPendingDocumentId={setPendingDocumentId}
                pendingEventId={pendingEventId}
                setPendingEventId={setPendingEventId}
                pendingFollowUpId={pendingFollowUpId}
                setPendingFollowUpId={setPendingFollowUpId}
                pendingProjectNotification={pendingProjectNotification}
                setPendingProjectNotification={setPendingProjectNotification}
                pendingWorkstreamNotification={pendingWorkstreamNotification}
                setPendingWorkstreamNotification={setPendingWorkstreamNotification}
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
                activity={workspaceData.activity}
                workShifts={workspaceData.workShifts}
                currentUserId={session.user.id}
                currentUserPresence={currentUserPresence}
                onSubmitShift={submitWorkShift}
                onChangePresence={changePresence}
                members={workspaceData.members}
                canManageMembers={canManageMembers}
                onAddTask={() => openTaskModal()}
                onAddEvent={() => {
                  setPendingComposer({ type: "calendar", prefill: { date: today } });
                  setActive("Calendar");
                }}
                onCheckIn={() => {
                  setPendingComposer({ type: "checkin" });
                  setActive("Check-ins");
                }}
                onInvite={() => openComposer("invite")}
                onOpenTask={setSelectedTask}
                onOpenEvent={(event) => {
                  setSelectedEvent(event);
                  setActive("Calendar");
                }}
                onOpenFollowUp={(followUp) => {
                  setSelectedFollowUp(followUp);
                  setActive("Follow-up");
                }}
                onNavigate={setActive}
                onOpenActivity={(event) => {
                  setPendingActivity({
                    search: event.message || "",
                    actorId: event.actor_id == null ? "system" : String(event.actor_id),
                    kind: event.kind || "all",
                  });
                  setActive("Activity");
                }}
                onOpenBoard={(focus) => {
                  setTeamBoardFocus(focus);
                  setActive("Team");
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
                    : ".mobile-nav-zuri",
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
      {/* -- Mobile TabBar - the design's five destinations along the bottom
        edge, each a fifth of the width, with "More" opening the same drawer as
        the AppBar menu button so the rest of the navigation stays reachable.
        Hidden while that drawer is open so the bar doesn't sit under the
        overlay. ── */}
      <nav
        ref={mobileNavRef}
        className={cn(
          "mobile-tabbar fixed inset-x-5 bottom-4 z-30 flex h-16 items-center justify-center rounded-[32px] bg-navy shadow-[0_4px_12px_rgba(0,0,0,0.12)] transition-opacity duration-200 lg:hidden",
          mobileOpen && "pointer-events-none opacity-0",
        )}
        aria-label="Primary"
      >
        {mobileTabItems.map(renderMobileTab)}
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-expanded={mobileOpen}
          aria-haspopup="menu"
          className="flex h-full min-w-0 max-w-[66px] flex-1 flex-col items-center gap-1 pt-3.5 font-medium text-[#93B4D4] transition-colors hover:text-white"
        >
          <Menu size={20} className="shrink-0" aria-hidden="true" />
          <span className="max-w-full truncate text-[10px] leading-none">
            More
          </span>
        </button>
      </nav>

      {/* The TabBar stands 64px tall, so 72px clears it with a gap. Rendered
        here, beside the nav rather than inside it, because the nav carries a
        backdrop-filter of its own. */}
      {messagesOpen &&
        messagesOrigin === "nav" &&
        <div ref={messagesNavPanelRef}>
          {renderMessagesPanel("fixed bottom-[88px] left-1/2 w-[min(calc(100vw-1rem),380px)] -translate-x-1/2")}
        </div>}

      {showModal && (
        <div className="modal-backdrop task-dialog-backdrop" onMouseDown={() => setShowModal(false)}>
          <form
            className="task-dialog task-composer-modal"
            ref={taskModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-task-title"
            aria-describedby="add-task-description"
            onSubmit={addTask}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="task-dialog-header task-composer-heading">
              <div className="task-dialog-heading-copy task-composer-heading-copy">
                <p className="eyebrow">New task</p>
                <h2 id="add-task-title">Add a task</h2>
                <p id="add-task-description">Set ownership, timing, and placement. Required fields are marked in the form.</p>
              </div>
              <button
                type="button"
                className="close-button task-dialog-close"
                onClick={() => setShowModal(false)}
                aria-label="Close add task dialog"
              >
                <X size={18} />
              </button>
            </div>
            <div className="task-dialog-body task-composer-body">
              <label className="task-composer-field">
                Task name
                <input
                  autoFocus
                  value={newTask}
                  onChange={(event) => {
                    setNewTask(event.target.value);
                    setTaskError("");
                  }}
                  placeholder="What needs to happen?"
                  maxLength="200"
                />
              </label>
              <label className="task-composer-field">
                Description
                <textarea
                  value={newDescription}
                  onChange={(event) => setNewDescription(event.target.value)}
                  placeholder="Add more detail about this task"
                  maxLength="4000"
                />
              </label>
              <div className="modal-grid task-composer-grid">
                <label>
                  Assign to
                  <AssigneePicker
                    members={workspaceData.members}
                    value={newAssigneeIds}
                    onChange={setNewAssigneeIds}
                  />
                </label>
                <DateField
                  label="Due date"
                  value={newDueDate}
                  onChange={(event) => setNewDueDate(event.target.value)}
                />
              </div>
              <div className="modal-grid task-composer-grid">
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
              </div>
              <div className="modal-grid task-composer-grid">
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
              </div>
              <div className="modal-grid task-composer-grid">
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
              </div>
              {taskError && (
                <p className="auth-error task-composer-error" role="alert">
                  {taskError}
                </p>
              )}
            </div>
            <div className="task-dialog-footer task-composer-footer">
              <button type="button" className="secondary-button" onClick={() => setShowModal(false)}>
                Cancel
              </button>
              <button type="submit" className="primary-button modal-submit" disabled={taskSubmitting}>
                {taskSubmitting ? "Creating..." : "Create task"} <ArrowUpRight size={16} />
              </button>
            </div>
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
      <CreateWorkspaceDialog
        open={createWorkspaceOpen}
        onOpenChange={setCreateWorkspaceOpen}
        onCreated={handleWorkspaceCreated}
      />
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
          onDeletePermanently={deleteTaskPermanently}
          canDeletePermanently={currentWorkspace?.role === "owner"}
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
  chatThreadRequest,
  onWhatsNewSeen,
  whatsNewUnread,
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
  onCreateWorkspace,
  onSwitchWorkspace,
  onProfileUpdated,
  onWorkspaceLogoUpdated,
  onSignOut,
  canManageMembers,
  canManageTasks,
  workspaceLoading,
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
  onDeletePermanently,
  onBulkArchive,
  onBulkDelete,
  onBulkMoveToBucket,
  onBulkChangeStatus,
  onAddTask,
  onOpenTask,
  selectedEvent,
  setSelectedEvent,
  selectedFollowUp,
  setSelectedFollowUp,
  pendingComposer,
  onPendingComposerHandled,
  onOpenNotification,
  onMarkNotificationsRead,
  onActionError,
  onRefresh,
  onConfirm,
  screenShareNotificationId,
  pendingActivity,
  onPendingActivityHandled,
  pendingCheckInId,
  setPendingCheckInId,
  pendingDocumentId,
  setPendingDocumentId,
  pendingEventId,
  setPendingEventId,
  pendingFollowUpId,
  setPendingFollowUpId,
  pendingProjectNotification,
  setPendingProjectNotification,
  pendingWorkstreamNotification,
  setPendingWorkstreamNotification,
}) {
  const today = toDateKey(new Date());
  const [localData, setLocalData] = useState(data);
  const [calendarView, setCalendarView] = useState(() =>
    window.matchMedia?.("(max-width: 760px)").matches ? "day" : "month",
  );
  const [calendarDate, setCalendarDate] = useState(new Date());
  const [calendarFilter, setCalendarFilter] = useState("all");
  const [calendarTaskScope, setCalendarTaskScope] = useState("all");
  const [calendarViewMenuOpen, setCalendarViewMenuOpen] = useState(false);
  const [calendarUpcomingOpen, setCalendarUpcomingOpen] = useState(
    () => localStorage.getItem("workspace-calendar-upcoming-open") !== "false",
  );
  const [checkInRange, setCheckInRange] = useState("today");
  const [checkInLoading, setCheckInLoading] = useState(false);
  const [checkInError, setCheckInError] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerType, setComposerType] = useState("chat");
  const [composerError, setComposerError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [newBucketName, setNewBucketName] = useState("");
  const [bucketError, setBucketError] = useState("");
  const [bucketSubmitting, setBucketSubmitting] = useState(false);
  const [bucketArchiveOpen, setBucketArchiveOpen] = useState(false);
  const [archivedBuckets, setArchivedBuckets] = useState([]);
  const [bucketArchiveLoading, setBucketArchiveLoading] = useState(false);
  const [bucketArchiveError, setBucketArchiveError] = useState("");
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
  const [reportDetail, setReportDetail] = useState(null);
  const [reportDetailLoading, setReportDetailLoading] = useState(false);
  const [reportDetailError, setReportDetailError] = useState("");
  const [reportProjectQuery, setReportProjectQuery] = useState("");
  const [reportProjectFilter, setReportProjectFilter] = useState("all");
  const [reportProjectSort, setReportProjectSort] = useState("progress");
  const [teamBoardScope, setTeamBoardScope] = useState("all");
  const [activitySearch, setActivitySearch] = useState(() => pendingActivity?.search || "");
  const [activityActor, setActivityActor] = useState(() => pendingActivity?.actorId || "all");
  const [activityKind, setActivityKind] = useState(() => pendingActivity?.kind || "all");
  const [activityDateFrom, setActivityDateFrom] = useState("");
  const [activityDateTo, setActivityDateTo] = useState("");
  const [activityPage, setActivityPage] = useState(1);
  const [activityReload, setActivityReload] = useState(0);
  const [activityServer, setActivityServer] = useState({
    activity: [],
    pagination: null,
    filters: { actors: [], kinds: [] },
    summary: null,
  });
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState("");
  useEffect(() => {
    if (pendingActivity) onPendingActivityHandled?.();
  }, [pendingActivity, onPendingActivityHandled]);
  const [notificationPage, setNotificationPage] = useState(1);
  const [notificationHistory, setNotificationHistory] = useState([]);
  const [notificationPagination, setNotificationPagination] = useState(null);
  const [notificationSummary, setNotificationSummary] = useState(null);
  const [notificationFilter, setNotificationFilter] = useState("all");
  const [notificationLoading, setNotificationLoading] = useState(false);
  const [notificationLoadingMore, setNotificationLoadingMore] = useState(false);
  const [notificationError, setNotificationError] = useState("");
  const [notificationReload, setNotificationReload] = useState(0);
  const [notificationPreferences, setNotificationPreferences] = useState(null);
  const [notificationPreferencesError, setNotificationPreferencesError] = useState("");
  const [notificationPreferenceSaving, setNotificationPreferenceSaving] = useState("");
  useEffect(() => {
    const reloadPage = () => {
      setNotificationPage(1);
      setNotificationReload((current) => current + 1);
    };
    window.addEventListener("workspace:notifications-changed", reloadPage);
    return () => window.removeEventListener("workspace:notifications-changed", reloadPage);
  }, []);
  const [projectQuery, setProjectQuery] = useState("");
  const [projectStatusFilter, setProjectStatusFilter] = useState("all");
  const [projectHealthFilter, setProjectHealthFilter] = useState("all");
  const [projectSort, setProjectSort] = useState("due");
  const [projectViewMode, setProjectViewMode] = useState("grid");
  const [projectActivityFilter, setProjectActivityFilter] = useState("all");
  const [selectedProject, setSelectedProject] = useState(null);
  const [selectedProjectWorkspace, setSelectedProjectWorkspace] =
    useState(null);
  const [projectOperation, setProjectOperation] = useState("");
  const [projectOverviewActivity, setProjectOverviewActivity] = useState([]);
  const [selectedCheckIn, setSelectedCheckIn] = useState(null);
  const [selectedCheckInDetail, setSelectedCheckInDetail] = useState(null);
  const [followUpFilter, setFollowUpFilter] = useState("all");
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
  }, [activitySearch, activityActor, activityKind, activityDateFrom, activityDateTo]);

  useEffect(() => {
    if (active !== "Reports" || !workspaceId) return undefined;
    let isCurrent = true;
    setReportDetailLoading(true);
    setReportDetailError("");
    const params = new URLSearchParams({ period: reportRange || "all" });
    if (reportsScope === "operations") {
      params.set("scope", "operations");
    } else if (reportsScope !== "all") {
      params.set("scope", "project");
      params.set("project_id", String(reportsScope));
    } else {
      params.set("scope", "all");
    }
    fetch(`/api/workspaces/${workspaceId}/reports/?${params.toString()}`, {
      credentials: "include",
      headers: { "X-Workspace-Id": String(workspaceId) },
    })
      .then((response) =>
        readJsonResponse(response, "Report data could not be loaded.").then(
          (payload) => ({ ok: response.ok, payload }),
        ),
      )
      .then(({ ok, payload }) => {
        if (!isCurrent) return;
        if (!ok) throw new Error(payload.error || "Report data could not be loaded.");
        setReportDetail(payload.report || null);
      })
      .catch((error) => {
        if (isCurrent) setReportDetailError(error.message || "Report data could not be loaded.");
      })
      .finally(() => {
        if (isCurrent) setReportDetailLoading(false);
      });
    return () => {
      isCurrent = false;
    };
  }, [active, workspaceId, reportsScope, reportRange, reportLastUpdated]);

  useEffect(() => {
    if (active !== "Activity" || !workspaceId) return undefined;
    let isCurrent = true;
    const timer = window.setTimeout(() => {
      setActivityLoading(true);
      setActivityError("");
      const params = new URLSearchParams({
        page: String(activityPage),
        page_size: "40",
      });
      if (activitySearch.trim()) params.set("search", activitySearch.trim());
      if (activityActor !== "all") params.set("actor_id", activityActor);
      if (activityKind !== "all") params.set("kind", activityKind);
      if (activityDateFrom) params.set("date_from", activityDateFrom);
      if (activityDateTo) params.set("date_to", activityDateTo);
      fetch(`/api/workspaces/${workspaceId}/activity/?${params.toString()}`, {
        credentials: "include",
        headers: { "X-Workspace-Id": String(workspaceId) },
      })
        .then((response) =>
          readJsonResponse(response, "Activity could not be loaded.").then(
            (payload) => ({ ok: response.ok, payload }),
          ),
        )
        .then(({ ok, payload }) => {
          if (!isCurrent) return;
          if (!ok) throw new Error(payload.error || "Activity could not be loaded.");
          const serverPage = payload.pagination?.page;
          if (serverPage && serverPage !== activityPage) {
            setActivityPage(serverPage);
          }
          setActivityServer({
            activity: payload.activity || [],
            pagination: payload.pagination || null,
            filters: payload.filters || { actors: [], kinds: [] },
            summary: payload.summary || null,
          });
        })
        .catch((error) => {
          if (isCurrent) setActivityError(error.message || "Activity could not be loaded.");
        })
        .finally(() => {
          if (isCurrent) setActivityLoading(false);
        });
    }, 250);
    return () => {
      isCurrent = false;
      window.clearTimeout(timer);
    };
  }, [
    active,
    workspaceId,
    activityPage,
    activitySearch,
    activityActor,
    activityKind,
    activityDateFrom,
    activityDateTo,
    activityReload,
  ]);
  useEffect(() => {
    if (active !== "Projects" || !selectedProjectWorkspace || !workspaceId) {
      setProjectOverviewActivity([]);
      return undefined;
    }
    let isCurrent = true;
    const projectName = String(selectedProjectWorkspace.name || "").toLowerCase();
    const taskTitles = tasks
      .filter(
        (task) =>
          String(task.project_id || "") === String(selectedProjectWorkspace.id),
      )
      .map((task) => String(task.title || "").trim().toLowerCase())
      .filter((title) => title.length >= 4);
    const params = new URLSearchParams({
      page: "1",
      page_size: "40",
      include_filters: "0",
      include_summary: "0",
    });
    fetch(`/api/workspaces/${workspaceId}/activity/?${params.toString()}`, {
      credentials: "include",
      headers: { "X-Workspace-Id": String(workspaceId) },
    })
      .then((response) =>
        readJsonResponse(response, "Project activity could not be loaded.").then(
          (payload) => ({ ok: response.ok, payload }),
        ),
      )
      .then(({ ok, payload }) => {
        if (!isCurrent) return;
        if (!ok) throw new Error(payload.error || "Project activity could not be loaded.");
        const matches = (payload.activity || []).filter((item) => {
          const message = String(item.message || item.description || "").toLowerCase();
          return (
            (projectName && message.includes(projectName)) ||
            taskTitles.some((title) => message.includes(title))
          );
        });
        setProjectOverviewActivity(matches.slice(0, 3));
      })
      .catch(() => {
        if (isCurrent) setProjectOverviewActivity([]);
      });
    return () => {
      isCurrent = false;
    };
  }, [active, workspaceId, selectedProjectWorkspace?.id, selectedProjectWorkspace?.name, tasks]);
  useEffect(() => {
    if (active !== "Notifications") return;
    setNotificationPage(1);
    setNotificationFilter("all");
    setNotificationHistory([]);
    setNotificationPagination(null);
    setNotificationSummary(null);
  }, [active, workspaceId]);
  useEffect(() => {
    if (active !== "Notifications" || !workspaceId) return undefined;
    let current = true;
    setNotificationPreferencesError("");
    fetch(`/api/workspaces/${workspaceId}/notification-preferences/`, {
      credentials: "include",
      headers: { "X-Workspace-Id": String(workspaceId) },
    })
      .then((response) =>
        readJsonResponse(response, "Notification preferences could not be loaded.").then(
          (payload) => ({ ok: response.ok, payload }),
        ),
      )
      .then(({ ok, payload }) => {
        if (!current) return;
        if (!ok) throw new Error(payload.error || "Notification preferences could not be loaded.");
        setNotificationPreferences(payload.preferences || null);
      })
      .catch((error) => {
        if (current) setNotificationPreferencesError(error.message || "Notification preferences could not be loaded.");
      });
    return () => {
      current = false;
    };
  }, [active, workspaceId]);
  const updateNotificationPreference = async (key, value) => {
    if (!workspaceId || !notificationPreferences) return;
    const previous = notificationPreferences;
    setNotificationPreferences((current) => ({ ...current, [key]: value }));
    setNotificationPreferencesError("");
    setNotificationPreferenceSaving(key);
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/notification-preferences/`,
        {
          method: "PATCH",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "X-CSRFToken": await getCsrfToken(),
          },
          body: JSON.stringify({ [key]: value }),
        },
      );
      const payload = await readJsonResponse(response, "Preference could not be saved.");
      if (!response.ok) throw new Error(payload.error || "Preference could not be saved.");
      setNotificationPreferences(payload.preferences || previous);
    } catch (error) {
      setNotificationPreferences(previous);
      setNotificationPreferencesError(error.message || "Preference could not be saved.");
    } finally {
      setNotificationPreferenceSaving("");
    }
  };
  useEffect(() => {
    if (active !== "Notifications" || !workspaceId) return undefined;
    let current = true;
    if (notificationPage === 1) setNotificationLoading(true);
    else setNotificationLoadingMore(true);
    setNotificationError("");
    const params = new URLSearchParams({
      page: String(notificationPage),
      exclude_chat: "1",
      sort: "newest",
      page_size: "7",
    });
    if (notificationFilter !== "all") params.set("filter", notificationFilter);
    fetch(`/api/workspaces/${workspaceId}/notifications/?${params.toString()}`, {
      credentials: "include",
      headers: { "X-Workspace-Id": String(workspaceId) },
    })
      .then(async (response) => {
        const payload = await readJsonResponse(response, "Notifications could not be loaded.");
        if (!response.ok)
          throw new Error(payload.error || "Notifications could not be loaded.");
        return payload;
      })
      .then((payload) => {
        if (!current) return;
        setNotificationHistory((existing) => {
          if (notificationPage === 1) return payload.notifications || [];
          const existingIds = new Set(existing.map((notification) => notification.id));
          return [
            ...existing,
            ...(payload.notifications || []).filter(
              (notification) => !existingIds.has(notification.id),
            ),
          ];
        });
        setNotificationPagination(payload.pagination || null);
        setNotificationSummary(payload.summary || null);
      })
      .catch((error) => {
        if (current) setNotificationError(error.message || "Notifications could not be loaded.");
      })
      .finally(() => {
        if (!current) return;
        setNotificationLoading(false);
        setNotificationLoadingMore(false);
      });
    return () => {
      current = false;
    };
  }, [active, workspaceId, notificationFilter, notificationPage, notificationReload]);
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
      setBucketArchiveOpen(false);
    };
    window.addEventListener("keydown", closeOverlays);
    return () => window.removeEventListener("keydown", closeOverlays);
  }, []);
  useEffect(() => {
    setBucketArchiveOpen(false);
    setArchivedBuckets([]);
    setBucketArchiveError("");
  }, [active, workspaceId]);
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
          if (["risk_issue", "risk"].includes(targetType)) {
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
    if (active !== "Projects" || !pendingProjectNotification || ["risk_issue", "risk"].includes(pendingProjectNotification.targetType)) return;
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
    fetch(`/api/workspaces/${workspaceId}/check-ins/`, {
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
  }, [active, workspaceId, pendingCheckInId]);

  const openComposer = (type, prefill = {}) => {
    setComposerType(type);
    setComposerError("");
    setForm((current) => ({
      ...current,
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
      channel: chatChannel,
      note: "",
      due_date: "",
      assigned_to: "",
      task_id: "",
      date: today,
      email: "",
      role: "member",
      ...prefill,
    }));
    if (type !== "chat") setReplyTo(null);
    setComposerOpen(true);
  };

  useEffect(() => {
    if (!pendingComposer) return;
    const targetView = pendingComposer.type === "calendar" ? "Calendar" : "Check-ins";
    if (active !== targetView) return;
    openComposer(pendingComposer.type, pendingComposer.prefill || {});
    onPendingComposerHandled?.();
  }, [active, pendingComposer, onPendingComposerHandled, openComposer]);

  const submitComposer = async (event, typeOverride) => {
    event.preventDefault();
    const composerKind = typeOverride || composerType;
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
      const response = await fetch(endpoints[composerKind], {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": await getCsrfToken(),
          "X-Workspace-Id": String(workspaceId),
        },
        body: JSON.stringify(payloads[composerKind]),
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
      const [collection, itemKey] = collections[composerKind];
      const item = responseData[itemKey];
      setLocalData((current) => ({
        ...current,
        [collection]:
          composerKind === "checkin"
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
      if (composerKind === "invite")
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
  const loadArchivedBuckets = async () => {
    setBucketArchiveLoading(true);
    setBucketArchiveError("");
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/plan-buckets/?archived=1`,
        { credentials: "include" },
      );
      const data = await readJsonResponse(
        response,
        "Archived buckets could not be loaded.",
      );
      if (!response.ok)
        throw new Error(
          data.error || "Archived buckets could not be loaded.",
        );
      setArchivedBuckets(data.buckets || []);
    } catch (error) {
      setBucketArchiveError(
        error.message || "Archived buckets could not be loaded.",
      );
    } finally {
      setBucketArchiveLoading(false);
    }
  };

  const toggleBucketArchive = () => {
    if (bucketArchiveOpen) {
      setBucketArchiveOpen(false);
      return;
    }
    setBucketArchiveOpen(true);
    loadArchivedBuckets();
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

  const renameBucket = async (bucket, requestedName) => {
    if (!canManageMembers) {
      setBucketError("Only workspace leaders can rename Planner buckets.");
      return false;
    }
    const name = requestedName.trim();
    if (!name || name === bucket.name) return true;
    setBucketError("");
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/plan-buckets/${bucket.id}/`,
        {
          method: "PATCH",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "X-CSRFToken": await getCsrfToken(),
            "X-Workspace-Id": String(workspaceId),
          },
          body: JSON.stringify({ name }),
        },
      );
      const data = await readJsonResponse(
        response,
        "Bucket could not be renamed.",
      );
      if (!response.ok)
        throw new Error(data.error || "Bucket could not be renamed.");
      setLocalData((current) => ({
        ...current,
        buckets: current.buckets.map((item) =>
          item.id === bucket.id ? data.bucket : item,
        ),
      }));
      window.dispatchEvent(
        new CustomEvent("workspace:notice", {
          detail: `Bucket renamed to ${data.bucket.name}.`,
        }),
      );
      onRefresh();
      return true;
    } catch (error) {
      setBucketError(error.message || "Bucket could not be renamed.");
      return false;
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
      setArchivedBuckets((current) =>
        current.some((item) => item.id === bucket.id)
          ? current
          : [...current, { ...bucket, is_active: false }],
      );
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
    const isArchived = bucket.is_active === false;
    if (
      !canManageMembers ||
      !(await onConfirm(
        isArchived
          ? `Delete ${bucket.name} permanently? Any tasks still using it will move to Backlog.`
          : `Delete ${bucket.name}? Tasks in this bucket will move to Backlog.`,
        { title: "Delete bucket", confirmLabel: "Delete bucket" },
      ))
    )
      return;
    setBucketError("");
    setBucketArchiveError("");
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
      setArchivedBuckets((current) =>
        current.filter((item) => item.id !== bucket.id),
      );
      window.dispatchEvent(
        new CustomEvent("workspace:notice", {
          detail: `${bucket.name} deleted.`,
        }),
      );
      onRefresh();
    } catch (error) {
      const message = error.message || "Bucket could not be deleted.";
      setBucketError(message);
      setBucketArchiveError(message);
    }
  };

  const restoreBucket = async (bucket) => {
    if (!canManageMembers) {
      setBucketArchiveError(
        "Only workspace leaders can restore Planner buckets.",
      );
      return;
    }
    setBucketArchiveError("");
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/plan-buckets/${bucket.id}/`,
        {
          method: "PATCH",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "X-CSRFToken": await getCsrfToken(),
            "X-Workspace-Id": String(workspaceId),
          },
          body: JSON.stringify({ is_active: true }),
        },
      );
      const data = await readJsonResponse(
        response,
        "Bucket could not be restored.",
      );
      if (!response.ok)
        throw new Error(data.error || "Bucket could not be restored.");
      setLocalData((current) => ({
        ...current,
        buckets: current.buckets.some((item) => item.id === data.bucket.id)
          ? current.buckets.map((item) =>
              item.id === data.bucket.id ? data.bucket : item,
            )
          : [...current.buckets, data.bucket],
      }));
      setArchivedBuckets((current) =>
        current.filter((item) => item.id !== bucket.id),
      );
      window.dispatchEvent(
        new CustomEvent("workspace:notice", {
          detail: `${bucket.name} restored and ready to use.`,
        }),
      );
      onRefresh();
    } catch (error) {
      setBucketArchiveError(
        error.message || "Bucket could not be restored.",
      );
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

  const reorderBucketsAcrossScopes = async (bucketIds, previousBuckets) => {
    // Sentinel ids ("backlog", "legacy-<name>") name a lane the server has to
    // materialise; everything else is a real bucket id.
    const bucketKey = (value) => {
      const id = value?.id ?? value;
      return typeof id === "string" ? id : Number(id);
    };
    const ids = bucketIds.map(bucketKey);
    const byId = new Map(previousBuckets.map((bucket) => [bucketKey(bucket), bucket]));
    if (new Set(ids).size !== ids.length || ids.some((id) => !byId.has(id))) {
      setBucketError(
        "Bucket order could not be saved. Refresh the page and try again.",
      );
      return;
    }
    // Lanes this board does not draw keep the slots they already hold; only the
    // ones it ordered are resequenced, in place.
    const moving = new Set(ids);
    const reordered = ids.map((id) => byId.get(id));
    let cursor = 0;
    const nextBuckets = previousBuckets.map((bucket) =>
      moving.has(bucketKey(bucket)) ? reordered[cursor++] : bucket,
    );
    if (
      nextBuckets.every((bucket, index) =>
        String(bucket.id) === String(previousBuckets[index]?.id),
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
          body: JSON.stringify({ bucket_ids: ids, across_scopes: true }),
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
      // This mode returns every active bucket, already in saved order.
      setLocalData((current) =>
        responseData.buckets?.length
          ? { ...current, buckets: responseData.buckets }
          : current,
      );
      window.dispatchEvent(
        new CustomEvent("workspace:notice", { detail: "Bucket order saved." }),
      );
      onRefresh();
    } catch (error) {
      setLocalData((current) => ({ ...current, buckets: previousBuckets }));
      setBucketError(error.message || "Bucket order could not be saved.");
    }
  };
  const reorderBuckets = async (bucketIds, scope = {}) => {
    if (!canManageMembers) return;
    const previousBuckets = [...localData.buckets];
    // A board showing more than one scope orders every lane it draws at once.
    // Position is one column across the workspace, so an order that interleaves
    // scopes cannot be written one scope at a time.
    if (scope.board) return reorderBucketsAcrossScopes(bucketIds, previousBuckets);
    const bucketInScope = (bucket) => {
      if (scope.project_id)
        return String(bucket.project_id) === String(scope.project_id);
      if (scope.workstream_id)
        return String(bucket.workstream_id) === String(scope.workstream_id);
      return !bucket.project_id && !bucket.workstream_id;
    };
    const scopedBuckets = previousBuckets.filter(bucketInScope);
    if (
      !scope.project_id &&
      !scope.workstream_id &&
      bucketIds.includes("backlog") &&
      !scopedBuckets.some((bucket) => bucket.id === "backlog")
    ) {
      scopedBuckets.unshift({
        id: "backlog",
        name: "Backlog",
        project_id: null,
        workstream_id: null,
      });
    }
    const bucketKey = (bucket) =>
      bucket.id === "backlog" ? "backlog" : Number(bucket.id);
    const byId = new Map(
      scopedBuckets.map((bucket) => [bucketKey(bucket), bucket]),
    );
    const ids = bucketIds.map((id) => (id === "backlog" ? "backlog" : Number(id)));
    if (
      ids.length !== scopedBuckets.length ||
      new Set(ids).size !== ids.length ||
      ids.some((id) => !byId.has(id))
    ) {
      setBucketError(
        "Bucket order could not be saved. Refresh the page and try again.",
      );
      return;
    }
    const nextScopedBuckets = ids.map((id) => byId.get(id));
    const replaceScopedBuckets = (currentBuckets, nextScopedBuckets) => {
      const merged = [];
      let inserted = false;
      currentBuckets.forEach((bucket) => {
        if (bucketInScope(bucket)) {
          if (!inserted) {
            merged.push(...nextScopedBuckets);
            inserted = true;
          }
        } else {
          merged.push(bucket);
        }
      });
      if (!inserted) merged.push(...nextScopedBuckets);
      return merged;
    };
    const nextBuckets = replaceScopedBuckets(previousBuckets, nextScopedBuckets);
    if (
      nextBuckets.length === previousBuckets.length &&
      nextBuckets.every((bucket, index) =>
        String(bucket.id) === String(previousBuckets[index]?.id),
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
          body: JSON.stringify({
            bucket_ids: ids,
            project_id: scope.project_id || null,
            workstream_id: scope.workstream_id || null,
          }),
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
      setLocalData((current) => {
        const savedScoped = responseData.buckets || [];
        if (!savedScoped.length) return current;
        return {
          ...current,
          buckets: replaceScopedBuckets(current.buckets, savedScoped),
        };
      });
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
  const toggleCalendarUpcoming = () => {
    setCalendarUpcomingOpen((current) => {
      const next = !current;
      localStorage.setItem("workspace-calendar-upcoming-open", String(next));
      return next;
    });
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
  const reorderProjectKanbanColumns = async (project, columnOrder) => {
    if (!project || !Array.isArray(columnOrder)) return;
    const previousProject = project;
    const nextConfiguration = {
      ...(project.configuration || {}),
      kanban_column_order: columnOrder,
    };
    const optimisticProject = { ...project, configuration: nextConfiguration };
    setSelectedProjectWorkspace((current) =>
      current && String(current.id) === String(project.id)
        ? optimisticProject
        : current,
    );
    setLocalData((current) => ({
      ...current,
      projects: current.projects.map((item) =>
        String(item.id) === String(project.id) ? optimisticProject : item,
      ),
    }));
    const responseData = await runAction(
      async () =>
        fetch(`/api/workspaces/${workspaceId}/projects/${project.id}/`, {
          method: "PATCH",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "X-CSRFToken": await getCsrfToken(),
          },
          body: JSON.stringify({ configuration: nextConfiguration }),
        }),
      "Kanban column order could not be saved.",
    );
    if (!responseData?.project) {
      setSelectedProjectWorkspace((current) =>
        current && String(current.id) === String(project.id)
          ? previousProject
          : current,
      );
      setLocalData((current) => ({
        ...current,
        projects: current.projects.map((item) =>
          String(item.id) === String(project.id) ? previousProject : item,
        ),
      }));
      return;
    }
    setSelectedProjectWorkspace((current) =>
      current && String(current.id) === String(project.id)
        ? responseData.project
        : current,
    );
    setLocalData((current) => ({
      ...current,
      projects: current.projects.map((item) =>
        String(item.id) === String(project.id) ? responseData.project : item,
      ),
    }));
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
    Team: "See workload, availability, and the work that needs attention.",
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
    const configuredBuckets = localData.buckets.some(
      (bucket) => bucket.name === "Backlog",
    )
      ? [...localData.buckets]
      : [{ id: "backlog", name: "Backlog" }, ...localData.buckets];
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
          onDeletePermanently={onDeletePermanently}
          canDeletePermanently={currentWorkspace?.role === "owner"}
          onBulkArchive={onBulkArchive}
          onBulkDelete={onBulkDelete}
          onBulkMove={onBulkMoveToBucket}
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
          onRenameBucket={renameBucket}
          onDeleteBucket={deleteBucket}
          onRestoreBucket={restoreBucket}
          onToggleBucketArchive={toggleBucketArchive}
          bucketArchiveOpen={bucketArchiveOpen}
          archivedBuckets={archivedBuckets}
          bucketArchiveLoading={bucketArchiveLoading}
          bucketArchiveError={bucketArchiveError}
          externalFilter={plannerFilter}
        />
      </section>
    );
  }

  if (active === "Planner") {
    const configuredBuckets = localData.buckets.some(
      (bucket) => bucket.name === "Backlog",
    )
      ? [...localData.buckets]
      : [{ id: "backlog", name: "Backlog" }, ...localData.buckets];
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
          onDeletePermanently={onDeletePermanently}
          canDeletePermanently={currentWorkspace?.role === "owner"}
          onBulkArchive={onBulkArchive}
          onBulkDelete={onBulkDelete}
          onBulkMove={onBulkMoveToBucket}
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
          onRenameBucket={renameBucket}
          onDeleteBucket={deleteBucket}
          onRestoreBucket={restoreBucket}
          onToggleBucketArchive={toggleBucketArchive}
          bucketArchiveOpen={bucketArchiveOpen}
          archivedBuckets={archivedBuckets}
          bucketArchiveLoading={bucketArchiveLoading}
          bucketArchiveError={bucketArchiveError}
          externalFilter={plannerFilter}
        />
      </section>
    );
  }

  if (active === "Reports") {
    // The summary endpoint sends workspace-wide counters only - it has no
    // progress_by_project/priority, stale, on_hold, cancelled, or kpis. Spreading
    // it over the defaults keeps those at their empty value instead of letting
    // them reach the render as undefined and throw while the detail report is
    // still loading.
    const summaryReport = {
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
      average_progress: 0,
      stale_tasks: 0,
      on_hold_tasks: 0,
      cancelled_tasks: 0,
      progress_by_project: [],
      progress_by_priority: [],
      kpis: {},
      ...(data.reports || {}),
    };
    const detailedReport = reportDetail;
    const serverReport = detailedReport
      ? {
          ...summaryReport,
          total_tasks: detailedReport.totals?.total_tasks || 0,
          status_counts: Object.fromEntries(
            Object.entries(detailedReport.status_counts || {}).map(
              ([status, item]) => [status, item?.count || 0],
            ),
          ),
          completion_rate: detailedReport.totals?.completion_rate || 0,
          average_progress: detailedReport.totals?.average_progress || 0,
          overdue_tasks: detailedReport.overdue?.count || 0,
          due_this_week: detailedReport.due_soon?.count || 0,
          blocked_tasks: detailedReport.blocked?.count || 0,
          unassigned_tasks: detailedReport.unassigned?.count || 0,
          stale_tasks: detailedReport.stale?.count || 0,
          on_hold_tasks: detailedReport.on_hold?.count || 0,
          cancelled_tasks: detailedReport.cancelled?.count || 0,
          workload: detailedReport.workload || [],
          progress_by_project: detailedReport.progress_by_project || [],
          progress_by_priority: detailedReport.progress_by_priority || [],
          kpis: detailedReport.kpis || {},
          scope_label: detailedReport.scope?.label || "",
          period_label: detailedReport.period?.type || reportRange,
        }
      : summaryReport;
    const statusLabels = {
      todo: "To do",
      in_progress: "In progress",
      review: "Review",
      blocked: "Blocked",
      on_hold: "On hold",
      cancelled: "Cancelled",
      done: "Done",
    };
    const report = serverReport;
    const reportScopeLabel =
      reportsScope === "all"
        ? "Entire workspace"
        : reportsScope === "operations"
          ? "Operations"
          : localData.projects.find(
              (project) => String(project.id) === String(reportsScope),
            )?.name || "Project";
    const reportPeriodLabel =
      {
        all: "All time",
        week: "Last 7 days",
        month: "This month",
        quarter: "This quarter",
        year: "This year",
      }[reportRange] || reportRange;
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
    const reportScopedTasks = tasks.filter((task) => {
      if (reportsScope === "operations") return !task.project_id;
      if (reportsScope !== "all") {
        return String(task.project_id || "") === String(reportsScope);
      }
      return true;
    });
    const reportCompletedTasks = reportScopedTasks.filter(
      (task) => task.status === "done" && (task.completed_at || task.actual_completion_date),
    );
    const reportCompletedCount = report.status_counts.done || reportCompletedTasks.length;
    const serverWeekBuckets = detailedReport?.completed_by_week;
    const reportWeekBuckets = Array.isArray(serverWeekBuckets)
      ? serverWeekBuckets.map((week, index) => ({
          label: week?.label || `W${index + 1}`,
          from: week?.from || "",
          to: week?.to || "",
          count: Number(week?.count) || 0,
          current: Boolean(week?.current),
        }))
      : Array.from({ length: 8 }, (_, index) => {
          const weekEnd = new Date();
          weekEnd.setHours(23, 59, 59, 999);
          weekEnd.setDate(weekEnd.getDate() - (7 - index) * 7);
          const weekStart = new Date(weekEnd);
          weekStart.setHours(0, 0, 0, 0);
          weekStart.setDate(weekStart.getDate() - 6);
          const from = toDateKey(weekStart);
          const to = toDateKey(weekEnd);
          const count = reportCompletedTasks.filter((task) => {
            const completedKey = task.completed_at
              ? toDateKey(task.completed_at)
              : task.actual_completion_date;
            return completedKey && completedKey >= from && completedKey <= to;
          }).length;
          return { label: `W${index + 1}`, from, to, count, current: index === 7 };
        });
    const reportMaxWeekCount = Math.max(
      ...reportWeekBuckets.map((week) => week.count),
      1,
    );
    const reportProjectOwner = (project) => {
      const projectTasks = reportScopedTasks.filter((task) => {
        if (project.filter?.project_id != null) {
          return String(task.project_id || "") === String(project.filter.project_id);
        }
        return !task.project_id;
      });
      const ownerCounts = projectTasks.reduce((counts, task) => {
        if (task.member && task.member !== "Unassigned") {
          counts.set(task.member, (counts.get(task.member) || 0) + 1);
        }
        return counts;
      }, new Map());
      return (
        [...ownerCounts.entries()].sort(
          (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
        )[0]?.[0] || "Unassigned"
      );
    };
    const reportProjectHealth = (project) => {
      if (project.blocked) return { label: "At risk", tone: "warning" };
      if (project.overdue) return { label: "Delayed", tone: "danger" };
      if (project.completion_rate >= 80) return { label: "On track", tone: "success" };
      return { label: "In progress", tone: "neutral" };
    };
    const reportProjectQueryValue = reportProjectQuery.trim().toLowerCase();
    const reportProjectRows = report.progress_by_project
      .map((project) => ({ ...project, owner_name: reportProjectOwner(project) }))
      .filter((project) => {
        if (reportProjectFilter === "progress") return project.completed > 0;
        if (reportProjectFilter === "none") return project.completed === 0;
        return true;
      })
      .filter((project) => {
        if (!reportProjectQueryValue) return true;
        return `${project.name} ${project.owner_name}`
          .toLowerCase()
          .includes(reportProjectQueryValue);
      })
      .sort((left, right) => {
        if (reportProjectSort === "name") return left.name.localeCompare(right.name);
        if (reportProjectSort === "attention") {
          return (
            right.blocked + right.overdue - (left.blocked + left.overdue) ||
            left.completion_rate - right.completion_rate
          );
        }
        return (
          right.completion_rate - left.completion_rate ||
          left.name.localeCompare(right.name)
        );
      })
      .slice(0, 5);
    const serverBlockers = detailedReport?.top_blockers;
    const reportBlockedTasks = Array.isArray(serverBlockers)
      ? serverBlockers.map((task) => ({
          ...task,
          member: task.owner || "Unassigned",
          due: task.due_date || "",
          overdue: Boolean(task.overdue),
        }))
      : reportScopedTasks
          .filter((task) => task.status === "blocked")
          .sort((left, right) =>
            String(left.due_date || "9999-12-31").localeCompare(
              String(right.due_date || "9999-12-31"),
            ),
          )
          .slice(0, 5);
    const reportStatusColors = {
      todo: "#2563eb",
      in_progress: "#001666",
      review: "#ff6900",
      blocked: "#c70036",
      on_hold: "#f59e0b",
      cancelled: "#94a3b8",
      done: "#007a55",
    };
    const reportStatusEntries = Object.entries(report.status_counts).filter(
      ([, count]) => count > 0,
    );
    const reportStatusTotal = reportStatusEntries.reduce(
      (total, [, count]) => total + count,
      0,
    );
    let reportDonutOffset = 0;
    const reportDonutGradient = reportStatusTotal
      ? `conic-gradient(${reportStatusEntries
          .map(([key, count]) => {
            const start = reportDonutOffset;
            reportDonutOffset += (count / reportStatusTotal) * 100;
            return `${reportStatusColors[key] || "#94a3b8"} ${start}% ${reportDonutOffset}%`;
          })
          .join(", ")})`
      : "conic-gradient(#e2e8f0 0 100%)";
    const exportReportCsv = () => {
      const rows = [
        ["Metric", "Value"],
        ["Scope", reportScopeLabel],
        ["Period", reportPeriodLabel],
        ["Total tasks", report.total_tasks],
        ["Completed", reportCompletedCount],
        ["Overdue", report.overdue_tasks],
        ["Blocked", report.blocked_tasks],
        [],
        ["Project", "Owner", "Completed", "Total", "Completion rate"],
        ...reportProjectRows.map((project) => [
          project.name,
          project.owner_name,
          project.completed,
          project.total,
          `${project.completion_rate}%`,
        ]),
      ];
      const csv = rows
        .map((row) =>
          row
            .map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`)
            .join(","),
        )
        .join("\n");
      const url = URL.createObjectURL(
        new Blob([csv], { type: "text/csv;charset=utf-8" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `workspace-report-${today}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    };
    return (
      <section className="workspace-view pencil-reports-view" aria-busy={reportDetailLoading}>
        <WorkspaceViewHeading
          eyebrow="Insights"
          title="Reports"
          subtitle={subtitle}
          actions={(
            <div className="report-toolbar">
              <div className="report-scope-control">
                <WorkScopeSelector
                  compact
                  value={reportsScope}
                  onChange={setReportsScope}
                  projects={localData.projects}
                  label="Scope"
                />
              </div>
              <label className="report-period-control">
                <span className="sr-only">Reporting period</span>
                <CalendarDays size={15} aria-hidden="true" />
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
              <span className="report-updated sr-only" aria-live="polite">
                {reportDetailLoading
                  ? "Loading report data..."
                  : reportLastUpdated
                  ? `Updated ${formatCalendarDate(reportLastUpdated, { timeStyle: "short" })}`
                  : "Waiting for report data"}
              </span>
              <button
                type="button"
                className="report-icon-button"
                onClick={onRefresh}
                aria-label={reportDetailLoading ? "Refreshing reports" : "Refresh reports"}
                title={reportDetailLoading ? "Refreshing reports" : "Refresh reports"}
                disabled={reportDetailLoading}
              >
                <RefreshCw size={16} />
              </button>
              <button
                type="button"
                className="primary-button report-export-button"
                onClick={exportReportCsv}
              >
                <Download size={15} />
                Export CSV
              </button>
            </div>
          )}
        />
        <div className="report-context" aria-live="polite">
          <span><strong>Scope</strong>{reportScopeLabel}</span>
          <span><strong>Period</strong>{reportPeriodLabel}</span>
          <span><strong>Source</strong>{detailedReport ? "Server report" : "Summary fallback"}</span>
        </div>
        {reportDetailError && (
          <Alert tone="warning" compact>
            The detailed report could not be refreshed. Showing the latest summary data instead. {reportDetailError}
          </Alert>
        )}
        <div className="report-metrics">
          <button
            type="button"
            className="report-stat report-stat-button"
            onClick={() => onNavigate("Planner")}
          >
            <span>Total tasks</span>
            <strong>{report.total_tasks}</strong>
            <em>{report.completion_rate}% complete - {report.average_progress || 0}% average progress</em>
          </button>
          <button
            type="button"
            className="report-stat report-stat-button is-success"
            onClick={() => openPlannerWithFilter("done")}
          >
            <span>Completed</span>
            <strong>{reportCompletedCount}</strong>
            <em>{report.completion_rate}% completion rate</em>
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
        </div>
        <div className="report-p5-grid">
          <div className="report-p5-top-grid">
          <Card className="report-panel report-bar-chart-panel">
            <div className="drawer-section-heading">
              <h3>Tasks completed per week</h3>
            </div>
            <div
              className="report-week-chart"
              role="img"
              aria-label={`Tasks completed per week. ${reportWeekBuckets.map((week) => `${week.label}: ${week.count}`).join(", ")}`}
            >
              {reportWeekBuckets.map((week) => (
                <div
                  className={`report-week-bar${week.current ? " is-current" : ""}`}
                  key={week.label}
                  title={`${week.from} to ${week.to}: ${week.count} completed`}
                >
                  <i
                    style={{
                      height: `${Math.max((week.count / reportMaxWeekCount) * 100, week.count ? 10 : 3)}%`,
                    }}
                  />
                  <span>{week.label}</span>
                </div>
              ))}
            </div>
          </Card>
          <Card className="report-panel report-donut-panel">
            <div className="drawer-section-heading">
              <h3>Status mix</h3>
            </div>
            <div className="report-donut-wrap">
              <div className="report-donut" style={{ background: reportDonutGradient }} aria-label="Task mix chart"><span>{report.completion_rate}%<small>complete</small></span></div>
              <div className="report-donut-legend">
                {reportStatusEntries.slice(0, 5).map(([key, count]) => <div key={key}><i style={{ background: reportStatusColors[key] || "#94a3b8" }} /><span>{statusLabels[key] || key}</span><strong>{reportStatusTotal ? Math.round((count / reportStatusTotal) * 100) : 0}%</strong></div>)}
              </div>
            </div>
          </Card>
          </div>
          <div className="report-p5-bottom-grid">
          <Card className="report-panel report-projects-panel" role="region" aria-label="Project progress">
            <div className="report-project-toolbar">
              <label className="report-project-search">
                <Search size={15} aria-hidden="true" />
                <input
                  value={reportProjectQuery}
                  onChange={(event) => setReportProjectQuery(event.target.value)}
                  placeholder="Search projects"
                  aria-label="Search projects"
                />
              </label>
              <label className="report-project-filter">
                <Filter size={14} aria-hidden="true" />
                <AppSelect
                  value={reportProjectFilter}
                  onChange={(event) => setReportProjectFilter(event.target.value)}
                  aria-label="Filter projects"
                >
                  <option value="all">Filter</option>
                  <option value="progress">With progress</option>
                  <option value="none">No progress</option>
                </AppSelect>
              </label>
              <AppSelect
                className="report-project-sort"
                value={reportProjectSort}
                onChange={(event) => setReportProjectSort(event.target.value)}
                aria-label="Sort projects"
                renderValue={() => "Sort"}
              >
                <option value="progress">Progress</option>
                <option value="attention">Needs attention</option>
                <option value="name">Project name</option>
              </AppSelect>
            </div>
            {reportProjectRows.length ? (
              <div className="report-project-table" role="table" aria-label="Project progress">
                <div className="report-project-row report-project-header" role="row">
                  <span role="columnheader">Project</span>
                  <span role="columnheader">Owner</span>
                  <span role="columnheader">Progress</span>
                  <span role="columnheader">Status</span>
                </div>
                {reportProjectRows.map((project) => {
                  const health = reportProjectHealth(project);
                  return (
                    <div className="report-project-row" role="row" key={project.name}>
                      <strong role="cell">{project.name}</strong>
                      <span role="cell">{project.owner_name}</span>
                      <span role="cell" className="report-project-progress">
                        <i style={{ width: `${project.completion_rate || 0}%` }} />
                        <span>{project.completion_rate || 0}%</span>
                      </span>
                      <span role="cell" className={`report-project-status is-${health.tone}`}>{health.label}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState text="No project progress matches this report." />
            )}
          </Card>
          <Card className="report-panel report-blockers-panel">
            <div className="drawer-section-heading">
              <h3>Top blockers</h3>
            </div>
            {reportBlockedTasks.length ? (
              <div className="report-blocker-list is-rail">
                {reportBlockedTasks.map((task) => {
                  const overdue = task.overdue ?? (task.due_date && task.due_date < today);
                  return (
                    <button type="button" key={task.id} onClick={() => openPlannerWithFilter("blocked")}>
                      <i className={`report-blocker-dot ${overdue ? "is-danger" : "is-warning"}`} />
                      <span>
                        <strong>{task.title}</strong>
                        <small>{task.member} - {overdue ? "Overdue" : task.due || "Blocked"}</small>
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <EmptyState text="No blocked tasks in this report." />
            )}
          </Card>
          </div>
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
              <div className="report-data-table report-workload-table" role="table" aria-label="Team workload">
                <div className="report-member-row report-member-header" role="row">
                  <span role="columnheader">Member</span>
                  <span role="columnheader">Open</span>
                  <span role="columnheader">Blocked</span>
                </div>
                {report.workload.map((member) => (
                  <div className="report-member-row" role="row" key={member.user_id}>
                    <span role="cell">{member.user_name}</span>
                    <strong role="cell">{member.open}</strong>
                    <em role="cell">{member.blocked}</em>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState text="No team workload yet." />
            )}
          </Card>
        </div>
        <div className="report-grid report-breakdown-grid">
          <Card className="report-panel">
            <div className="drawer-section-heading">
              <h3>Project completion detail</h3>
              <span>{report.progress_by_project.length} groups</span>
            </div>
            {report.progress_by_project.length ? (
              <div className="report-progress-table" role="table" aria-label="Project progress">
                {report.progress_by_project.slice(0, 6).map((group) => (
                  <div className="report-progress-row" role="row" key={group.name}>
                    <div role="cell">
                      <strong>{group.name}</strong>
                      <span>{group.completed} of {group.total} complete</span>
                    </div>
                    <div className="report-progress-track" role="cell" aria-label={`${group.name} ${group.completion_rate}% complete`}>
                      <i style={{ width: `${group.completion_rate}%` }} />
                    </div>
                    <em role="cell">{group.completion_rate}%</em>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState text="No project progress is available for this report." />
            )}
          </Card>
          <Card className="report-panel">
            <div className="drawer-section-heading">
              <h3>Priority delivery</h3>
              <span>Workload mix</span>
            </div>
            {report.progress_by_priority.length ? (
              <div className="report-progress-table" role="table" aria-label="Priority delivery">
                {report.progress_by_priority.map((group) => (
                  <div className="report-progress-row" role="row" key={group.name}>
                    <div role="cell">
                      <strong>{group.name}</strong>
                      <span>{group.overdue} overdue - {group.blocked} blocked</span>
                    </div>
                    <div className="report-progress-track" role="cell" aria-label={`${group.name} ${group.average_progress}% average progress`}>
                      <i style={{ width: `${group.average_progress}%` }} />
                    </div>
                    <em role="cell">{group.average_progress}%</em>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState text="No priority progress is available for this report." />
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
              <button
                type="button"
                onClick={() => openPlannerWithFilter("blocked")}
              >
                <strong>{report.blocked_tasks}</strong>
                <span>Blocked tasks</span>
              </button>
              <button
                type="button"
                onClick={() => openPlannerWithFilter("on_hold")}
              >
                <strong>{report.on_hold_tasks || 0}</strong>
                <span>On hold</span>
              </button>
              <button
                type="button"
                onClick={() => openPlannerWithFilter("stale")}
              >
                <strong>{report.stale_tasks || 0}</strong>
                <span>Stale updates</span>
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
            <div className="time-clock-members" role="table" aria-label="Time clock by team member">
              <div className="report-member-row report-member-header time-clock-member-header" role="row">
                <span role="columnheader">Team member</span>
                <span role="columnheader">Worked</span>
                <span role="columnheader">Days and breaks</span>
              </div>
              {timeClock.by_member.map((member) => (
                <div className="report-member-row" role="row" key={member.user_id}>
                  <span role="cell">{member.user_name}</span>
                  <strong role="cell">{formatHoursLabel(member.worked_seconds)}</strong>
                  <em role="cell">
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
              <div className="time-clock-table" role="table" aria-label="Recent time clock entries">
                <div className="time-clock-row time-clock-header" role="row">
                  <span role="columnheader">State</span>
                  <span role="columnheader">Entry</span>
                  <span role="columnheader">Worked</span>
                </div>
                {timeClock.recent.map((shift) => (
                  <div className="time-clock-row" role="row" key={shift.id}>
                    <span
                      role="cell"
                      className={`clock-state clock-state-${shift.is_open ? (shift.is_on_break ? "break" : "active") : "idle"}`}
                    >
                      {shift.is_open
                        ? shift.is_on_break
                          ? "Break"
                          : "Active"
                        : "Done"}
                    </span>
                    <div role="cell">
                      <strong>{shift.user_name}</strong>
                      <span>
                        {formatDay(shift.date)} · {formatShiftClock(shift.started_at)}
                        {shift.ended_at
                          ? ` - ${formatShiftClock(shift.ended_at)}`
                          : " - now"}
                      </span>
                    </div>
                    <em role="cell">
                      {formatHoursLabel(shift.worked_seconds)}
                      {shift.break_seconds_total
                        ? ` · ${formatHoursLabel(shift.break_seconds_total)} break`
                        : ""}
                    </em>
                  </div>
                ))}
              </div>
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
            <div className="audit-table" role="table" aria-label="Audit trail">
              <div className="audit-row audit-header" role="row">
                <span role="columnheader">Action</span>
                <span role="columnheader">Actor and target</span>
                <span role="columnheader">When</span>
              </div>
              {data.auditLogs.slice(0, 12).map((log) => (
                <div className="audit-row" role="row" key={log.id}>
                  <span className="audit-action" role="cell">
                    {formatAuditAction(log.action)}
                  </span>
                  <div className="audit-actor" role="cell">
                    <strong>{log.actor_name}</strong>
                    <span>
                      {log.target_type}
                      {log.target_id ? ` #${log.target_id}` : ""}
                    </span>
                  </div>
                  <time role="cell" dateTime={log.created_at}>
                    {formatDateTime(log.created_at)}
                  </time>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState text="No audit events recorded yet." />
          )}
        </Card>
      </section>
    );
  }
  if (active === "Activity") {
    const activityPagination = activityServer.pagination;
    const activityPageSafe = activityPagination?.page || activityPage;
    const activityStart = activityPagination
      ? (activityPageSafe - 1) * activityPagination.page_size
      : 0;
    const groupedActivity = activityServer.activity.reduce((groups, event) => {
      const key = toDateKey(event.created_at);
      (groups[key] ||= []).push(event);
      return groups;
    }, {});
    const activityDateLabel = (key) => {
      const todayKey = toDateKey(new Date());
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayKey = toDateKey(yesterday);
      return key === todayKey
        ? "Today"
        : key === yesterdayKey
          ? "Yesterday"
          : formatDay(key);
    };
    return (
      <section className="workspace-view pencil-activity-view" aria-busy={activityLoading}>
        <WorkspaceViewHeading
          eyebrow="Insights"
          title="Activity"
          subtitle="Everything that changed in this workspace, and who changed it."
          action={activityLoading ? "Refreshing..." : "Refresh"}
          onAction={() => setActivityReload((current) => current + 1)}
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
              {(activityServer.filters.actors || []).map((actor) => (
                <option key={actor.id} value={actor.id}>
                  {actor.name}
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
              {(activityServer.filters.kinds || []).map((kind) => (
                <option key={kind} value={kind}>
                  {kind.replaceAll("_", " ")}
                </option>
              ))}
            </AppSelect>
          </label>
          <DateField
            label="From"
            name="activityDateFrom"
            value={activityDateFrom}
            onChange={(event) => setActivityDateFrom(event.target.value)}
            placeholder="Any date"
          />
          <DateField
            label="To"
            name="activityDateTo"
            value={activityDateTo}
            onChange={(event) => setActivityDateTo(event.target.value)}
            placeholder="Any date"
          />
          {(activitySearch || activityActor !== "all" || activityKind !== "all" || activityDateFrom || activityDateTo) && (
            <button
              type="button"
              className="text-button activity-clear"
              onClick={() => {
                setActivitySearch("");
                setActivityActor("all");
                setActivityKind("all");
                setActivityDateFrom("");
                setActivityDateTo("");
              }}
            >
              Clear filters
            </button>
          )}
        </div>
        {activityError && (
          <Alert tone="danger" compact>
            {activityError}
          </Alert>
        )}
        <Card className="activity-history">
          {activityServer.activity.length ? (
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
                activityLoading
                  ? "Loading activity..."
                  : activityPagination?.total_items === 0
                    ? "No activity matches these filters."
                    : "No workspace activity yet."
              }
            />
          )}
        </Card>
        {activityPagination && activityPagination.total_pages > 1 && (
          <div className="activity-pagination">
            <span>{`${activityStart + 1}-${activityStart + activityServer.activity.length} of ${activityPagination.total_items}`}</span>
            <div>
              <button
                type="button"
                disabled={!activityPagination.has_previous}
                onClick={() => setActivityPage(Math.max(1, activityPageSafe - 1))}
                aria-label="Previous page"
              >
                <ChevronLeft size={15} />
              </button>
              <span>
                Page {activityPageSafe} of {activityPagination.total_pages}
              </span>
              <button
                type="button"
                disabled={!activityPagination.has_next}
                onClick={() => setActivityPage(activityPageSafe + 1)}
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
        whatsNewUnread={whatsNewUnread}
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
        onWorkspaceLogoUpdated={onWorkspaceLogoUpdated}
        canManageMembers={canManageMembers}
        members={localData.members}
        membersLoading={workspaceLoading && localData.members.length === 0}
        notifications={localData.notifications}
        workspaceId={workspaceId}
        workspaces={currentUserWorkspaces}
        defaultWorkspaceId={defaultWorkspaceId}
        onSetDefaultWorkspace={onSetDefaultWorkspace}
        onCreateWorkspace={onCreateWorkspace}
        onSwitchWorkspace={onSwitchWorkspace}
        taskTemplates={localData.taskTemplates || []}
        projectTemplates={localData.projectTemplates || []}
        templatesLoading={
          workspaceLoading &&
          !(localData.taskTemplates || []).length &&
          !(localData.projectTemplates || []).length
        }
        projects={localData.projects}
        invitations={localData.invitations || []}
        onRefresh={onRefresh}
        onConfirm={onConfirm}
        onInvite={() => openComposer("invite")}
        onNavigate={onNavigate}
        onSignOut={onSignOut}
      />
    );
  }
  if (active === "Notifications") {
    const pagination = notificationPagination;
    const activityNotificationHistory = notificationHistory.filter(
      (notification) => !isConversationNotification(notification),
    );
    const summary = notificationSummary || {};
    const categoryCounts = summary.categories || {};
    const filterOptions = [
      ["all", "All", pagination?.total_items ?? activityNotificationHistory.length],
      ["unread", "Unread", summary.unread_count ?? activityNotificationHistory.filter((notification) => !notification.read).length],
      ["mentions", "Mentions", categoryCounts.messages_mentions ?? 0],
    ];
    const openFilter = (value) => {
      if (value === notificationFilter) return;
      setNotificationFilter(value);
      setNotificationPage(1);
      setNotificationHistory([]);
      setNotificationPagination(null);
      setNotificationSummary(null);
    };
    const notificationVisual = (notification) => {
      const kind = notification.kind || "";
      if (kind === "mention") return { Icon: MessageSquare, tone: "mention" };
      if (["direct_message", "channel_message"].includes(kind)) return { Icon: MessageSquare, tone: "message" };
      if (["risk_issue_assigned", "manager_activity", "membership_change", "invitation_response"].includes(kind)) {
        return { Icon: kind === "risk_issue_assigned" ? Flag : Users, tone: "risk" };
      }
      if (kind.startsWith("check_in")) return { Icon: CheckCircle2, tone: "complete" };
      if (kind.startsWith("calendar")) return { Icon: CalendarDays, tone: "calendar" };
      if (kind.includes("document") || kind.includes("attachment")) return { Icon: File, tone: "file" };
      return { Icon: ClipboardList, tone: "task" };
    };
    const notificationMeta = (notification) => {
      const typeLabel = {
        mention: "Mention",
        direct_message: "Direct message",
        channel_message: "Channel message",
        task_assigned: "Task assigned",
        task_status: "Task updated",
        task_comment: "Task comment",
        task_created: "Task created",
        follow_up_assigned: "Follow-up assigned",
        follow_up_completed: "Follow-up completed",
        check_in_submitted: "Check-in",
        check_in_comment: "Check-in comment",
        calendar_created: "Calendar created",
        calendar_updated: "Calendar updated",
        calendar_reminder: "Calendar reminder",
        risk_issue_assigned: "Risk assigned",
        manager_activity: "Manager activity",
        membership_change: "Member update",
        invitation_response: "Invitation",
      }[notification.kind];
      const label = typeLabel || (notification.kind || "Workspace update").replaceAll("_", " ");
      return [label, notification.body?.trim()].filter(Boolean).join(" · ");
    };
    const deliveryPreferences = [
      ["notification_sound", "Notification sound"],
      ["calendar_reminders", "Calendar reminders"],
      ["mentions", "Mentions"],
    ];
    return (
      <section className="workspace-view pencil-notifications-view">
        <WorkspaceViewHeading
          eyebrow="Workspace"
          title="Notifications"
          subtitle="Everything that needs your attention, newest first."
          action="Mark all read"
          icon={CheckCircle2}
          onAction={async () => {
            await onMarkNotificationsRead();
            setNotificationHistory((current) =>
              current.map((notification) => ({
                ...notification,
                read: isConversationNotification(notification) ? notification.read : true,
              })),
            );
          }}
        />
        <div className="notification-layout">
          <div className="notification-main-column">
            <div className="notification-filters" role="group" aria-label="Filter notifications">
              {filterOptions.map(([value, label, count]) => (
                <button
                  type="button"
                  key={value}
                  className={notificationFilter === value ? "is-active" : ""}
                  aria-pressed={notificationFilter === value}
                  onClick={() => openFilter(value)}
                >
                  {label} {count}
                </button>
              ))}
            </div>
            <p className="notification-summary-line">
              {summary.unread_count ?? 0} unread · {summary.weekly_total ?? 0} total this week
            </p>
            <Card className="notification-history">
              {notificationLoading && !activityNotificationHistory.length ? (
                <p className="notification-list-status">Loading notifications...</p>
              ) : notificationError ? (
                <div className="notification-list-status is-error" role="alert">
                  <span>{notificationError}</span>
                  <button className="secondary-button" onClick={() => setNotificationReload((current) => current + 1)}>
                    Retry
                  </button>
                </div>
              ) : activityNotificationHistory.length ? (
                <div className="notification-rows">
                  {activityNotificationHistory.map((notification) => {
                    const visual = notificationVisual(notification);
                    const TypeIcon = visual.Icon;
                    return (
                      <button
                        type="button"
                        key={notification.id}
                        onClick={() => onOpenNotification(notification)}
                        className={`notification-history-row ${notification.read ? "is-read" : "is-unread"}`}
                        aria-label={`Open ${notification.title}`}
                      >
                        <span
                          className={`notification-unread-dot${notification.read ? " is-hidden" : ""}`}
                          aria-hidden="true"
                        />
                        <span className={`notification-type-tile notification-type-${visual.tone}`} aria-hidden="true">
                          <TypeIcon size={18} strokeWidth={1.7} />
                        </span>
                        <span className="notification-row-copy">
                          <strong>{notification.title}</strong>
                          <small>{notificationMeta(notification)}</small>
                        </span>
                        <time dateTime={notification.created_at}>{formatRelativeActivityTime(notification.created_at)}</time>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <EmptyState text="No notifications match this filter." />
              )}
              <div className="notification-list-footer">
                <span>
                  {pagination
                    ? `Showing ${activityNotificationHistory.length} of ${pagination.total_items}`
                    : "Showing 0 notifications"}
                </span>
                {pagination?.has_next && (
                  <button
                    type="button"
                    disabled={notificationLoadingMore}
                    onClick={() => setNotificationPage((current) => current + 1)}
                  >
                    {notificationLoadingMore ? "Loading..." : "Load more"}
                  </button>
                )}
              </div>
            </Card>
          </div>
          <aside className="notification-rail" aria-label="Notification summary and delivery settings">
            <Card className="notification-summary-card">
              <h2>Unread</h2>
              <div className="notification-summary-value">
                <strong>{summary.unread_count ?? 0}</strong>
                <span>need attention</span>
              </div>
              <dl>
                <div><dt><i className="notification-bar-task" />Task updates</dt><dd>{categoryCounts.task_updates ?? 0}</dd></div>
                <div><dt><i className="notification-bar-message" />Messages and mentions</dt><dd>{categoryCounts.messages_mentions ?? 0}</dd></div>
                <div><dt><i className="notification-bar-risk" />Risks and members</dt><dd>{categoryCounts.risks_members ?? 0}</dd></div>
              </dl>
              <p>Notifications clear when you open the related item.</p>
            </Card>
            <Card className="notification-delivery-card">
              <h2>Delivery</h2>
              {notificationPreferences ? (
                <div className="notification-delivery-options">
                  {deliveryPreferences.map(([key, label]) => (
                    <div key={key}>
                      <span>{label}</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={Boolean(notificationPreferences[key])}
                        aria-label={label}
                        className={notificationPreferences[key] ? "is-on" : ""}
                        disabled={notificationPreferenceSaving === key}
                        onClick={() => updateNotificationPreference(key, !notificationPreferences[key])}
                      >
                        <span />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="notification-delivery-status">
                  {notificationPreferencesError || "Loading delivery settings..."}
                </p>
              )}
              {notificationPreferences && notificationPreferencesError && (
                <p className="notification-delivery-error" role="alert">{notificationPreferencesError}</p>
              )}
              <button type="button" className="notification-settings-link" onClick={() => onNavigate("Settings")}>
                Open notification settings
              </button>
            </Card>
          </aside>
        </div>
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
  if (active === "Import data") return <ImportView workspaceId={workspaceId} role={currentWorkspace?.role} />;
  if (active === "My planner") return <PersonalPlanner workspaceId={workspaceId} />;
  if (active === "What's new") return <WhatsNew onOpen={onWhatsNewSeen} onNavigate={onNavigate} />;
  if (active === "Install app") return <InstallAppView onNavigate={onNavigate} />;
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
      .sort((a, b) => a.due_date.localeCompare(b.due_date));
    const upcomingVisibleEvents = visibleCalendarEvents
      .filter((event) => new Date(event.start_at) >= new Date())
      .sort((a, b) => new Date(a.start_at) - new Date(b.start_at));
    const calendarEventConflicts =
      calendarEventConflictCounts(visibleCalendarEvents);
    const upcomingItems = [
      ...upcomingVisibleEvents.map((event) => ({
        kind: "event",
        key: `event-${event.id}`,
        date: new Date(event.start_at),
        event,
      })),
      ...upcomingTaskDeadlines.map((task) => ({
        kind: "task",
        key: `task-${task.id}`,
        date: new Date(`${task.due_date}T12:00:00`),
        task,
      })),
    ].sort((left, right) => left.date - right.date);
    const upcomingGroups = upcomingItems.slice(0, 12).reduce((groups, item) => {
      const group = calendarUpcomingGroup(item.date);
      let current = groups.find((entry) => entry.key === group.key);
      if (!current) {
        current = { ...group, items: [] };
        groups.push(current);
      }
      current.items.push(item);
      return groups;
    }, []);
    const agendaStart = new Date(calendarDate);
    agendaStart.setHours(0, 0, 0, 0);
    const agendaEvents = visibleCalendarEvents
      .filter(
        (event) => new Date(event.end_at || event.start_at) >= agendaStart,
      )
      .sort((a, b) => new Date(a.start_at) - new Date(b.start_at));
    const openCalendarComposerForDate = (day, hour = 9) => {
      const start = new Date(day);
      start.setHours(hour, 0, 0, 0);
      const end = new Date(start);
      end.setHours(start.getHours() + 1);
      setCalendarDate(new Date(start));
      openComposer("calendar", {
        start_at: toDateTimeLocal(start),
        end_at: toDateTimeLocal(end),
      });
    };
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
                onClick={(clickEvent) => {
                  if (clickEvent.target.closest("button, a")) return;
                  openCalendarComposerForDate(day, hour);
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
                      aria-label={`View ${event.title}`}
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
    const openCalendarEvent = (event) => {
      setCalendarDate(new Date(event.start_at));
      setSelectedEvent(event);
    };
    const upcomingItemDateLabel = (item) => {
      if (item.kind === "task") {
        return formatDate(item.date);
      }
      const event = item.event;
      const start = new Date(event.start_at);
      const end = new Date(event.end_at || event.start_at);
      const timeRange = `${formatCalendarDate(start, {
        hour: "numeric",
        minute: "2-digit",
      })} - ${formatCalendarDate(end, {
        hour: "numeric",
        minute: "2-digit",
      })}`;
      const group = calendarUpcomingGroup(item.date);
      if (group.key === "today" || group.key === "tomorrow") return timeRange;
      return `${formatDate(start)} · ${timeRange}`;
    };
    const renderUpcomingEvent = (item) => {
      const event = item.event;
      const conflictCount = calendarEventConflicts.get(event.id) || 0;
      return (
        <div
          className={`calendar-upcoming-event event-type-${event.event_type || "meeting"}`}
          key={item.key}
        >
          <button
            type="button"
            className="calendar-upcoming-event-main"
            onClick={() => openCalendarEvent(event)}
            aria-label={`View ${event.title} in the calendar`}
          >
            <CalendarDays size={15} />
            <span>
              <strong>{event.title}</strong>
              <small>
                {upcomingItemDateLabel(item)} · {event.event_type || "event"}
              </small>
              {conflictCount > 0 && (
                <em className="calendar-upcoming-conflict">
                  <AlertCircle size={12} /> Conflicts with {conflictCount} other
                  event{conflictCount === 1 ? "" : "s"}
                </em>
              )}
            </span>
          </button>
          <a
            className="calendar-upcoming-google"
            href={googleCalendarUrl(event)}
            target="_blank"
            rel="noreferrer"
            aria-label={`Add ${event.title} to Google Calendar`}
            title="Add to Google Calendar"
          >
            <ArrowUpRight size={14} />
          </a>
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
      );
    };
    const mobileCalendarDays = Array.from({ length: 6 }, (_, index) => {
      const day = new Date(calendarDate);
      day.setDate(calendarDate.getDate() - (5 - index));
      return day;
    });
    const mobileCalendarEvents = visibleCalendarEvents
      .filter((event) => toDateKey(event.start_at) === toDateKey(calendarDate))
      .sort((left, right) => new Date(left.start_at) - new Date(right.start_at));
    const mobileCalendarTabs = [
      { value: "day", label: "Day" },
      { value: "week", label: "Week" },
      { value: "month", label: "Month" },
      { value: "agenda", label: "Upcoming" },
    ];
    const calendarLegendOptions = [
      { value: "all", label: "All events", tone: "navy" },
      { value: "meeting", label: "Meetings", tone: "blue" },
      { value: "deadline", label: "Deadlines", tone: "red" },
      { value: "focus", label: "Focus time", tone: "green" },
      { value: "reminder", label: "Reminders", tone: "amber" },
    ];
    const renderMobileCalendarEvent = (event, showDate = false) => {
      const start = new Date(event.start_at);
      const end = new Date(event.end_at || event.start_at);
      const timeRange = `${formatCalendarDate(start, {
        hour: "numeric",
        minute: "2-digit",
      })} - ${formatCalendarDate(end, {
        hour: "numeric",
        minute: "2-digit",
      })}`;
      return (
        <button
          type="button"
          className={`calendar-mobile-event event-type-${event.event_type || "meeting"}`}
          key={event.id}
          onClick={() => openCalendarEvent(event)}
          aria-label={`View ${event.title}`}
        >
          <span className="calendar-mobile-event-copy">
            <strong>{event.title}</strong>
            <small>
              {showDate ? `${formatDate(start)} · ` : ""}
              {timeRange}
            </small>
          </span>
          <em>{event.event_type || "event"}</em>
        </button>
      );
    };
    const renderMobileCalendarUpcoming = () => (
      <div className="calendar-mobile-list">
        <h2>Upcoming</h2>
        {upcomingItems.slice(0, 8).length ? (
          upcomingItems.slice(0, 8).map((item) =>
            item.kind === "event" ? (
              renderMobileCalendarEvent(item.event, true)
            ) : (
              <button
                type="button"
                className="calendar-mobile-event event-type-deadline"
                key={item.key}
                onClick={() => onOpenTask(item.task)}
              >
                <span className="calendar-mobile-event-copy">
                  <strong>{item.task.title}</strong>
                  <small>
                    {formatDay(item.task.due_date)}
                    {item.task.tag && item.task.tag !== "General"
                      ? ` · ${item.task.tag}`
                      : ""}
                  </small>
                </span>
                <em>deadline</em>
              </button>
            ),
          )
        ) : (
          <EmptyState text="No upcoming events or task deadlines match this filter." />
        )}
      </div>
    );
    return (
      <section className="workspace-view pencil-calendar-view">
        <WorkspaceViewHeading
          title={title}
          subtitle="Plan meetings, focus time, deadlines, and reminders in one place."
          action="Add event"
          icon={CalendarDays}
          onAction={() => openComposer("calendar")}
        />
        <div className="calendar-mobile-agenda">
          <div className="calendar-mobile-heading">
            <h1>{formatCalendarDate(calendarDate, { month: "long" })}</h1>
            <Button
              type="button"
              size="sm"
              onClick={() => openComposer("calendar")}
            >
              <Plus size={15} />
              New
            </Button>
          </div>
          <div className="calendar-mobile-tabs" role="tablist" aria-label="Calendar view">
            {mobileCalendarTabs.map((tab) => (
              <button
                type="button"
                role="tab"
                aria-selected={calendarView === tab.value}
                className={calendarView === tab.value ? "active" : ""}
                key={tab.value}
                onClick={() => setCalendarView(tab.value)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {calendarView !== "agenda" && (
            <div className="calendar-mobile-date-strip">
              {mobileCalendarDays.map((day) => {
                const selected = toDateKey(day) === toDateKey(calendarDate);
                const hasEvents = visibleCalendarEvents.some(
                  (event) => toDateKey(event.start_at) === toDateKey(day),
                );
                return (
                  <button
                    type="button"
                    className={selected ? "active" : ""}
                    key={day.toISOString()}
                    onClick={() => setCalendarDate(new Date(day))}
                    aria-label={`Show ${formatDate(day)}`}
                  >
                    <span>{formatCalendarDate(day, { weekday: "short" })}</span>
                    <strong>{formatCalendarDate(day, { day: "numeric" })}</strong>
                    {hasEvents && <i aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          )}
          {calendarView === "agenda" ? (
            renderMobileCalendarUpcoming()
          ) : (
            <div className="calendar-mobile-list">
              <h2>
                {toDateKey(calendarDate) === today
                  ? "Today"
                  : formatDate(calendarDate)}
              </h2>
              {mobileCalendarEvents.length ? (
                mobileCalendarEvents.map((event) => renderMobileCalendarEvent(event))
              ) : (
                <EmptyState text="No events match this filter." />
              )}
            </div>
          )}
        </div>
        <div className="calendar-toolbar">
          <div className="calendar-view-control">
            <Tabs
              value={calendarView}
              onValueChange={setCalendarView}
              className="calendar-view-switch"
            >
              <TabsList aria-label="Calendar view">
                {["month", "week", "day"].map((view) => (
                  <TabsTrigger key={view} value={view}>
                    {view[0].toUpperCase() + view.slice(1)}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <Popover
              open={calendarViewMenuOpen}
              onOpenChange={setCalendarViewMenuOpen}
            >
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className={`calendar-view-more${["year", "agenda"].includes(calendarView) ? " is-active" : ""}`}
                  aria-label="More calendar views"
                  aria-pressed={["year", "agenda"].includes(calendarView)}
                >
                  <MoreHorizontal size={17} />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                sideOffset={6}
                className="calendar-view-menu"
              >
                {["year", "agenda"].map((view) => (
                  <button
                    type="button"
                    key={view}
                    className={calendarView === view ? "is-active" : ""}
                    onClick={() => {
                      setCalendarView(view);
                      setCalendarViewMenuOpen(false);
                    }}
                  >
                    {view[0].toUpperCase() + view.slice(1)}
                  </button>
                ))}
              </PopoverContent>
            </Popover>
          </div>
          <div className="calendar-toolbar-nav">
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
                  className="calendar-heading-trigger"
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
          <Button
            type="button"
            variant="outline"
            className="calendar-today-button"
            onClick={() => setCalendarDate(new Date())}
          >
            Today
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="calendar-upcoming-side-toggle"
            onClick={toggleCalendarUpcoming}
            aria-expanded={calendarUpcomingOpen}
            aria-controls="calendar-upcoming-panel"
            aria-label={
              calendarUpcomingOpen
                ? "Collapse upcoming panel"
                : "Show upcoming panel"
            }
            title={
              calendarUpcomingOpen
                ? "Collapse upcoming panel"
                : "Show upcoming panel"
            }
          >
            {calendarUpcomingOpen ? (
              <PanelRightClose size={16} />
            ) : (
              <PanelRightOpen size={16} />
            )}
          </Button>
        </div>
        <div
          className={`calendar-layout${calendarUpcomingOpen ? "" : " is-upcoming-collapsed"}`}
        >
          <Card
            className={`calendar-week calendar-view-${calendarView} gap-0 py-0 overflow-hidden`}
          >
            <CardContent
              className={
                calendarView === "agenda"
                  ? "calendar-agenda px-5"
                  : calendarView === "day" || calendarView === "week"
                    ? "calendar-time-content px-0"
                    : "calendar-month-content px-0"
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
                        <strong>{formatDate(event.start_at)}</strong>
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
                <>
                  {calendarView === "month" && (
                    <div className="calendar-month-weekdays" aria-hidden="true">
                      {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(
                        (weekday) => (
                          <span key={weekday}>{weekday}</span>
                        ),
                      )}
                    </div>
                  )}
                  <div className="calendar-grid">
                    {calendarDays.map((day) => (
                      <div
                        className={`calendar-day${toDateKey(day) === today ? " is-today" : ""}`}
                        key={day.toISOString()}
                        onClick={(clickEvent) => {
                          if (clickEvent.target.closest("button, a")) return;
                          openCalendarComposerForDate(day);
                        }}
                        title="Click to add an event"
                      >
                        <div className="calendar-day-heading">
                          <strong>
                            <span className="calendar-date-number">
                              {calendarView === "year"
                                ? formatCalendarDate(day, {
                                    month: "short",
                                    day: "numeric",
                                  })
                                : formatCalendarDate(day, { day: "numeric" })}
                            </span>
                          </strong>
                          {calendarView !== "year" && (
                            <button
                              type="button"
                              className="calendar-day-add"
                              onClick={() => openCalendarComposerForDate(day)}
                              aria-label={`Add event on ${formatDate(day)}`}
                              title="Add event"
                            >
                              <Plus size={13} />
                            </button>
                          )}
                        </div>
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
                                  {calendarView === "year"
                                    ? formatDayMonth(new Date(event.start_at))
                                    : formatCalendarDate(
                                        new Date(event.start_at),
                                        {
                                          hour: "numeric",
                                          minute: "2-digit",
                                        },
                                      )}
                                </span>
                                <span className="event-pill-title">
                                  {event.title}
                                </span>
                              </button>
                            ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
          {calendarUpcomingOpen && (
            <div className="calendar-side-stack">
              <Card
                id="calendar-upcoming-panel"
                className="calendar-upcoming-card"
              >
                <div className="calendar-side-heading">
                  <h3 className="calendar-upcoming-title">Upcoming</h3>
                  <span className="calendar-upcoming-meta">
                    {formatCalendarDate(new Date(), {
                      weekday: "short",
                      day: "numeric",
                      month: "short",
                    })}
                  </span>
                  <span className="calendar-upcoming-actions">
                    <a
                      className="calendar-export"
                      href={`/api/workspaces/${workspaceId}/calendar.ics`}
                      download
                      aria-label="Export calendar as ICS"
                      title="Export ICS"
                    >
                      <Download size={15} />
                    </a>
                    <button
                      type="button"
                      className="calendar-export"
                      onClick={() => onNavigate("Settings")}
                      aria-label="Get a calendar subscribe link"
                      title="Subscribe in Settings"
                    >
                      <Link2 size={15} />
                    </button>
                    <button
                      type="button"
                      className="calendar-export"
                      onClick={toggleCalendarUpcoming}
                      aria-label="Collapse upcoming panel"
                      title="Collapse upcoming panel"
                    >
                      <PanelRightClose size={15} />
                    </button>
                  </span>
                </div>
                <div className="calendar-upcoming-content">
                  {upcomingItems.length ? (
                    <div className="calendar-upcoming-groups">
                      {upcomingItems.slice(0, 6).map((item) =>
                        item.kind === "event" ? (
                          renderUpcomingEvent(item)
                        ) : (
                          <button
                            type="button"
                            className="calendar-task-deadline calendar-upcoming-task"
                            key={item.key}
                            onClick={() => onOpenTask(item.task)}
                          >
                            <CalendarDays size={15} />
                            <span>
                              <small>{formatDay(item.task.due_date)}</small>
                              <strong>{item.task.title}</strong>
                            </span>
                          </button>
                        ),
                      )}
                    </div>
                  ) : (
                    <EmptyState text="No upcoming events or task deadlines match this filter." />
                  )}
                </div>
              </Card>
              <Card className="calendar-calendars-card">
                <div className="calendar-side-heading">
                  <h3>Calendars</h3>
                </div>
                <div className="calendar-legend-list">
                  {calendarLegendOptions.map((option) => {
                    const isOn =
                      calendarFilter === "all" ||
                      calendarFilter === option.value;
                    return (
                      <button
                        type="button"
                        className={`calendar-legend-toggle tone-${option.tone}${isOn ? " is-on" : ""}`}
                        key={option.value}
                        aria-pressed={isOn}
                        onClick={() =>
                          setCalendarFilter((current) =>
                            option.value !== "all" && current === option.value
                              ? "all"
                              : option.value,
                          )
                        }
                      >
                        <i aria-hidden="true" />
                        <span>{option.label}</span>
                        <b aria-hidden="true" />
                      </button>
                    );
                  })}
                </div>
                <div className="calendar-legend-rule" />
                <label className="calendar-work-filter">
                  <span>Task deadlines</span>
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
              </Card>
            </div>
          )}
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
    const checkInRangeOptions = ["all", "today", "week", "month"]
      .map((value) => CHECK_IN_RANGES.find((range) => range.value === value))
      .filter(Boolean);
    const checkInRangeCounts = Object.fromEntries(
      CHECK_IN_RANGES.map((range) => [
        range.value,
        filterCheckInsByRange(localData.checkIns, range.value, today).length,
      ]),
    );
    const visibleCheckIns = filterCheckInsByRange(
      localData.checkIns,
      checkInRange,
      today,
    );
    const activeRangeLabel =
      CHECK_IN_RANGES.find((range) => range.value === checkInRange)?.label ||
      "Today";
    const checkInDateLabel = (value) =>
      value === today
        ? "Today"
        : formatDay(value);

    return (
      <section className="workspace-view pencil-checkins-view">
        <WorkspaceViewHeading
          eyebrow="Collaborate"
          title={title}
          subtitle={subtitle}
          action="My check-in"
          icon={MessageSquare}
          onAction={() => openComposer("checkin")}
        />
        <div className="checkin-toolbar">
          <div
            className="checkin-range-filter"
            role="tablist"
            aria-label="Filter check-ins by date range"
          >
            {checkInRangeOptions.map((range) => (
              <button
                type="button"
                role="tab"
                key={range.value}
                aria-selected={checkInRange === range.value}
                aria-label={`${range.label}: ${checkInRangeCounts[range.value]} check-ins`}
                className={checkInRange === range.value ? "active" : ""}
                onClick={() => setCheckInRange(range.value)}
              >
                <span className="checkin-range-label">{range.label}</span>
                <span className="checkin-range-count">
                  {checkInRangeCounts[range.value]}
                </span>
              </button>
            ))}
          </div>
          <span className="checkin-date-chip" aria-live="polite">
            <CalendarDays size={16} aria-hidden="true" />
            <span>
              {formatCalendarDate(new Date(), {
                weekday: "short",
                day: "numeric",
                month: "short",
              })}
            </span>
            <span className="sr-only">
              {visibleCheckIns.length} check-in
              {visibleCheckIns.length === 1 ? "" : "s"} in{" "}
              {activeRangeLabel.toLowerCase()}
            </span>
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
        <div className="pencil-checkin-layout">
        <div className="checkin-grid">
          {visibleCheckIns.length ? (
            visibleCheckIns.map((checkIn) => (
              <Card
                className="checkin-summary-card"
                key={checkIn.id}
                role="button"
                tabIndex={0}
                aria-label={`View ${checkIn.user_name}'s check-in for ${formatDay(checkIn.date)}`}
                onClick={() => setSelectedCheckInDetail(checkIn)}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  setSelectedCheckInDetail(checkIn);
                }}
              >
                <div className="checkin-summary-head">
                  <div className="card-person">
                    <span className="avatar blue small">
                      {checkIn.user_initials}
                    </span>
                    <div>
                      <strong>{checkIn.user_name}</strong>
                      <span>{checkInDateLabel(checkIn.date)}</span>
                    </div>
                  </div>
                  <div className="checkin-summary-actions">
                    {checkIn.user_id === currentUserId && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedCheckIn(checkIn);
                        }}
                        aria-label={`Edit ${checkIn.user_name}'s check-in`}
                      >
                        <MoreHorizontal size={14} />
                      </Button>
                    )}
                    <ChevronRight size={16} aria-hidden="true" />
                  </div>
                </div>
                <div className="checkin-summary-fields">
                  <div className="checkin-summary-field">
                    <span>
                      <CheckCircle2 size={12} aria-hidden="true" /> Completed
                    </span>
                    <p>{checkIn.completed || "No update yet"}</p>
                  </div>
                  <div className="checkin-summary-field">
                    <span>
                      <ArrowUpRight size={12} aria-hidden="true" /> Next
                    </span>
                    <p>{checkIn.next_steps || "No next step recorded"}</p>
                  </div>
                  <div
                    className={`checkin-summary-field ${checkIn.blockers ? "has-blocker" : ""}`}
                  >
                    <span>
                      <AlertCircle size={12} aria-hidden="true" /> Blockers
                    </span>
                    <p>{checkIn.blockers || "None reported"}</p>
                  </div>
                </div>
                <div className="checkin-summary-footer">
                  <span>{checkInDateLabel(checkIn.date)}</span>
                  {checkIn.blockers ? (
                    <span className="checkin-blocker-flag">
                      <AlertCircle size={11} aria-hidden="true" /> Blocked
                    </span>
                  ) : (
                    <span className="checkin-no-blocker">No blocker</span>
                  )}
                </div>
              </Card>
            ))
          ) : (
            <EmptyState
              text={`No check-ins in ${activeRangeLabel.toLowerCase()}. Start the first update.`}
            />
          )}
        </div>
        <aside className="pencil-checkin-side">
          <section className="pencil-checkin-card"><h2>Today&apos;s check-ins</h2><strong>{visibleCheckIns.length} of {localData.members.length}<small>received</small></strong><div className="pencil-checkin-progress"><i style={{ width: `${localData.members.length ? Math.min(100, Math.round((visibleCheckIns.length / localData.members.length) * 100)) : 0}%` }} /></div><p>{Math.max(0, localData.members.length - visibleCheckIns.length)} members still to submit</p><div className="pencil-checkin-missing">{localData.members.filter((member) => !visibleCheckIns.some((item) => String(item.user_id) === String(member.id))).slice(0, 4).map((member) => { const memberName = [member.first_name, member.last_name].filter(Boolean).join(" ") || member.email; return <div key={member.id}><Avatar name={memberName} avatarUrl={member.avatar_url} className="pencil-checkin-missing-avatar" /><span>{memberName}</span><button type="button" onClick={() => onNavigate("Chats")}>Nudge</button></div>; })}</div></section>
          <section className="pencil-checkin-card"><h2>Blockers raised today</h2>{visibleCheckIns.filter((item) => item.blockers).slice(0, 3).map((item) => <div className="pencil-checkin-blocker" key={item.id}><i /> <span>{item.blockers}<small>{item.user_name}</small></span></div>)}{!visibleCheckIns.some((item) => item.blockers) && <p>No blockers reported today.</p>}</section>
        </aside>
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
      onTrack: withStats.filter((project) =>
        project.health === "on-track" || project.status === "completed",
      ).length,
      attention: withStats.filter(
        (project) =>
          ["at-risk", "off-track"].includes(project.health) ||
          project.blocked > 0 ||
          (project.status !== "completed" && project.due_date && project.due_date < today),
      ).length,
      completed: withStats.filter((project) => project.status === "completed").length,
      budgetUsage: withStats
        .map((project) => project.budget_used_percent ?? project.budget_usage_percent)
        .find((value) => value !== null && value !== undefined),
    };
    if (selectedProjectWorkspace) {
      const projectTasks = tasks.filter((task) => String(task.project_id || "") === String(selectedProjectWorkspace.id));
      const projectMetrics = selectedProjectWorkspace.metrics;
      const projectTotal = projectMetrics?.applicable_tasks ?? projectTasks.length;
      const projectCompleted = projectMetrics?.completed_tasks ?? projectTasks.filter((task) => task.status === "done").length;
      const projectBlocked = projectMetrics?.blocked_tasks ?? projectTasks.filter((task) => task.status === "blocked").length;
      const projectOverdue = projectMetrics?.overdue_tasks ?? projectTasks.filter((task) => task.status !== "done" && task.due_date && task.due_date < today).length;
      const projectBlockedCount = Math.max(projectBlocked, projectTasks.filter((task) => task.status === "blocked").length);
      const projectOverdueCount = Math.max(projectOverdue, projectTasks.filter((task) => task.status !== "done" && task.due_date && task.due_date < today).length);
      const projectAttention = projectBlockedCount + projectOverdueCount;
      const projectOpen = Math.max(0, projectTotal - projectCompleted);
      const projectProgress = projectMetrics?.completion_rate ?? (projectTotal ? Math.round((projectCompleted / projectTotal) * 100) : 0);
      const projectDeadline = selectedProjectWorkspace.due_date ? formatDay(selectedProjectWorkspace.due_date) : "No deadline set";
      const projectBlockers = projectTasks
        .filter((task) => task.status === "blocked" || (task.status !== "done" && task.due_date && task.due_date < today))
        .slice(0, 4);
      const projectDeadlineDays = selectedProjectWorkspace.due_date
        ? Math.ceil(
            (new Date(`${selectedProjectWorkspace.due_date}T12:00:00`) -
              new Date(`${today}T12:00:00`)) /
              86400000,
          )
        : null;
      const openOperation = (operation) => {
        setProjectOperation(operation);
        if (operation === "activity") setProjectActivityFilter("all");
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
        <section className={`workspace-view project-detail-view ${projectOperation ? "has-operation" : ""}`}>
          <div className="project-detail-header">
            <button type="button" className="project-detail-back" onClick={projectOperation ? () => setProjectOperation("") : closeProject}>
              <ChevronLeft size={16} /> {projectOperation ? "Back to project overview" : "Back to projects"}
            </button>
            <div className="project-detail-title-row">
              <h1>{selectedProjectWorkspace.name}</h1>
              <span className={`project-health ${selectedProjectWorkspace.health || "on-track"}`}>
                {(selectedProjectWorkspace.health || "on-track").replace("-", " ")}
              </span>
              <span className={`project-status-badge ${selectedProjectWorkspace.status}`}>
                {selectedProjectWorkspace.status}
              </span>
              <ClipboardList size={15} />
              <span className="project-detail-meta-line">{projectTotal} tasks</span>
              {projectOperation === "tasks" && canManageTasks ? (
                <button
                  type="button"
                  className="project-detail-primary-action"
                  onClick={() => onAddTask(null, { projectId: selectedProjectWorkspace.id })}
                >
                  <Plus size={15} /> New task
                </button>
              ) : canManageMembers ? (
                <button type="button" className="project-detail-primary-action" onClick={() => setSelectedProject(selectedProjectWorkspace)}>Edit project</button>
              ) : null}
            </div>
          </div>
          <p className="project-detail-description">{selectedProjectWorkspace.description || "Project workspace and delivery controls."}</p>
          <div className="project-detail-meta-row project-detail-header-meta">
            <span className="project-owner-avatar" aria-hidden="true">{(selectedProjectWorkspace.owner_name || "U").trim().charAt(0).toUpperCase()}</span>
            <span>{selectedProjectWorkspace.owner_name || "Unassigned · Core squad"}</span>
            <CalendarDays size={16} />
            <span>{selectedProjectWorkspace.due_date ? projectDeadline : "No deadline set"}</span>
            <Users size={16} />
            <span>{selectedProjectWorkspace.member_count || 0} members assigned</span>
            <span className="project-detail-header-updated">Updated {formatRelativeActivityTime(selectedProjectWorkspace.updated_at)}</span>
          </div>
          <div className="project-detail-divider" />
          <div className="project-detail-tabs" role="tablist" aria-label="Project sections">
            <button type="button" className={!projectOperation ? "active" : ""} role="tab" aria-selected={!projectOperation} onClick={() => setProjectOperation("")}>Overview</button>
            <button type="button" className={projectOperation === "kanban" ? "active" : ""} role="tab" aria-selected={projectOperation === "kanban"} onClick={() => openOperation("kanban")}>Kanban</button>
            <button type="button" className={projectOperation === "tasks" ? "active" : ""} role="tab" aria-selected={projectOperation === "tasks"} onClick={() => openOperation("tasks")}>Tasks</button>
            <button type="button" className={projectOperation === "risks" ? "active" : ""} role="tab" aria-selected={projectOperation === "risks"} onClick={() => openOperation("risks")}>Risks</button>
            <button type="button" className={projectOperation === "issues" ? "active" : ""} role="tab" aria-selected={projectOperation === "issues"} onClick={() => openOperation("issues")}>Issues</button>
            <button type="button" className={projectOperation === "resources" ? "active" : ""} role="tab" aria-selected={projectOperation === "resources"} onClick={() => openOperation("resources")}>Resources</button>
            <button type="button" className={projectOperation === "budget" ? "active" : ""} role="tab" aria-selected={projectOperation === "budget"} onClick={() => openOperation("budget")}>Budget</button>
            <button type="button" className={projectOperation === "activity" ? "active" : ""} role="tab" aria-selected={projectOperation === "activity"} onClick={() => openOperation("activity")}>Activity</button>
          </div>
          {!projectOperation && (
            <>
              <div className="project-detail-overview">
                <div className="project-detail-main-column">
                  <section className="project-detail-card project-detail-progress-card">
                    <div className="project-detail-card-heading"><h2>Progress</h2><strong>{projectProgress}%</strong></div>
                    <p className="project-overview-progress-copy">{projectCompleted} of {projectTotal} tasks complete{selectedProjectWorkspace.due_date ? ` - revised ${projectDeadline}` : ""}</p>
                    <div className="project-detail-progress-track" role="progressbar" aria-label={`${projectProgress}% of project tasks complete`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={projectProgress}><span style={{ width: `${projectProgress}%` }} /></div>
                    <div className="project-overview-progress-stats"><span><strong>{projectCompleted}</strong>Completed</span><span><strong>{projectOpen}</strong>Remaining</span><time>{selectedProjectWorkspace.due_date ? `Revised ${projectDeadline}` : "No deadline set"}</time></div>
                  </section>
                  <section className="project-detail-card project-overview-totals">
                    <div className="project-detail-card-heading"><h2>Task totals</h2><span>{projectTotal} tasks in this project</span></div>
                    <div className="project-detail-stat-grid project-overview-stat-grid">
                      <div className="is-success"><span className="project-overview-stat-icon"><CheckCircle2 size={15} /></span><strong>{projectCompleted}</strong><span>Completed</span></div>
                      <div><span className="project-overview-stat-icon"><Clock3 size={15} /></span><strong>{projectOpen}</strong><span>Open</span></div>
                      <div className={projectBlockedCount ? "is-danger" : ""}><span className="project-overview-stat-icon"><CircleSlash size={15} /></span><strong>{projectBlockedCount}</strong><span>Blocked</span></div>
                      <div className={projectOverdueCount ? "is-warning" : ""}><span className="project-overview-stat-icon"><AlertTriangle size={15} /></span><strong>{projectOverdueCount}</strong><span>Overdue</span></div>
                    </div>
                  </section>
                  <section className="project-detail-card project-overview-blockers">
                    <div className="project-detail-card-heading"><h2>Current blockers</h2><span className="project-detail-card-note is-alert">{projectAttention} blocking delivery</span></div>
                    {projectBlockers.length ? <div className="project-overview-blocker-list">{projectBlockers.map((task) => <button type="button" key={task.id} onClick={() => onOpenTask(task)}><span className={task.status === "blocked" ? "is-danger" : "is-warning"} /><span><strong>{task.title}</strong><small>{task.member || "Unassigned"} - {task.blocker_details || (task.status === "blocked" ? "Blocked task" : `Due ${formatDay(task.due_date)}`)}</small></span><em>{task.status === "blocked" ? "Blocked" : task.due || "Overdue"}</em></button>)}</div> : <p className="project-detail-empty">No blockers or overdue tasks in this project.</p>}
                  </section>
                  <section className="project-detail-card project-detail-recent-activity project-overview-activity">
                    <div className="project-detail-card-heading"><h2>Recent activity</h2><button type="button" className="project-overview-activity-link" onClick={() => openOperation("activity")}>View all activity</button></div>
                    {projectOverviewActivity.length ? <div className="project-overview-activity-list">{projectOverviewActivity.map((item) => <button type="button" key={item.id} onClick={() => openOperation("activity")}><span className="project-overview-activity-avatar" aria-hidden="true">{String(item.actor_name || "S").trim().charAt(0).toUpperCase()}</span><span><strong>{item.message || item.description || "Project activity updated"}</strong><small>{item.actor_name || "System"} - {formatRelativeActivityTime(item.created_at || item.updated_at)}</small></span><ActivityIcon size={16} /></button>)}</div> : <p className="project-detail-empty">No recent project activity is available yet.</p>}
                  </section>
                </div>
                <aside className="project-detail-side-column">
                  <ProjectOperationsSummary project={selectedProjectWorkspace} workspaceId={workspaceId} openTasks={projectOpen} blockedTasks={projectBlockedCount} overdueTasks={projectOverdueCount} onOpen={openOperation} />
                  <section className="project-detail-card project-overview-deadline">
                    <div className="project-detail-card-heading"><h2>Upcoming deadline</h2><span className={`project-health ${selectedProjectWorkspace.health || "on-track"}`}>{(selectedProjectWorkspace.health || "on-track").replace("-", " ")}</span></div>
                    <p className="project-detail-deadline">{projectDeadline}</p>
                    <p className="project-detail-card-note">{projectDeadlineDays === null ? "No deadline has been set." : projectDeadlineDays < 0 ? `${Math.abs(projectDeadlineDays)} days past due.` : projectDeadlineDays === 0 ? "Due today." : `Due in ${projectDeadlineDays} days.`}</p>
                    <div className="project-overview-deadline-footer"><span>{projectOpen} open {projectOpen === 1 ? "task" : "tasks"} remaining</span><strong>{projectAttention ? `${projectAttention} ${projectAttention === 1 ? "blocker" : "blockers"}` : "No blockers"}</strong></div>
                  </section>
                  <section className="project-detail-card project-detail-quick-actions project-overview-quick-actions">
                    <div className="project-detail-card-heading"><h2>Quick actions</h2></div>
                    <div className="project-overview-action-grid">
                      <button type="button" className="is-primary" onClick={() => onAddTask(null, { projectId: selectedProjectWorkspace.id })}><Plus size={16} />New task</button>
                      <button type="button" onClick={() => openOperation("risks")}><Flag size={16} />Log risk</button>
                      <button type="button" onClick={() => openOperation("issues")}><AlertCircle size={16} />Log issue</button>
                      <button type="button" onClick={() => openOperation("activity")}><ActivityIcon size={16} />View activity</button>
                    </div>
                  </section>
                </aside>
              </div>
            </>
          )}
          {projectOperation === "risks" && (
            <ProjectRiskIssuePanel
              projects={[selectedProjectWorkspace]}
              workspaceId={workspaceId}
              tasks={tasks}
              canManage={canManageMembers}
              design="p32"
            />
          )}
          {projectOperation === "kanban" && (
            <section className="project-operation-surface project-kanban-surface">
              <ProjectKanbanBoard
                tasks={projectTasks}
                members={localData.members}
                onOpenTask={onOpenTask}
                onStatusChange={onStatusChange}
                onAddTask={onAddTask ? (column) => onAddTask(null, { projectId: selectedProjectWorkspace.id, status: column?.apiStatus || "todo" }) : undefined}
                canManageTasks={canManageTasks}
                columnOrder={selectedProjectWorkspace.configuration?.kanban_column_order}
                onColumnReorder={(columnOrder) => reorderProjectKanbanColumns(selectedProjectWorkspace, columnOrder)}
                canReorderColumns={canManageTasks}
                canDeletePermanently={currentWorkspace?.role === "owner"}
                onBulkArchive={onBulkArchive}
                onBulkDelete={onBulkDelete}
                onBulkMove={onBulkChangeStatus}
              />
            </section>
          )}
          {projectOperation === "tasks" && (
            <ProjectTaskTable
              tasks={projectTasks}
              members={localData.members}
              canManageTasks={canManageTasks}
              today={today}
              onOpenTask={onOpenTask}
              onComplete={onComplete}
              onStatusChange={onStatusChange}
            />
          )}
          {projectOperation === "issues" && (
            <ProjectRiskIssuePanel
              projects={[selectedProjectWorkspace]}
              workspaceId={workspaceId}
              tasks={tasks}
              canManage={canManageMembers}
              design="p33"
            />
          )}
          {projectOperation === "resources" && (
            <ProjectStakeholderResourcePanel
              project={selectedProjectWorkspace}
              workspaceId={workspaceId}
              canManage={canManageMembers}
              tasks={tasks}
              design="p34"
            />
          )}
          {projectOperation === "budget" && (
            <ProjectCostBudgetPanel
              project={selectedProjectWorkspace}
              workspaceId={workspaceId}
              canManage={canManageMembers}
              design="p35"
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
          {projectOperation === "activity" && (
            <section className="project-activity-surface">
              <div className="project-activity-filter-label">Filter activity</div>
              <div className="project-activity-chips" role="group" aria-label="Filter project activity">
                {["All", "Tasks", "Risks", "Issues", "Budget", "Resources", "Stakeholders", "Comments"].map((label) => (
                  <button
                    type="button"
                    className={projectActivityFilter === label.toLowerCase() ? "active" : ""}
                    aria-pressed={projectActivityFilter === label.toLowerCase()}
                    key={label}
                    onClick={() => setProjectActivityFilter(label.toLowerCase())}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="project-activity-list">
                {(localData.activity || [])
                  .filter((item) => String(item.project_id || "") === String(selectedProjectWorkspace.id))
                  .filter((item) => {
                    if (projectActivityFilter === "all") return true;
                    const kind = String(item.kind || "").toLowerCase();
                    if (projectActivityFilter === "tasks") return kind.startsWith("task_");
                    if (projectActivityFilter === "risks") return kind.startsWith("risk_");
                    if (projectActivityFilter === "issues") return kind.startsWith("issue_");
                    if (projectActivityFilter === "budget") return kind.includes("budget") || kind.includes("expense");
                    if (projectActivityFilter === "resources") return kind.includes("resource");
                    if (projectActivityFilter === "stakeholders") return kind.includes("stakeholder");
                    if (projectActivityFilter === "comments") return kind.includes("comment");
                    return true;
                  })
                  .map((item) => (
                    <div className="project-activity-row" key={item.id}>
                      <RefreshCw size={18} />
                      <div>
                        <strong>{item.description || item.message || "Project activity updated"}</strong>
                        <small>{item.actor_name ? `${item.actor_name} - ` : ""}{formatRelativeActivityTime(item.created_at || item.updated_at)}</small>
                      </div>
                      <ArrowUpRight size={16} aria-hidden="true" />
                    </div>
                  ))}
                {!(localData.activity || []).some((item) => String(item.project_id || "") === String(selectedProjectWorkspace.id)) && (
                  <p className="project-detail-empty">Project-scoped activity is not available from the current activity API.</p>
                )}
              </div>
            </section>
          )}
          {selectedProject && (
            <ProjectEditDialog
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
              design="p35"
            />
          )}
        </section>
      );
    }
    return (
      <section className="workspace-view projects-view">
        <WorkspaceViewHeading
          eyebrow="Portfolio"
          title="Projects"
          subtitle="Ownership, progress, risk and budget across every active initiative."
          action={canManageMembers ? "New project" : undefined}
          onAction={() => openComposer("project")}
        />
        <div className="project-summary">
          <div>
            <strong>{summary.active}</strong>
            <span>Active projects</span>
            <small>{summary.completed || 0} completed this quarter</small>
          </div>
          <div>
            <strong>{summary.onTrack}</strong>
            <span>On track</span>
            <small>{withStats.length ? Math.round((summary.onTrack / withStats.length) * 100) : 0}% of the portfolio</small>
          </div>
          <div className="is-warning">
            <strong>{summary.attention}</strong>
            <span>Needs attention</span>
            <small>At risk, delayed or blocked</small>
          </div>
          <div>
            <strong>{summary.budgetUsage !== undefined ? `${Math.round(Number(summary.budgetUsage))}%` : "—"}</strong>
            <span>Budget used</span>
            <small>{summary.budgetUsage !== undefined ? "Across the portfolio" : "No budget data available"}</small>
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
          <div className="project-view-toggle" role="group" aria-label="Project view">
            <button type="button" className={projectViewMode === "grid" ? "active" : ""} aria-pressed={projectViewMode === "grid"} onClick={() => setProjectViewMode("grid")} aria-label="Grid view"><LayoutGrid size={16} /></button>
            <button type="button" className={projectViewMode === "list" ? "active" : ""} aria-pressed={projectViewMode === "list"} onClick={() => setProjectViewMode("list")} aria-label="List view"><List size={16} /></button>
          </div>
        </div>
        <p className="project-result-count">
          {visibleProjects.length} projects · {summary.attention} need attention · sorted by {projectSort === "updated" ? "last updated" : projectSort}
        </p>
        <div className={`project-grid ${projectViewMode === "list" ? "is-list" : ""}`}>
          {visibleProjects.length ? (
            visibleProjects.map((project) => (
              <Card
                className={`project-card project-health-${project.health}`}
                key={project.id}
              >
                <div className="project-card-heading">
                  <h3>{project.name}</h3>
                  <span className={`project-health ${project.health}`}>
                    {project.health.replace("-", " ")}
                  </span>
                </div>
                <p className="project-card-description">
                  {project.description || "No project description yet."}
                </p>
                <div className="project-card-owner-row">
                  <span className="project-owner-avatar" aria-hidden="true">
                    {(project.owner_name || "U").trim().charAt(0).toUpperCase()}
                  </span>
                  <span className="project-owner-name">
                    {project.owner_name || "Unassigned · Core squad"}
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
                </div>
                <div className="project-card-rule" />
                <ProjectProgress project={project} tasks={tasks} />
                <div className="project-task-stats">
                  <span><strong>{project.taskCount - project.completed}</strong>open</span>
                  <span className={project.blocked ? "risk" : ""}><strong>{project.blocked}</strong>blocked</span>
                  <span className={project.overdue ? "danger" : ""}><strong>{project.overdue}</strong>overdue</span>
                </div>
                <div className="project-footer">
                  <span className="project-updated">
                    {project.updated_at
                      ? `Updated ${formatRelativeActivityTime(project.updated_at)}`
                      : project.due_date
                        ? `Due ${formatDay(project.due_date)}`
                        : "Updated recently"}
                  </span>
                  <button
                    type="button"
                    className="project-open-button"
                    onClick={() => {
                      setSelectedProjectWorkspace(project);
                      setProjectOperation("");
                    }}
                    aria-label={`Open ${project.name}`}
                  >
                    Open <ArrowUpRight size={13} />
                  </button>
                  {canManageMembers && (
                    <>
                      <Button type="button" variant="ghost" size="icon-sm" className="project-card-action" onClick={() => setSelectedProject(project)} aria-label={`Edit ${project.name}`}>
                        <Pencil size={14} />
                      </Button>
                      <Button type="button" variant="ghost" size="icon-sm" className="project-card-action" onClick={() => deleteProject(project)} aria-label={`Delete ${project.name}`}>
                        <MoreHorizontal size={14} />
                      </Button>
                    </>
                  )}
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
          <ProjectEditDialog
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

  // Files is no longer offered in the navigation, on either the sidebar or the
  // mobile drawer. The page itself stays reachable because a document
  // notification opens it directly, and there is nowhere else a document can be
  // shown; removing the route would break that link rather than hide a page.
  if (active === "Files") {
    return (
      <Suspense fallback={null}>
        <FilesWorkspaceView
          workspaceId={workspaceId}
          currentUserId={currentUserId}
          notificationDocumentId={pendingDocumentId}
          onNotificationDocumentHandled={() => setPendingDocumentId(null)}
        />
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
          threadRequest={chatThreadRequest}
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
        (followUpFilter === "today" &&
          followUp.status === "open" &&
          followUp.due_date === today) ||
        (followUpFilter === "overdue" && isOverdueFollowUp(followUp)),
    );
    const dueToday = visibleFollowUps.filter((item) => item.status === "open" && item.due_date === today).length;
    const overdueFollowUps = visibleFollowUps.filter(isOverdueFollowUp).length;
    const updateFollowUpForm = (event) =>
      setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
    return (
      <section className="workspace-view pencil-followup-view">
        <WorkspaceViewHeading
          title={title}
          subtitle={subtitle}
          eyebrow="Collaborate"
          action="New follow-up"
          onAction={() => openComposer("followup")}
        />
        <div className="pencil-followup-filters" role="tablist" aria-label="Filter follow-ups">
          {[["all", "All"], ["today", "Due today"], ["overdue", "Overdue"], ["completed", "Done"]].map(([value, label]) => <button type="button" key={value} className={followUpFilter === value ? "active" : ""} onClick={() => setFollowUpFilter(value)}>{label} {value === "all" ? localData.followUps.length : value === "today" ? dueToday : value === "overdue" ? overdueFollowUps : localData.followUps.filter((item) => item.status === "completed").length}</button>)}
          <AppSelect value={followUpFilter} onChange={(event) => setFollowUpFilter(event.target.value)} aria-label="Sort follow-ups"><option value="all">Due date</option><option value="open">Open</option><option value="completed">Completed</option><option value="overdue">Overdue</option></AppSelect>
        </div>
        <div className="pencil-followup-layout">
          <div className="pencil-followup-main">
            <div className="pencil-followup-list-head"><span>Follow-up</span><span>Assigned</span><span>Linked task</span><span>Due</span></div>
            <div className="pencil-followup-list">
              {visibleFollowUps.length ? visibleFollowUps.map((followUp) => {
              const linkedTask = tasks.find(
                (task) => task.id === followUp.task_id,
              );
              const canEdit =
                canManageMembers ||
                followUp.created_by === currentUserId ||
                followUp.assigned_to === currentUserId;
              return <article className={`pencil-followup-row ${followUp.status}`} key={followUp.id}>
                  <button type="button" className={`pencil-followup-check ${followUp.status === "completed" ? "done" : ""}`} onClick={() => completeFollowUp(followUp)} aria-label={`${followUp.status === "completed" ? "Reopen" : "Complete"} ${followUp.note}`}><Check size={13} /></button>
                  <div className="pencil-followup-copy"><strong>{followUp.note}</strong><small>{followUp.status === "completed" ? "Completed" : "Needs a response or later action."}</small></div>
                  <span className="pencil-followup-assignee">{followUp.assigned_to_name || "Unassigned"}</span>
                  <span className="pencil-followup-task">{linkedTask?.title || "No linked task"}</span>
                  <span className={`pencil-followup-due ${isOverdueFollowUp(followUp) ? "overdue" : ""}`}>{followUp.due_date ? (isOverdueFollowUp(followUp) ? `${Math.abs(Math.round((new Date(today) - new Date(followUp.due_date)) / 86400000))} days over` : followUp.due_date === today ? "Due today" : formatDay(followUp.due_date)) : "No date"}</span>
                  <div className="pencil-followup-actions">
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
                  </div></article>;
              }) : <EmptyState text="Nothing needs follow-up right now." />}
            </div>
          </div>
          <aside className="pencil-followup-side">
            <section className="pencil-followup-card"><h2>Queue summary</h2><div className="pencil-followup-summary"><strong>{localData.followUps.filter((item) => item.status === "open").length}<small>Open</small></strong><strong>{dueToday}<small>Due today</small></strong><strong>{overdueFollowUps}<small>Overdue</small></strong></div><p>{overdueFollowUps ? `Oldest open item needs attention.` : "No overdue follow-ups."}</p></section>
            <form className="pencil-followup-form" onSubmit={(event) => submitComposer(event, "followup")}><h2>New follow-up</h2><label>Follow-up note<textarea name="note" value={form.note || ""} onChange={updateFollowUpForm} placeholder="What needs to happen, and by when?" required /></label><label>Due date<input type="date" name="due_date" value={form.due_date || ""} onChange={updateFollowUpForm} required /></label><label>Assign to<AppSelect name="assigned_to" value={form.assigned_to || ""} onChange={updateFollowUpForm}><option value="">Unassigned</option>{localData.members.map((member) => <option key={member.id} value={member.id}>{[member.first_name, member.last_name].filter(Boolean).join(" ") || member.email}</option>)}</AppSelect></label><label>Link to task<AppSelect name="task_id" value={form.task_id || ""} onChange={updateFollowUpForm}><option value="">No linked task</option>{tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</AppSelect></label>{composerError && <p className="auth-error">{composerError}</p>}<div><button type="button" onClick={() => setForm((current) => ({ ...current, note: "", due_date: "", assigned_to: "", task_id: "" }))}>Cancel</button><Button type="submit" disabled={submitting}>{submitting ? "Saving..." : "Save"}</Button></div></form>
          </aside>
        </div>
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

  if (active === "Team") {
    return (
      <>
        <TeamBoardView
          tasks={tasks}
          workspaceId={workspaceId}
          workspaceRole={currentWorkspace?.role}
          currentUserId={currentUserId}
          taskReloadKey={reportLastUpdated?.getTime() || 0}
          members={localData.members}
          projects={localData.projects}
          checkIns={localData.checkIns}
          workShifts={localData.workShifts}
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
        members={localData.members}
        onAddTask={onAddTask}
        onOpenTask={onOpenTask}
        onComplete={onComplete}
        onStatusChange={onStatusChange}
        onDelete={onDelete}
        onDeletePermanently={onDeletePermanently}
        canDeletePermanently={currentWorkspace?.role === "owner"}
        canManageTasks={canManageTasks}
      />
    );
  }

  const normalizedSearch = searchQuery.trim().toLowerCase();
  const filteredTasks = tasks
    .filter(
      (task) => active !== "My tasks" || taskIsAssignedTo(task, currentUserId),
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
        {active === "Team" && (
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
    this.handleReload = this.handleReload.bind(this);
    this.handleGoToToday = this.handleGoToToday.bind(this);
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error("WorkSpace render error", error, errorInfo);
    if (import.meta.env.VITE_SENTRY_DSN) {
      Sentry.captureException(error, {
        contexts: {
          react: {
            componentStack: errorInfo?.componentStack,
          },
        },
      });
    }
  }

  handleReload() {
    window.location.reload();
  }

  handleGoToToday() {
    localStorage.setItem("workspace-last-page", "Today");
    const target = new URL(window.location.href);
    target.search = "?view=Today";
    target.hash = "";
    window.location.assign(target);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <BrandedStatusScreen
        onReload={this.handleReload}
        onGoToToday={this.handleGoToToday}
      />
    );
  }
}

// The banner sits outside the error boundary on purpose: if a bad build has
// taken the app down to the error screen, offering the new one is exactly what
// the user needs, and the boundary would otherwise replace the banner too.
startInstallPromptCapture();
createRoot(document.getElementById("root")).render(
  <>
    <ThemeInit />
    <ThemeProvider theme={flowbiteTheme}>
      <AppUpdateBanner />
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    </ThemeProvider>
  </>,
);

// Production only: a dev-registered service worker fights Vite's HMR (it can
// serve a stale cached module instead of the one Vite just recompiled).
if (import.meta.env.PROD) {
  window.addEventListener("load", startAppUpdateWatch);
}
