import { urlBase64ToUint8Array, savePushSubscription } from "../lib/push-subscriptions.js";
import { AppSelect } from "./ui/select.jsx";
// The Settings area: appearance, notification preferences, profile, workspace
// access, reusable templates, and outbound integrations (webhooks + the calendar
// subscribe link).

import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  Bell,
  Building2,
  Camera,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  ClipboardList,
  Clock3,
  Copy,
  FileText,
  Layers,
  Link2,
  LogOut,
  Plus,
  Sparkles,
  Sun,
  UserRound,
  Volume2,
  Webhook,
  X,
  Megaphone,
  Download,
  MonitorUp,
} from "lucide-react";
import { Button } from "./ui/button.jsx";
import { Alert } from "./ui/alert.jsx";
import { Card } from "./ui/card.jsx";
import { Skeleton, SkeletonGroup } from "./ui/skeleton.jsx";
import Avatar from "./Avatar.jsx";
const AISettingsPanel = lazy(() =>
  import("./WorkspaceTools.jsx").then((module) => ({
    default: module.AISettingsPanel,
  })),
);
import { WorkspaceViewHeading } from "./workspace-ui.jsx";
import { effectivePresence, getCsrfToken } from "../lib/workspace-format.js";
import { NOTIFICATION_SOUND_OPTIONS, playNotificationSound } from "../lib/notification-sounds.js";
import { persistWorkspaceTheme } from "../lib/theme.js";
import "../settings.css";

// Mirrors tasks/models.py PERMISSION_KEYS - keep in sync with the backend list.
const PERMISSION_LABELS = [
  ["create_tasks", "Create tasks"],
  ["edit_own_tasks", "Edit own tasks"],
  ["edit_team_tasks", "Edit team tasks"],
  ["assign_tasks", "Assign tasks"],
  ["create_projects", "Create projects"],
  ["manage_projects", "Manage projects"],
  ["create_workstreams", "Create workstreams"],
  ["manage_workstreams", "Manage workstreams"],
  ["comment_check_ins", "Comment on check-ins"],
  ["use_ai", "Use Zuri"],
  ["manage_ai_access", "Manage Zuri member access"],
  ["manage_ai_providers", "Manage Zuri providers"],
  ["view_reports", "View reports"],
];

const minutesToHoursInput = (minutes) => {
  const hours = Number(minutes || 0) / 60;
  return Number.isInteger(hours) ? String(hours) : String(Number(hours.toFixed(2)));
};

const memberDisplayName = (member) =>
  [member.first_name, member.last_name].filter(Boolean).join(" ") || member.email;

const WORKING_DAY_OPTIONS = [
  { value: 0, short: "M", label: "Monday" },
  { value: 1, short: "T", label: "Tuesday" },
  { value: 2, short: "W", label: "Wednesday" },
  { value: 3, short: "T", label: "Thursday" },
  { value: 4, short: "F", label: "Friday" },
  { value: 5, short: "S", label: "Saturday" },
  { value: 6, short: "S", label: "Sunday" },
];

const LIFECYCLE_ACTION_COPY = {
  archive: {
    errorTitle: "Workspace could not be archived",
    errorMessage: "No workspace state changed. Check the connection and try again.",
  },
  restore: {
    errorTitle: "Workspace could not be restored",
    errorMessage: "The workspace is still archived. Check the connection and try again.",
  },
  leave: {
    errorTitle: "Workspace could not be left",
    errorMessage: "You are still a member. Check the connection and try again.",
  },
  delete: {
    errorTitle: "Workspace could not be deleted",
    errorMessage: "The archived workspace is unchanged. Check the connection and try again.",
  },
};

const lifecycleFailure = (action, status, message) => {
  if (status === 403) {
    return {
      tone: "warning",
      title: "Workspace action not permitted",
      message: message || "Your role does not allow this action.",
      retryable: false,
    };
  }

  if (status === 409) {
    return {
      tone: "warning",
      title: LIFECYCLE_ACTION_COPY[action].errorTitle,
      message: message || LIFECYCLE_ACTION_COPY[action].errorMessage,
      retryable: false,
    };
  }

  return {
    tone: "danger",
    title: LIFECYCLE_ACTION_COPY[action].errorTitle,
    message: message || LIFECYCLE_ACTION_COPY[action].errorMessage,
    retryable: true,
  };
};

const normalizeWorkingDays = (days) =>
  Array.from(
    new Set(
      (Array.isArray(days) ? days : [])
        .map(Number)
        .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6),
    ),
  ).sort((left, right) => left - right);

const formatWorkingDays = (days) => {
  const normalized = normalizeWorkingDays(days);
  if (!normalized.length) return "No days selected";
  if (normalized.join(",") === "0,1,2,3,4") return "Mon-Fri";
  return normalized
    .map((day) => WORKING_DAY_OPTIONS[day].label.slice(0, 3))
    .join(", ");
};

function MemberWorkingHoursRow({ member, canEdit, saving, onSave }) {
  const [dailyHours, setDailyHours] = useState(() => minutesToHoursInput(member.daily_capacity_minutes ?? 480));
  const [workingDays, setWorkingDays] = useState(() => normalizeWorkingDays(member.working_days ?? [0, 1, 2, 3, 4]));

  useEffect(() => {
    setDailyHours(minutesToHoursInput(member.daily_capacity_minutes ?? 480));
    setWorkingDays(normalizeWorkingDays(member.working_days ?? [0, 1, 2, 3, 4]));
  }, [member.id, member.daily_capacity_minutes, member.working_days]);

  const name = memberDisplayName(member);
  const dailyMinutes = Math.max(0, Math.round((Number(dailyHours) || 0) * 60));
  const weeklyMinutes = dailyMinutes * workingDays.length;
  const toggleWorkingDay = (day) => {
    if (saving) return;
    setWorkingDays((current) => current.includes(day)
      ? current.filter((value) => value !== day)
      : [...current, day].sort((left, right) => left - right));
  };

  if (!canEdit) {
    return (
      <div className="settings-working-hours-row is-readonly">
        <div className="settings-working-hours-person"><strong>{name}</strong><span>{member.email}</span></div>
        <span className="settings-working-hours-readonly"><Clock3 size={15} aria-hidden="true" />{minutesToHoursInput(member.daily_capacity_minutes ?? 480)}h daily, {minutesToHoursInput(member.weekly_capacity_minutes ?? 2400)}h weekly, {formatWorkingDays(member.working_days ?? [0, 1, 2, 3, 4])}</span>
      </div>
    );
  }

  return (
    <div className="settings-working-hours-row">
      <div className="settings-working-hours-person"><strong>{name}</strong><span>{member.email}</span></div>
      <label className="settings-working-hours-field">
        <span className="settings-working-hours-field-label">Daily</span>
        <span className="settings-working-hours-input"><input type="number" min="0" max="24" step="0.5" value={dailyHours} onChange={(event) => setDailyHours(event.target.value)} aria-label={`Daily hours for ${name}`} /><em>hours</em></span>
      </label>
      <div className="settings-working-hours-days" role="group" aria-label={`Working days for ${name}`}>
        {WORKING_DAY_OPTIONS.map((day) => (
          <button
            key={day.value}
            type="button"
            className="settings-working-hours-day"
            aria-pressed={workingDays.includes(day.value)}
            aria-label={`${day.label} for ${name}`}
            disabled={saving}
            onClick={() => toggleWorkingDay(day.value)}
          >
            {day.short}
          </button>
        ))}
      </div>
      <div className="settings-working-hours-summary" role="status" aria-live="polite" aria-label={`Weekly summary for ${name}`}>
        <strong>{minutesToHoursInput(weeklyMinutes)}h</strong>
        <span>{workingDays.length} {workingDays.length === 1 ? "day" : "days"}</span>
      </div>
      <Button size="sm" type="button" disabled={saving} onClick={() => onSave(member, dailyHours, workingDays)} aria-label={`Save hours for ${name}`}>{saving ? "Saving" : "Save"}</Button>
    </div>
  );
}

function SettingsAlert({
  tone = "danger",
  title,
  children,
  onRetry,
  retryLabel = "Try again",
  secondaryAction,
  className = "",
}) {
  const action = onRetry || secondaryAction ? (
    <div className="settings-alert-actions">
      {onRetry && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="settings-alert-retry"
          onClick={onRetry}
        >
          {retryLabel}
        </Button>
      )}
      {secondaryAction}
    </div>
  ) : null;

  return (
    <Alert
      tone={tone}
      title={title}
      action={action}
      className={`settings-state-alert ${className}`.trim()}
    >
      {children}
    </Alert>
  );
}

function SettingsView({
  theme,
  onSetTheme,
  sidebarCollapsed,
  onToggleSidebar,
  currentWorkspace,
  currentUserName,
  currentUserEmail,
  currentUserId,
  currentUserAvatarUrl,
  currentUserPresence,
  currentUserCompany = "",
  currentUserJobRole = "",
  onProfileUpdated,
  canManageMembers,
  members,
  notifications,
  workspaceId,
  workspaces = [],
  defaultWorkspaceId,
  onSetDefaultWorkspace,
  onCreateWorkspace,
  onSwitchWorkspace,
  taskTemplates = [],
  projectTemplates = [],
  projects = [],
  onRefresh,
  onConfirm,
  onNavigate,
  onSignOut,
  whatsNewUnread = false,
  onWorkspaceLogoUpdated,
}) {
  // Settings opens on Profile for everyone. The P4 frame put administrators on
  // AI settings, but that lands an owner in workspace administration when they
  // came to change their own details, and it meant nobody ever arrived on
  // Profile: members got Appearance instead. Profile is the first item in the
  // list and is available at every permission level, so it is the one panel
  // that is always a valid place to start. Deliberate deviation from P4.
  const [section, setSection] = useState("profile");
  const [mobileSectionOpen, setMobileSectionOpen] = useState(false);
  const [notificationPrefs, setNotificationPrefs] = useState(null);
  const [notificationVolume, setNotificationVolume] = useState(70);
  const [checkInSettings, setCheckInSettings] = useState(null);
  const [checkInSettingsError, setCheckInSettingsError] = useState("");
  const [checkInSettingsErrorKind, setCheckInSettingsErrorKind] = useState("");
  const [checkInRetryValue, setCheckInRetryValue] = useState(null);
  const [prefsError, setPrefsError] = useState("");
  const [browserPermission, setBrowserPermission] = useState(() =>
    typeof Notification !== "undefined" ? Notification.permission : "unsupported",
  );
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoError, setLogoError] = useState("");
  const [avatarError, setAvatarError] = useState("");
  const [avatarRetry, setAvatarRetry] = useState(null);
  const avatarInputRef = useRef(null);
  const profileFormRef = useRef(null);
  const [presenceSaving, setPresenceSaving] = useState(false);
  const [presenceError, setPresenceError] = useState("");
  const [presenceRetryValue, setPresenceRetryValue] = useState("");
  const [appearanceError, setAppearanceError] = useState("");
  const [appearanceRetryValue, setAppearanceRetryValue] = useState("");
  const [prefsErrorKind, setPrefsErrorKind] = useState("");
  const [preferenceRetry, setPreferenceRetry] = useState(null);
  const [pushErrorRetry, setPushErrorRetry] = useState("");
  const [profileForm, setProfileForm] = useState({
    first_name: "",
    last_name: "",
    email: "",
    company: "",
    job_role: "",
  });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [webhooks, setWebhooks] = useState([]);
  const [webhooksError, setWebhooksError] = useState("");
  const [webhookForm, setWebhookForm] = useState({
    kind: "teams",
    url: "",
    label: "",
  });
  const [webhookSaving, setWebhookSaving] = useState(false);
  const [calendarToken, setCalendarToken] = useState("");
  const [calendarTokenSaving, setCalendarTokenSaving] = useState(false);
  const [lifecycleBusy, setLifecycleBusy] = useState(null);
  const [lifecycleError, setLifecycleError] = useState(null);
  const [deleteTargetId, setDeleteTargetId] = useState(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [permissionsSavingId, setPermissionsSavingId] = useState(null);
  const [permissionsError, setPermissionsError] = useState("");
  const [workingHoursSavingId, setWorkingHoursSavingId] = useState(null);
  const [workingHoursError, setWorkingHoursError] = useState("");
  const [notificationPrefsReloadKey, setNotificationPrefsReloadKey] = useState(0);
  const [checkInSettingsReloadKey, setCheckInSettingsReloadKey] = useState(0);
  const [pushConfigReloadKey, setPushConfigReloadKey] = useState(0);
  const isOwner = currentWorkspace?.role === "owner";
  const isArchived = currentWorkspace?.status === "archived";
  const lifecycleBusyFor = (action, targetWorkspaceId) =>
    lifecycleBusy?.action === action && lifecycleBusy?.workspaceId === targetWorkspaceId;
  const toggleManagerPermission = async (member, key) => {
    const current = member.permissions || [];
    const next = current.includes(key)
      ? current.filter((value) => value !== key)
      : [...current, key];
    setPermissionsSavingId(member.id);
    setPermissionsError("");
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/members/${member.id}/`,
        {
          method: "PATCH",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "X-CSRFToken": await getCsrfToken(),
            "X-Workspace-Id": String(workspaceId),
          },
          body: JSON.stringify({ permissions: next }),
        },
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Permission could not be updated.");
      // The member list lives in the parent (localData.members) - refresh it
      // so this panel and every other view reading `members` sees the change.
      onRefresh?.();
    } catch (error) {
      setPermissionsError(error.message || "Permission could not be updated.");
    } finally {
      setPermissionsSavingId(null);
    }
  };
  const changeMemberRole = async (member, role) => {
    setPermissionsSavingId(member.id);
    setPermissionsError("");
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/members/${member.id}/`,
        {
          method: "PATCH",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "X-CSRFToken": await getCsrfToken(),
            "X-Workspace-Id": String(workspaceId),
          },
          body: JSON.stringify({ role }),
        },
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Role could not be updated.");
      onRefresh?.();
    } catch (error) {
      setPermissionsError(error.message || "Role could not be updated.");
    } finally {
      setPermissionsSavingId(null);
    }
  };
  const saveMemberWorkingHours = async (member, dailyHours, workingDays) => {
    const dailyMinutes = Math.round(Number(dailyHours) * 60);
    if (!Number.isFinite(dailyMinutes) || dailyMinutes < 0 || dailyMinutes > 1440) {
      setWorkingHoursError("Daily hours must be between 0 and 24.");
      return;
    }
    const normalizedWorkingDays = normalizeWorkingDays(workingDays);
    if (normalizedWorkingDays.length !== workingDays.length) {
      setWorkingHoursError("Working days must be unique weekdays.");
      return;
    }
    setWorkingHoursSavingId(member.id);
    setWorkingHoursError("");
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/members/${member.id}/`,
        {
          method: "PATCH",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "X-CSRFToken": await getCsrfToken(),
            "X-Workspace-Id": String(workspaceId),
          },
          body: JSON.stringify({
            daily_capacity_minutes: dailyMinutes,
            working_days: normalizedWorkingDays,
          }),
        },
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Working hours could not be updated.");
      }
      onRefresh?.();
    } catch (error) {
      setWorkingHoursError(error.message || "Working hours could not be updated.");
    } finally {
      setWorkingHoursSavingId(null);
    }
  };
  const runLifecycleAction = async (
    action,
    targetWorkspaceId,
    method,
    path,
    confirmOptions,
  ) => {
    if (confirmOptions) {
      const confirmed = onConfirm
        ? await onConfirm(confirmOptions.message, confirmOptions)
        : false;
      if (!confirmed) return;
    }
    setLifecycleBusy({ action, workspaceId: targetWorkspaceId });
    setLifecycleError(null);
    try {
      const response = await fetch(
        `/api/workspaces/${targetWorkspaceId}${path}`,
        {
          method,
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "X-CSRFToken": await getCsrfToken(),
            "X-Workspace-Id": String(targetWorkspaceId),
          },
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const failure = lifecycleFailure(action, response.status, data.error);
        setLifecycleError({
          ...failure,
          retry: failure.retryable
            ? () => runLifecycleAction(action, targetWorkspaceId, method, path, confirmOptions)
            : null,
        });
        return;
      }
      // Membership, the default-workspace fallback, and which workspace is
      // "current" can all change from this one call - reload so the app
      // re-derives session state from scratch instead of hand-patching every
      // affected piece of client state.
      window.location.reload();
    } catch (error) {
      const failure = lifecycleFailure(action, 0, error.message);
      setLifecycleError({
        ...failure,
        retry: () => runLifecycleAction(action, targetWorkspaceId, method, path, confirmOptions),
      });
    } finally {
      setLifecycleBusy(null);
    }
  };
  const leaveWorkspace = (targetWorkspaceId, name) =>
    runLifecycleAction("leave", targetWorkspaceId, "POST", "/leave/", {
      title: `Leave ${name || "this workspace"}?`,
      message: `Leave ${name || "this workspace"}? You will lose access until you are invited again.`,
      confirmLabel: "Leave",
    });
  const archiveWorkspace = () =>
    runLifecycleAction("archive", workspaceId, "POST", "/archive/", {
      title: `Archive ${currentWorkspace?.name || "this workspace"}?`,
      message: `Archive ${currentWorkspace?.name || "this workspace"}? Members keep read access; only the owner can restore or permanently delete it.`,
      confirmLabel: "Archive",
    });
  const restoreWorkspace = (targetWorkspaceId = workspaceId) =>
    runLifecycleAction("restore", targetWorkspaceId, "POST", "/restore/");
  const deleteWorkspace = (targetWorkspaceId = workspaceId) =>
    runLifecycleAction("delete", targetWorkspaceId, "DELETE", "/");
  const toggleDeleteConfirmation = (targetWorkspaceId) => {
    setLifecycleError(null);
    setDeleteTargetId((current) =>
      current === targetWorkspaceId ? null : targetWorkspaceId,
    );
    setDeleteConfirmText("");
  };
  // Regular members only ever see personal settings (appearance, notifications,
  // profile/presence); workspace-wide administration is owner/manager-only.
  // This is a UI convenience, not the authorization boundary - every endpoint
  // behind these panels re-checks the actor's permission server-side.
  const sections = [
    { value: "profile", label: "Profile", Icon: UserRound, group: "preferences" },
    { value: "appearance", label: "Appearance", Icon: Sun, group: "preferences" },
    { value: "notifications", label: "Notifications", Icon: Bell, group: "preferences" },
    { value: "workspaces", label: "Workspaces", Icon: Layers, group: "workspace" },
    ...(canManageMembers
      ? [
          { value: "workspace", label: "Workspace access", Icon: Building2, group: "workspace" },
          { value: "ai", label: "AI settings", Icon: Sparkles, group: "workspace" },
          { value: "integrations", label: "Integrations", Icon: Webhook, group: "workspace" },
          { value: "templates", label: "Templates", Icon: ClipboardList, group: "workspace" },
        ]
      : []),
  ];
  const supportSections = [
    { value: "help", label: "Help", Icon: CircleHelp, group: "support" },
    { value: "legal", label: "Legal", Icon: FileText, group: "support" },
  ];
  // These three used to sit in the sidebar under their own Resources heading.
  // They are whole pages rather than settings panels, so like Help and Legal
  // they are links out: the label is the page name the shell routes on, which
  // keeps deep links working - a screen-share notification still opens the
  // session directly without passing through Settings.
  const resourceSections = [
    { value: "whats-new", label: "What's new", Icon: Megaphone, group: "resources" },
    { value: "install-app", label: "Install app", Icon: Download, group: "resources" },
    { value: "screen-sharing", label: "Screen sharing", Icon: MonitorUp, group: "resources" },
  ];
  const navGroups = [
    { id: "preferences", label: "Preferences", sections: sections.filter((item) => item.group === "preferences") },
    { id: "workspace", label: "Workspace", sections: sections.filter((item) => item.group === "workspace") },
    { id: "resources", label: "Resources", sections: resourceSections, navigates: true },
    { id: "support", label: "About and support", sections: supportSections, navigates: true },
  ];
  const openSection = (value) => {
    setSection(value);
    setMobileSectionOpen(true);
    scrollMobileSettingsToTop();
  };
  const activeSectionLabel = sections.find((item) => item.value === section)?.label || "Settings";
  const sectionDescriptions = {
    profile: "Your identity as it appears across the workspace.",
    appearance: "Choose how WorkSpace looks on this device.",
    notifications: "Choose what reaches you and when.",
    workspaces: "Open a workspace, choose which one WorkSpace starts on, or start one of your own.",
    ai: "Control Zuri providers, member access, and workspace defaults.",
    integrations: "Send WorkSpace notifications to Microsoft Teams or Slack, and subscribe to the team calendar.",
    templates: "Create templates for repeatable tasks and projects, then apply them from the create forms.",
  };
  const activeSectionDescription = section === "workspace"
    ? `Review who can access ${currentWorkspace?.name || "this workspace"}.`
    : sectionDescriptions[section] || "";
  const scrollMobileSettingsToTop = () => {
    if (typeof window === "undefined" || !window.matchMedia?.("(max-width: 700px)").matches) return;
    window.scrollTo?.({ top: 0, behavior: "smooth" });
  };
  const preferenceRows = [
    ["mentions", "Mentions", "When someone mentions you in a channel."],
    [
      "direct_messages",
      "Direct messages",
      "When someone sends you a private chat.",
    ],
    [
      "channel_messages",
      "Channel messages",
      "When teammates post in channels you can access.",
    ],
    [
      "task_updates",
      "Task updates",
      "Assignments, comments, and status changes.",
    ],
    ["calendar_reminders", "Calendar reminders", "Upcoming event reminders."],
    [
      "notification_sound",
      "Notification sound",
      "Play the selected sound while WorkSpace is focused. Minimized or closed notifications use the operating system sound.",
    ],
    ...(canManageMembers
      ? [
          [
            "manager_activity",
            "Manager activity",
            "When teammates create, complete, delete, or update shared records.",
          ],
        ]
      : []),
  ];
  useEffect(() => {
    if (!workspaceId) return undefined;
    let isCurrent = true;
    setPrefsError("");
    setPrefsErrorKind("");
    setPreferenceRetry(null);
    fetch(`/api/workspaces/${workspaceId}/notification-preferences/`, {
      credentials: "include",
      headers: { "X-Workspace-Id": String(workspaceId) },
    })
      .then((response) =>
        response.json().then((data) => ({ ok: response.ok, data })),
      )
      .then(({ ok, data }) => {
        if (!isCurrent) return;
        if (!ok) throw new Error(data.error || "Notification preferences could not be loaded.");
        setNotificationPrefs(data.preferences);
        setNotificationVolume(data.preferences.notification_volume ?? 70);
      })
      .catch((error) => {
        if (isCurrent) {
          setPrefsErrorKind("load");
          setPrefsError(error.message || "Notification preferences could not be loaded.");
        }
      });
    return () => {
      isCurrent = false;
    };
  }, [workspaceId, notificationPrefsReloadKey]);
  useEffect(() => {
    if (!workspaceId || !canManageMembers) return undefined;
    let isCurrent = true;
    setCheckInSettingsError("");
    setCheckInSettingsErrorKind("");
    setCheckInRetryValue(null);
    fetch(`/api/workspaces/${workspaceId}/check-in-settings/`, { credentials: "include" })
      .then((response) => response.json().then((data) => ({ ok: response.ok, data })))
      .then(({ ok, data }) => {
        if (!isCurrent) return;
        if (!ok) throw new Error(data.error || "Check-in settings could not be loaded.");
        setCheckInSettings(data.settings);
      })
      .catch((error) => {
        if (isCurrent) {
          setCheckInSettingsErrorKind("load");
          setCheckInSettingsError(error.message);
        }
      });
    return () => { isCurrent = false; };
  }, [workspaceId, canManageMembers, checkInSettingsReloadKey]);
  const updateCheckInReminderHour = async (value) => {
    const previous = checkInSettings;
    setCheckInSettings((current) => ({ ...current, check_in_reminder_hour: Number(value) }));
    setCheckInSettingsError("");
    setCheckInSettingsErrorKind("");
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/check-in-settings/`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRFToken": await getCsrfToken() },
        body: JSON.stringify({ check_in_reminder_hour: Number(value) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Check-in settings could not be saved.");
      setCheckInSettings(data.settings);
      setCheckInRetryValue(null);
    } catch (error) {
      setCheckInSettings(previous);
      setCheckInSettingsErrorKind("save");
      setCheckInRetryValue(Number(value));
      setCheckInSettingsError(error.message);
    }
  };
  const updatePreference = async (key, value) => {
    const previous = notificationPrefs;
    setNotificationPrefs((current) => ({ ...current, [key]: value }));
    setPrefsError("");
    setPrefsErrorKind("");
    setPreferenceRetry(null);
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
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Preference could not be saved.");
      setNotificationPrefs(data.preferences);
      setNotificationVolume(data.preferences.notification_volume ?? 70);
      setPreferenceRetry(null);
      return true;
    } catch (error) {
      setNotificationPrefs(previous);
      setPrefsErrorKind("save");
      setPreferenceRetry({ key, value });
      setPrefsError(error.message || "Preference could not be saved.");
      return false;
    }
  };
  const previewNotificationSound = () => {
    if (!notificationPrefs?.notification_sound || notificationVolume <= 0) return;
    void playNotificationSound(notificationPrefs.notification_sound_name, notificationVolume);
  };
  const updateNotificationSound = async (value) => {
    const saved = await updatePreference("notification_sound_name", value);
    if (saved && notificationPrefs?.notification_sound && notificationVolume > 0) {
      void playNotificationSound(value, notificationVolume);
    }
  };
  const commitNotificationVolume = async (value) => {
    if (value === notificationPrefs?.notification_volume) return;
    const previous = notificationVolume;
    setNotificationVolume(value);
    const saved = await updatePreference("notification_volume", value);
    if (!saved) setNotificationVolume(previous);
  };
  const selectTheme = (value) => {
    setAppearanceError("");
    setAppearanceRetryValue(value);
    if (!persistWorkspaceTheme(value)) {
      setAppearanceError(
        "Your browser could not save this preference. The previous theme remains active.",
      );
      return;
    }
    setAppearanceRetryValue("");
    onSetTheme?.(value);
  };
  useEffect(() => {
    if (!workspaceId || section !== "integrations") return undefined;
    let isCurrent = true;
    setWebhooksError("");
    fetch(`/api/workspaces/${workspaceId}/webhooks/?page_size=500`, {
      credentials: "include",
      headers: { "X-Workspace-Id": String(workspaceId) },
    })
      .then((response) =>
        response.json().then((data) => ({ ok: response.ok, data })),
      )
      .then(({ ok, data }) => {
        if (!isCurrent) return;
        if (!ok) throw new Error(data.error || "Webhooks could not be loaded.");
        setWebhooks(data.webhooks);
      })
      .catch((error) => {
        if (isCurrent) setWebhooksError(error.message || "Webhooks could not be loaded.");
      });
    fetch(`/api/workspaces/${workspaceId}/calendar-feed-token/`, {
      credentials: "include",
      headers: { "X-Workspace-Id": String(workspaceId) },
    })
      .then((response) =>
        response.json().then((data) => ({ ok: response.ok, data })),
      )
      .then(({ ok, data }) => {
        if (isCurrent && ok) setCalendarToken(data.token);
      })
      .catch((error) =>
        console.error("Calendar feed token could not be loaded", error),
      );
    return () => {
      isCurrent = false;
    };
  }, [workspaceId, section]);
  const addWebhook = async (event) => {
    event.preventDefault();
    setWebhookSaving(true);
    setWebhooksError("");
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/webhooks/`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": await getCsrfToken(),
        },
        body: JSON.stringify(webhookForm),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Webhook could not be connected.");
      setWebhooks((current) => [data.webhook, ...current]);
      setWebhookForm({ kind: "teams", url: "", label: "" });
    } catch (error) {
      setWebhooksError(error.message || "Webhook could not be connected.");
    } finally {
      setWebhookSaving(false);
    }
  };
  const toggleWebhook = async (webhook) => {
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/webhooks/${webhook.id}/`,
        {
          method: "PATCH",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "X-CSRFToken": await getCsrfToken(),
          },
          body: JSON.stringify({ is_active: !webhook.is_active }),
        },
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Webhook could not be updated.");
      setWebhooks((current) =>
        current.map((item) => (item.id === webhook.id ? data.webhook : item)),
      );
    } catch (error) {
      setWebhooksError(error.message || "Webhook could not be updated.");
    }
  };
  const deleteWebhook = async (webhook) => {
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/webhooks/${webhook.id}/`,
        {
          method: "DELETE",
          credentials: "include",
          headers: { "X-CSRFToken": await getCsrfToken() },
        },
      );
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Webhook could not be removed.");
      }
      setWebhooks((current) =>
        current.filter((item) => item.id !== webhook.id),
      );
    } catch (error) {
      setWebhooksError(error.message || "Webhook could not be removed.");
    }
  };
  const resetCalendarToken = async () => {
    setCalendarTokenSaving(true);
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/calendar-feed-token/`,
        {
          method: "POST",
          credentials: "include",
          headers: { "X-CSRFToken": await getCsrfToken() },
        },
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Subscribe link could not be reset.");
      setCalendarToken(data.token);
    } catch (error) {
      setWebhooksError(error.message || "Subscribe link could not be reset.");
    } finally {
      setCalendarTokenSaving(false);
    }
  };
  const calendarSubscribeUrl = calendarToken
    ? `${window.location.origin}/api/workspaces/${workspaceId}/calendar.ics?token=${calendarToken}`
    : "";
  const copyCalendarSubscribeUrl = () => {
    if (calendarSubscribeUrl)
      navigator.clipboard?.writeText(calendarSubscribeUrl);
  };
  const pushSupported =
    typeof Notification !== "undefined" &&
    "serviceWorker" in navigator &&
    typeof PushManager !== "undefined";
  const [pushPublicKey, setPushPublicKey] = useState("");
  const [pushConfigured, setPushConfigured] = useState(false);
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState("");
  const subscriptionUsesPublicKey = (subscription) => {
    const browserKey = new Uint8Array(subscription.options?.applicationServerKey || []);
    const configuredKey = urlBase64ToUint8Array(pushPublicKey);
    return browserKey.length === configuredKey.length && browserKey.every((value, index) => value === configuredKey[index]);
  };
  useEffect(() => {
    setPushError("");
    setPushErrorRetry("");
    fetch("/api/push/public-key/", { credentials: "include" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.error || "Push notification configuration could not be loaded.");
        return data;
      })
      .then((data) => {
        setPushPublicKey(data.public_key || "");
        setPushConfigured(Boolean(data.configured));
      })
      .catch((error) => {
        setPushErrorRetry("config");
        setPushError(error.message || "Push notification configuration could not be loaded.");
      });
  }, [pushConfigReloadKey]);
  useEffect(() => {
    if (!pushSupported || !pushConfigured || !pushPublicKey) return;
    let current = true;
    const reconcilePushSubscription = async () => {
      try {
        if (current) setBrowserPermission(Notification.permission);
        const registration = await navigator.serviceWorker.ready;
        let subscription = await registration.pushManager.getSubscription();
        if (!subscription) {
          if (current) setPushSubscribed(false);
          return;
        }
        // A browser retains a subscription when the API record is lost, and it
        // also retains the old application-server key after a VAPID rotation.
        // Reconcile whenever Settings opens so either case repairs itself.
        if (!subscriptionUsesPublicKey(subscription)) {
          await subscription.unsubscribe();
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(pushPublicKey),
          });
        }
        await savePushSubscription(subscription);
        if (current) setPushSubscribed(true);
      } catch (error) {
        if (current) {
          setPushSubscribed(false);
          setPushErrorRetry("reconcile");
          setPushError(error.message || "Push notifications could not be verified for this device.");
        }
      }
    };
    reconcilePushSubscription();
    window.addEventListener("workspace:push-changed", reconcilePushSubscription);
    return () => {
      current = false;
      window.removeEventListener("workspace:push-changed", reconcilePushSubscription);
    };
  }, [pushSupported, pushConfigured, pushPublicKey, pushConfigReloadKey]);
  const togglePushSubscription = async () => {
    if (!pushSupported || !pushConfigured || pushBusy) return;
    setPushBusy(true);
    setPushError("");
    setPushErrorRetry("");
    try {
      if (!pushPublicKey)
        throw new Error("Push notifications are not configured for this workspace yet.");
      if (!pushSubscribed) {
        // Request permission directly from the click, before waiting on the worker.
        const permission = await Notification.requestPermission();
        setBrowserPermission(permission);
        if (permission !== "granted") return;
      }
      const registration = await navigator.serviceWorker.ready;
      if (pushSubscribed) {
        const subscription = await registration.pushManager.getSubscription();
        if (subscription) {
          const response = await fetch("/api/push/subscriptions/", {
            method: "DELETE",
            credentials: "include",
            headers: {
              "Content-Type": "application/json",
              "X-CSRFToken": await getCsrfToken(),
            },
            body: JSON.stringify({ endpoint: subscription.endpoint }),
          });
          const data = await response.json();
          if (!response.ok)
            throw new Error(data.error || "Push notifications could not be disabled on this device.");
          await subscription.unsubscribe();
        }
        setPushSubscribed(false);
        window.dispatchEvent(new Event("workspace:push-changed"));
      } else {
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(pushPublicKey),
        });
        try {
          await savePushSubscription(subscription);
        } catch (error) {
          await subscription.unsubscribe();
          throw error;
        }
        setPushSubscribed(true);
        window.dispatchEvent(new Event("workspace:push-changed"));
      }
    } catch (error) {
      // Leave state as-is so the user can retry from the same button, but do not
      // claim the browser subscription was saved when the API rejected it.
      setPushErrorRetry("subscription");
      setPushError(error.message || "Push notifications could not be updated.");
    } finally {
      setPushBusy(false);
    }
  };
  const uploadAvatar = async (file) => {
    if (!file) return;
    setAvatarRetry({ type: "upload", file });
    setAvatarUploading(true);
    setAvatarError("");
    try {
      const body = new FormData();
      body.append("avatar", file);
      const response = await fetch("/api/auth/me/avatar/", {
        method: "POST",
        credentials: "include",
        headers: { "X-CSRFToken": await getCsrfToken() },
        body,
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Photo could not be uploaded.");
      onProfileUpdated({ avatar_url: `${data.avatar_url}?t=${Date.now()}` });
      setAvatarRetry(null);
    } catch (error) {
      setAvatarError(error.message || "Photo could not be uploaded.");
    } finally {
      setAvatarUploading(false);
    }
  };
  const handleAvatarChange = (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    void uploadAvatar(file);
  };
  const handleAvatarRemove = async () => {
    setAvatarRetry({ type: "remove" });
    setAvatarUploading(true);
    setAvatarError("");
    try {
      const response = await fetch("/api/auth/me/avatar/", {
        method: "DELETE",
        credentials: "include",
        headers: { "X-CSRFToken": await getCsrfToken() },
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Photo could not be removed.");
      onProfileUpdated({ avatar_url: "" });
      setAvatarRetry(null);
    } catch (error) {
      setAvatarError(error.message || "Photo could not be removed.");
    } finally {
      setAvatarUploading(false);
    }
  };
  const retryAvatarUpdate = () => {
    if (avatarRetry?.type === "upload") {
      void uploadAvatar(avatarRetry.file);
    } else if (avatarRetry?.type === "remove") {
      void handleAvatarRemove();
    }
  };
  const workspaceLogoUrl = currentWorkspace?.logo_url || "";
  const handleLogoChange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setLogoUploading(true);
    setLogoError("");
    try {
      const body = new FormData();
      body.append("logo", file);
      const response = await fetch(`/api/workspaces/${workspaceId}/logo/`, {
        method: "POST",
        credentials: "include",
        headers: { "X-CSRFToken": await getCsrfToken() },
        body,
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Logo could not be uploaded.");
      // The URL never changes when a logo is replaced, so without a cache
      // buster the browser keeps showing the previous one.
      onWorkspaceLogoUpdated?.(`${data.logo_url}?t=${Date.now()}`);
    } catch (error) {
      setLogoError(error.message || "Logo could not be uploaded.");
    } finally {
      setLogoUploading(false);
    }
  };
  const handleLogoRemove = async () => {
    setLogoUploading(true);
    setLogoError("");
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/logo/`, {
        method: "DELETE",
        credentials: "include",
        headers: { "X-CSRFToken": await getCsrfToken() },
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Logo could not be removed.");
      onWorkspaceLogoUpdated?.("");
    } catch (error) {
      setLogoError(error.message || "Logo could not be removed.");
    } finally {
      setLogoUploading(false);
    }
  };
  const handlePresenceChange = async (event) => {
    const presence = event.target.value;
    setPresenceRetryValue(presence);
    setPresenceSaving(true);
    setPresenceError("");
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
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Presence could not be updated.");
      onProfileUpdated({ presence: data.presence });
    } catch (error) {
      setPresenceError(error.message || "Presence could not be updated.");
    } finally {
      setPresenceSaving(false);
    }
  };
  useEffect(() => {
    const names = currentUserName.split(" ");
    setProfileForm({
      first_name: names.shift() || "",
      last_name: names.join(" "),
      email: currentUserEmail,
      company: currentUserCompany,
      job_role: currentUserJobRole,
    });
  }, [
    currentUserName,
    currentUserEmail,
    currentUserCompany,
    currentUserJobRole,
  ]);
  const saveProfile = async (event) => {
    event.preventDefault();
    setProfileSaving(true);
    setProfileError("");
    try {
      const response = await fetch("/api/auth/me/profile/", {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-CSRFToken": await getCsrfToken(),
        },
        body: JSON.stringify(profileForm),
      });
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Profile could not be updated.");
      onProfileUpdated(data.user);
      window.dispatchEvent(
        new CustomEvent("workspace:notice", { detail: "Profile updated." }),
      );
    } catch (error) {
      setProfileError(error.message || "Profile could not be updated.");
    } finally {
      setProfileSaving(false);
    }
  };
  const [taskTemplateForm, setTaskTemplateForm] = useState({
    name: "",
    title: "",
    description: "",
    priority: "normal",
    bucket: "Backlog",
    recurrence: "none",
    project_id: "",
    assignee_id: "",
    workstream: "",
  });
  const [projectTemplateForm, setProjectTemplateForm] = useState({
    name: "",
    project_name: "",
    description: "",
    due_days: 14,
  });
  const [templateSaving, setTemplateSaving] = useState(false);
  const [templateError, setTemplateError] = useState("");
  const createTaskTemplate = async (event) => {
    event.preventDefault();
    setTemplateSaving(true);
    setTemplateError("");
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/task-templates/`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "X-CSRFToken": await getCsrfToken(),
          },
          body: JSON.stringify(taskTemplateForm),
        },
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Task template could not be created.");
      setTaskTemplateForm({
        name: "",
        title: "",
        description: "",
        priority: "normal",
        bucket: "Backlog",
        recurrence: "none",
        project_id: "",
        assignee_id: "",
        workstream: "",
      });
      onRefresh?.();
    } catch (error) {
      setTemplateError(error.message);
    } finally {
      setTemplateSaving(false);
    }
  };
  const createProjectTemplate = async (event) => {
    event.preventDefault();
    setTemplateSaving(true);
    setTemplateError("");
    try {
      const response = await fetch(
        `/api/workspaces/${workspaceId}/project-templates/`,
        {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/json",
            "X-CSRFToken": await getCsrfToken(),
          },
          body: JSON.stringify(projectTemplateForm),
        },
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Project template could not be created.");
      setProjectTemplateForm({
        name: "",
        project_name: "",
        description: "",
        due_days: 14,
      });
      onRefresh?.();
    } catch (error) {
      setTemplateError(error.message);
    } finally {
      setTemplateSaving(false);
    }
  };
  const deleteTaskTemplate = async (template) => {
    const response = await fetch(
      `/api/workspaces/${workspaceId}/task-templates/${template.id}/`,
      {
        method: "DELETE",
        credentials: "include",
        headers: { "X-CSRFToken": await getCsrfToken() },
      },
    );
    if (response.ok) onRefresh?.();
  };
  const deleteProjectTemplate = async (template) => {
    const response = await fetch(
      `/api/workspaces/${workspaceId}/project-templates/${template.id}/`,
      {
        method: "DELETE",
        credentials: "include",
        headers: { "X-CSRFToken": await getCsrfToken() },
      },
    );
    if (response.ok) onRefresh?.();
  };
  const applyTaskTemplate = async (template) => {
    const response = await fetch(
      `/api/workspaces/${workspaceId}/task-templates/${template.id}/apply/`,
      {
        method: "POST",
        credentials: "include",
        headers: { "X-CSRFToken": await getCsrfToken() },
      },
    );
    const data = await response.json();
    if (!response.ok)
      return setTemplateError(
        data.error || "Task could not be created from template.",
      );
    window.dispatchEvent(
      new CustomEvent("workspace:notice", {
        detail: `Task created from ${template.name}.`,
      }),
    );
    onRefresh?.();
  };
  const applyProjectTemplate = async (template) => {
    const response = await fetch(
      `/api/workspaces/${workspaceId}/project-templates/${template.id}/apply/`,
      {
        method: "POST",
        credentials: "include",
        headers: { "X-CSRFToken": await getCsrfToken() },
      },
    );
    const data = await response.json();
    if (!response.ok)
      return setTemplateError(
        data.error || "Project could not be created from template.",
      );
    window.dispatchEvent(
      new CustomEvent("workspace:notice", {
        detail: `Project created from ${template.name}.`,
      }),
    );
    onRefresh?.();
  };
  const roleLabel =
    currentWorkspace?.role === "owner"
      ? "Owner"
      : currentWorkspace?.role === "manager"
        ? "Manager"
        : "Member";
  const unreadCount = notifications.filter(
    (notification) => !notification.read,
  ).length;
  return (
    <section className="workspace-view settings-view">
      <WorkspaceViewHeading
        eyebrow="Settings"
        title={activeSectionLabel}
        subtitle={activeSectionDescription}
      />
      <div className={`settings-shell ${mobileSectionOpen ? "is-mobile-detail" : "is-mobile-index"}`}>
        <nav className="settings-nav" aria-label="Settings sections">
          <button
            type="button"
            className="settings-mobile-profile"
            onClick={() => openSection("profile")}
          >
            <Avatar
              name={currentUserName || currentUserEmail}
              avatarUrl={currentUserAvatarUrl}
              presence={currentUserPresence}
              className="settings-mobile-avatar"
            />
            <span className="settings-mobile-profile-copy">
              <strong>{currentUserName || currentUserEmail || "Workspace member"}</strong>
              <small>
                {[currentUserEmail, currentUserJobRole].filter(Boolean).join(" · ")}
              </small>
              <em>{currentWorkspace?.role === "owner" ? "Workspace admin" : roleLabel}</em>
            </span>
            <ChevronRight size={16} aria-hidden="true" />
          </button>

          {navGroups.map((group) => {
            if (!group.sections.length) return null;
            return (
              <div className="settings-nav-group" data-group={group.id} key={group.id}>
                <span className="settings-nav-label">{group.label}</span>
                {group.sections.map(({ value, label, Icon }) => {
                  const isSupport = Boolean(group.navigates);
                  const isNotificationToggle = value === "notifications";
                  const isAppearanceToggle = value === "appearance";
                  const notificationsEnabled = Boolean(notificationPrefs?.notification_sound);
                  const appearanceEnabled = theme === "dark";
                  const meta = value === "whats-new"
                    ? (whatsNewUnread ? "1 new" : "")
                    : value === "workspaces"
                    ? `${workspaces.length} available`
                    : value === "workspace"
                      ? `${members.length} member${members.length === 1 ? "" : "s"}`
                      : value === "templates"
                        ? `${taskTemplates.length + projectTemplates.length} available`
                        : value === "integrations"
                          ? "Webhooks and calendar"
                          : value === "ai"
                            ? "Providers and access"
                            : value === "notifications" && unreadCount
                              ? `${unreadCount} unread`
                              : "";

                  return (
                    <div className="settings-nav-item" key={value}>
                      <button
                        type="button"
                        className={`settings-nav-link ${section === value && !isSupport ? "active" : ""}`}
                        aria-label={label}
                        aria-current={section === value && !isSupport ? "page" : undefined}
                        onClick={() => isSupport ? onNavigate?.(label) : openSection(value)}
                      >
                        <span className="settings-nav-icon"><Icon size={18} /></span>
                        <span className="settings-nav-copy">
                          <strong>{label}</strong>
                        </span>
                        {meta && <span className="settings-nav-meta">{meta}</span>}
                        <ChevronRight className="settings-nav-arrow" size={16} aria-hidden="true" />
                      </button>
                      {isNotificationToggle && (
                        <button
                          type="button"
                          role="switch"
                          className="settings-nav-toggle"
                          aria-label="Notification sound"
                          aria-checked={notificationsEnabled}
                          disabled={!notificationPrefs}
                          onClick={() => updatePreference("notification_sound", !notificationsEnabled)}
                        >
                          <span aria-hidden="true" />
                        </button>
                      )}
                      {isAppearanceToggle && (
                        <button
                          type="button"
                          role="switch"
                          className="settings-nav-toggle"
                          aria-label="Dark appearance"
                          aria-checked={appearanceEnabled}
                          onClick={() => onSetTheme?.(appearanceEnabled ? "light" : "dark")}
                        >
                          <span aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
          {onSignOut && (
            <button type="button" className="settings-mobile-signout" onClick={onSignOut}>
              <LogOut size={18} aria-hidden="true" />
              <span>Sign out</span>
            </button>
          )}
        </nav>
        <div className="settings-content">
          <button
            type="button"
            className="settings-mobile-back"
            aria-label="Back to settings sections"
            onClick={() => {
              setMobileSectionOpen(false);
              scrollMobileSettingsToTop();
            }}
          >
            <ChevronLeft size={18} aria-hidden="true" />
            <span>
              <small>Settings</small>
              <strong>{activeSectionLabel}</strong>
            </span>
          </button>
          {section === "appearance" && (
            <Card className="settings-panel">
              <div className="settings-panel-heading">
                <div>
                  <h2>Appearance</h2>
                  <p>Choose how WorkSpace looks on this device.</p>
                </div>
              </div>
              <div className="settings-section-heading">
                <div>
                  <strong>Theme</strong>
                  <span>Select a theme. System follows your operating system setting.</span>
                </div>
              </div>
              <div className="settings-theme-grid" role="radiogroup" aria-label="Theme">
                {[
                  ["light", "Light", "Bright surfaces"],
                  ["dark", "Dark", "Low-light comfort"],
                  ["system", "System", "Match your device"],
                ].map(([value, label, description]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={theme === value}
                    className={`settings-theme-card ${theme === value ? "is-active" : ""}`}
                    data-theme={value}
                    onClick={() => selectTheme(value)}
                  >
                    <span className="settings-theme-preview" aria-hidden="true" />
                    <span className="settings-theme-choice">
                      <span className="settings-radio" aria-hidden="true" />
                      <span>
                        <strong>{label}</strong>
                        <small>{description}</small>
                      </span>
                    </span>
                  </button>
                ))}
              </div>
              {appearanceError && (
                <SettingsAlert
                  className="settings-appearance-alert"
                  title="Could not save appearance"
                  onRetry={appearanceRetryValue
                    ? () => selectTheme(appearanceRetryValue)
                    : undefined}
                >
                  {appearanceError}
                </SettingsAlert>
              )}
              <div className="settings-sidebar-layout">
                <div>
                  <strong>Sidebar</strong>
                  <span>Keep the full navigation menu or reduce it to a compact icon rail.</span>
                </div>
                <div className="settings-segmented settings-sidebar-segmented" role="radiogroup" aria-label="Sidebar">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={!sidebarCollapsed}
                    className={!sidebarCollapsed ? "active" : ""}
                    onClick={() => sidebarCollapsed && onToggleSidebar?.()}
                  >
                    Expanded
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={sidebarCollapsed}
                    className={sidebarCollapsed ? "active" : ""}
                    onClick={() => !sidebarCollapsed && onToggleSidebar?.()}
                  >
                    Collapsed
                  </button>
                </div>
                <div className="settings-sidebar-preview" aria-hidden="true">
                  <span className="settings-sidebar-demo">
                    <i />
                    <i />
                    <i />
                    <i />
                  </span>
                  <ChevronRight className="settings-sidebar-arrow" size={18} />
                  <span className="settings-sidebar-rail">
                    <i />
                    <i />
                    <i />
                    <i />
                  </span>
                </div>
              </div>
              <p className="settings-note">Appearance is saved on this device and updates immediately.</p>
            </Card>
          )}
          {section === "ai" && (
            <Suspense fallback={null}>
              <AISettingsPanel
                workspaceId={workspaceId}
                members={members}
                canManageMembers={canManageMembers}
              />
            </Suspense>
          )}
          {section === "workspaces" && (
            <Card className="settings-panel" aria-busy={Boolean(lifecycleBusy)}>
              <div className="settings-panel-heading">
                <div>
                  <h2>Workspaces</h2>
                  <p>
                    Open a workspace, choose which one WorkSpace starts on, or
                    start one of your own.
                  </p>
                </div>
                <Button size="sm" aria-label="New workspace" onClick={() => onCreateWorkspace?.()}>
                  <Plus size={14} /> New
                </Button>
              </div>
              {lifecycleError && (
                <SettingsAlert
                  tone={lifecycleError.tone}
                  title={lifecycleError.title}
                  onRetry={lifecycleError.retry}
                >
                  {lifecycleError.message}
                </SettingsAlert>
              )}
              {workspaces.length ? (
                <div className="settings-workspace-grid">
                  {workspaces.map((workspace) => {
                    const isCurrent = workspace.id === workspaceId;
                    const isDefault = workspace.id === defaultWorkspaceId;
                    const isArchivedWorkspace =
                      workspace.status === "archived";
                    // Mirrors the canManageMembers gate on the section list:
                    // only an owner or manager of that workspace has a roster
                    // to open.
                    const canManageTeam = ["owner", "manager"].includes(
                      workspace.role,
                    );
                    const isArchivedBusy = lifecycleBusyFor("restore", workspace.id);
                    const isLeaveBusy = lifecycleBusyFor("leave", workspace.id);
                    const isDeleteBusy = lifecycleBusyFor("delete", workspace.id);
                    return (
                      <div
                        key={workspace.id}
                        className={`settings-workspace-card ${isCurrent ? "is-current" : ""}`}
                        aria-busy={isArchivedBusy || isLeaveBusy || isDeleteBusy}
                      >
                        <header>
                          <strong>{workspace.name}</strong>
                          <span
                            className={`settings-workspace-status ${
                              isArchivedWorkspace ? "is-archived" : isDefault ? "is-default" : ""
                            }`}
                          >
                            {isArchivedWorkspace ? "Archived" : isCurrent ? "Current" : isDefault ? "Default" : workspace.role}
                          </span>
                        </header>
                        <p>
                          {isArchivedWorkspace
                            ? "Read-only until restored."
                            : isCurrent
                            ? `Open now - you are ${workspace.role}`
                            : `You are ${workspace.role}${isDefault ? " - opens on sign in" : ""}`}
                        </p>
                        <div className="settings-workspace-actions">
                          {!isArchivedWorkspace && (
                            <Button
                              size="sm"
                              disabled={isCurrent}
                              onClick={() => onSwitchWorkspace?.(workspace.id)}
                            >
                              {isCurrent ? "Open now" : "Switch"}
                            </Button>
                          )}
                          {canManageTeam && !isArchivedWorkspace && (
                            <Button
                              size="sm"
                              variant="outline"
                              type="button"
                              onClick={() => {
                                onSwitchWorkspace?.(workspace.id);
                                setSection("workspace");
                                setMobileSectionOpen(true);
                                scrollMobileSettingsToTop();
                              }}
                            >
                              Manage team
                            </Button>
                          )}
                          {isArchivedWorkspace && workspace.role === "owner" && (
                            <Button
                              size="sm"
                              variant="outline"
                              type="button"
                              loading={isArchivedBusy}
                              disabled={Boolean(lifecycleBusy)}
                              onClick={() => restoreWorkspace(workspace.id)}
                            >
                              {isArchivedBusy ? "Restoring" : "Restore"}
                            </Button>
                          )}
                          {isArchivedWorkspace && workspace.role === "owner" && (
                            <Button
                              size="sm"
                              variant="destructive"
                              type="button"
                              loading={isDeleteBusy}
                              disabled={Boolean(lifecycleBusy)}
                              aria-expanded={deleteTargetId === workspace.id}
                              onClick={() => toggleDeleteConfirmation(workspace.id)}
                            >
                              {isDeleteBusy ? "Deleting" : "Delete forever"}
                            </Button>
                          )}
                          {!isArchivedWorkspace && !isDefault && (
                            <Button
                              size="sm"
                              variant="outline"
                              type="button"
                              onClick={() =>
                                onSetDefaultWorkspace?.(workspace.id)
                              }
                            >
                              Set as default
                            </Button>
                          )}
                          {workspace.role !== "owner" && (
                            <Button
                              size="sm"
                              variant="outline"
                              type="button"
                              loading={isLeaveBusy}
                              disabled={Boolean(lifecycleBusy)}
                              onClick={() =>
                                leaveWorkspace(workspace.id, workspace.name)
                              }
                            >
                              {isLeaveBusy ? "Leaving" : "Leave workspace"}
                            </Button>
                          )}
                          {isArchivedWorkspace && workspace.role !== "owner" && (
                            <small className="settings-workspace-permission-note">
                              Only the owner can restore or delete this workspace.
                            </small>
                          )}
                        </div>
                        {isArchivedWorkspace &&
                          workspace.role === "owner" &&
                          deleteTargetId === workspace.id && (
                            <div className="settings-workspace-delete-confirm">
                              <label>
                                <span>
                                  Type <strong>{workspace.name}</strong> to confirm
                                  permanent deletion
                                </span>
                                <input
                                  value={deleteConfirmText}
                                  onChange={(event) =>
                                    setDeleteConfirmText(event.target.value)
                                  }
                                  placeholder={workspace.name}
                                  autoFocus
                                />
                              </label>
                              <div>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  type="button"
                                  onClick={() => toggleDeleteConfirmation(workspace.id)}
                                >
                                  Cancel
                                </Button>
                                <Button
                                  size="sm"
                                  variant="destructive"
                                  type="button"
                                  loading={isDeleteBusy}
                                  disabled={
                                    Boolean(lifecycleBusy) ||
                                    deleteConfirmText !== workspace.name
                                  }
                                  onClick={() => deleteWorkspace(workspace.id)}
                                >
                                  {isDeleteBusy ? "Deleting" : "Delete permanently"}
                                </Button>
                              </div>
                            </div>
                          )}
                      </div>
                    );
                  })}
                  <div
                    className="settings-workspace-create-tile"
                  >
                    <span><Plus size={18} aria-hidden="true" /></span>
                    <strong>Create another workspace</strong>
                    <small>Keep projects, members, and settings independent.</small>
                    <Button size="sm" variant="outline" type="button" onClick={() => onCreateWorkspace?.()}>
                      Create workspace
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="settings-workspace-grid">
                  <div
                    className="settings-workspace-create-tile"
                  >
                    <span><Plus size={18} aria-hidden="true" /></span>
                    <strong>Create your first workspace</strong>
                    <small>Keep projects, members, and settings independent.</small>
                    <Button size="sm" variant="outline" type="button" onClick={() => onCreateWorkspace?.()}>
                      Create workspace
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          )}
          {section === "notifications" && (
            <Card className="settings-panel">
              <div className="settings-panel-heading">
                <div>
                  <h2>Notifications</h2>
                  <p>
                    {unreadCount
                      ? `${unreadCount} unread workspace updates.`
                      : "You are all caught up."}
                  </p>
                </div>
              </div>
              {notificationPrefs ? (
                <>
                  <div className="settings-section-heading">
                    <div>
                      <strong>Notification categories</strong>
                    </div>
                  </div>
                  <div className="settings-group-card">
                    {preferenceRows
                      .filter(([key]) => key !== "notification_sound")
                      .map(([key, label, description]) => (
                        <div className="settings-row settings-control-row settings-notification-row" key={key}>
                          <div>
                            <strong>{label}</strong>
                            <span>{description}</span>
                          </div>
                          <button
                            type="button"
                            role="switch"
                            className={`settings-switch ${notificationPrefs[key] ? "is-on" : ""}`}
                            aria-label={label}
                            aria-checked={notificationPrefs[key]}
                            onClick={() =>
                              updatePreference(key, !notificationPrefs[key])
                            }
                          >
                            <span className="settings-switch-track" aria-hidden="true" />
                            <span className="settings-switch-label">{notificationPrefs[key] ? "On" : "Off"}</span>
                          </button>
                        </div>
                      ))}
                  </div>
                  <div className="settings-section-heading">
                    <div>
                      <strong>Sound and device alerts</strong>
                    </div>
                  </div>
                  <div className="settings-group-card">
                    <div className="settings-row settings-control-row settings-notification-row">
                      <div>
                        <strong>Notification sound</strong>
                        <span>Play a sound when WorkSpace is focused.</span>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        className={`settings-switch ${notificationPrefs.notification_sound ? "is-on" : ""}`}
                        aria-label="Notification sound"
                        aria-checked={notificationPrefs.notification_sound}
                        onClick={() =>
                          updatePreference("notification_sound", !notificationPrefs.notification_sound)
                        }
                      >
                        <span className="settings-switch-track" aria-hidden="true" />
                        <span className="settings-switch-label">{notificationPrefs.notification_sound ? "On" : "Off"}</span>
                      </button>
                    </div>
                  <div className="settings-row settings-control-row">
                    <div>
                      <strong>Sound style</strong>
                      <span>
                        {NOTIFICATION_SOUND_OPTIONS.find(option => option.value === notificationPrefs.notification_sound_name)?.description || "Choose the sound played while WorkSpace is focused."}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <AppSelect
                        value={notificationPrefs.notification_sound_name}
                        onChange={(event) => updateNotificationSound(event.target.value)}
                        aria-label="Notification sound style"
                      >
                        {NOTIFICATION_SOUND_OPTIONS.map(option => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </AppSelect>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={previewNotificationSound}
                        disabled={!notificationPrefs.notification_sound || notificationVolume <= 0}
                      >
                        <Volume2 size={14} /> Preview
                      </button>
                    </div>
                  </div>
                  <div className="settings-row settings-control-row">
                    <div>
                      <strong>Sound volume</strong>
                      <span>Volume for sounds played while WorkSpace is focused.</span>
                    </div>
                    <div className="flex items-center gap-2.5">
                      <input
                        type="range"
                        min="0"
                        max="100"
                        step="5"
                        value={notificationVolume}
                        onChange={(event) => setNotificationVolume(Number(event.target.value))}
                        onPointerUp={(event) => commitNotificationVolume(Number(event.currentTarget.value))}
                        onKeyUp={(event) => commitNotificationVolume(Number(event.currentTarget.value))}
                        onBlur={(event) => commitNotificationVolume(Number(event.currentTarget.value))}
                        aria-label="Notification sound volume"
                        className="settings-volume-slider"
                      />
                      <span className="settings-volume-value">{notificationVolume}%</span>
                    </div>
                  </div>
                  </div>
                  {!notificationPrefs.notification_sound && (
                    <SettingsAlert
                      className="settings-notification-alert"
                      tone="info"
                      title="Notification sound is disabled"
                    >
                      Sound style and volume are still saved. Desktop notification sounds may follow your operating-system settings.
                    </SettingsAlert>
                  )}
                  <p className="settings-note">
                    Sound style and volume apply while WorkSpace is focused. When WorkSpace is backgrounded, minimized, or closed, desktop notifications use your operating system's notification sound and system volume.
                  </p>
                </>
              ) : (
                <SkeletonGroup className="settings-inline-skeleton" label="Loading your preferences">
                  <Skeleton variant="line" />
                  <Skeleton variant="text" />
                  <Skeleton variant="line" style={{ width: "68%" }} />
                </SkeletonGroup>
              )}
              {prefsError && (
                <SettingsAlert
                  className="settings-notification-alert"
                  title={prefsErrorKind === "load"
                    ? "Notification preferences could not be loaded"
                    : "Preferences were not saved"}
                  onRetry={prefsErrorKind === "save" && preferenceRetry
                    ? () => updatePreference(preferenceRetry.key, preferenceRetry.value)
                    : () => setNotificationPrefsReloadKey((current) => current + 1)}
                >
                  {prefsError}
                </SettingsAlert>
              )}
              {checkInSettingsError && (
                <SettingsAlert
                  className="settings-notification-alert"
                  title={checkInSettingsErrorKind === "save"
                    ? "Check-in reminder was not saved"
                    : "Check-in reminder settings could not be loaded"}
                  onRetry={checkInSettingsErrorKind === "save" && checkInRetryValue !== null
                    ? () => updateCheckInReminderHour(String(checkInRetryValue))
                    : () => setCheckInSettingsReloadKey((current) => current + 1)}
                >
                  {checkInSettingsError}
                </SettingsAlert>
              )}
              <div className="settings-group-card settings-device-alerts">
                {canManageMembers && checkInSettings && (
                  <div className="settings-row settings-control-row">
                    <div>
                      <strong>Daily check-in reminder</strong>
                      <span>Send reminders at this workspace's local time.</span>
                    </div>
                    <AppSelect
                      value={checkInSettings.check_in_reminder_hour}
                      onChange={(event) => updateCheckInReminderHour(event.target.value)}
                      aria-label="Daily check-in reminder hour"
                    >
                      {Array.from({ length: 24 }, (_, hour) => (
                        <option key={hour} value={hour}>{`${String(hour).padStart(2, "0")}:00`}</option>
                      ))}
                    </AppSelect>
                  </div>
                )}
                <div className="settings-row settings-control-row">
                  <div>
                    <strong>Desktop notifications</strong>
                    <span>
                      {browserPermission === "denied"
                        ? "Blocked - allow notifications for this site in your browser settings."
                        : !pushSupported
                          ? "Not supported in this browser."
                          : pushSubscribed
                            ? "Enabled on this device - alerts arrive even when WorkSpace is closed."
                            : "Enable alerts on this device even when WorkSpace is closed."}
                    </span>
                  </div>
                  {pushSupported && pushConfigured && browserPermission !== "denied" && (
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={pushBusy}
                      onClick={togglePushSubscription}
                    >
                      {pushBusy ? "Working..." : pushSubscribed ? "Disable" : "Enable"}
                    </button>
                  )}
                </div>
              </div>
              {browserPermission === "denied" && pushSupported && (
                <SettingsAlert
                  className="settings-notification-alert"
                  tone="warning"
                  title="Browser permission blocked"
                  onRetry={togglePushSubscription}
                  retryLabel="Try again"
                >
                  WorkSpace cannot reopen the browser prompt. Allow notifications for this site in your browser settings, then try again.
                </SettingsAlert>
              )}
              {!pushSupported && (
                <SettingsAlert
                  className="settings-notification-alert"
                  tone="info"
                  title="Desktop notifications are unavailable"
                >
                  This browser does not support device notifications. In-app notification categories still work.
                </SettingsAlert>
              )}
              {pushError && (
                <SettingsAlert
                  className="settings-notification-alert"
                  title="Device alerts could not be updated"
                  onRetry={pushErrorRetry === "subscription"
                    ? togglePushSubscription
                    : () => setPushConfigReloadKey((current) => current + 1)}
                >
                  {pushError}
                </SettingsAlert>
              )}
              {pushSupported && !pushConfigured && !pushError && (
                <p className="settings-note">
                  Desktop notifications are not configured for this workspace yet.
                </p>
              )}
              <p className="settings-note">
                Turning a category off stops those notifications from being
                created for you, on every device.
              </p>
            </Card>
          )}
          {section === "profile" && (
            <Card className="settings-panel">
              <div className="settings-panel-heading">
                <div>
                  <h2>Profile</h2>
                  <p>Your identity as it appears across the workspace.</p>
                </div>
              </div>
              <div className="settings-profile-card">
                <span className="avatar-upload">
                  <Avatar
                    name={currentUserName}
                    avatarUrl={currentUserAvatarUrl}
                    presence={currentUserPresence}
                    className="settings-profile-avatar"
                  />
                  <label
                    className="avatar-upload-trigger"
                    aria-label="Change profile photo"
                  >
                    <Camera size={14} />
                    <input
                      ref={avatarInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/gif,image/webp"
                      onChange={handleAvatarChange}
                      disabled={avatarUploading}
                    />
                  </label>
                </span>
                <div>
                  <strong>{currentUserName}</strong>
                  <span>{currentWorkspace?.name || "Workspace member"}</span>
                  {currentUserAvatarUrl && (
                    <button
                      type="button"
                      className="text-button"
                      onClick={handleAvatarRemove}
                      disabled={avatarUploading}
                    >
                      Remove photo
                    </button>
                  )}
                </div>
              </div>
              {avatarError && (
                <SettingsAlert
                  title="Photo could not be updated"
                  onRetry={avatarRetry ? retryAvatarUpdate : undefined}
                  secondaryAction={avatarRetry?.type === "upload" ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => avatarInputRef.current?.click()}
                    >
                      Choose file
                    </Button>
                  ) : null}
                >
                  {avatarError}
                </SettingsAlert>
              )}
              <div className="settings-section-heading settings-profile-section-heading">
                <div><strong>Personal details</strong></div>
              </div>
              <form ref={profileFormRef} className="settings-profile-form" onSubmit={saveProfile}>
                <div className="modal-grid">
                  <label>
                    First name
                    <input
                      value={profileForm.first_name}
                      onChange={(event) =>
                        setProfileForm((current) => ({
                          ...current,
                          first_name: event.target.value,
                        }))
                      }
                      maxLength="150"
                      required
                    />
                  </label>
                  <label>
                    Last name
                    <input
                      value={profileForm.last_name}
                      onChange={(event) =>
                        setProfileForm((current) => ({
                          ...current,
                          last_name: event.target.value,
                        }))
                      }
                      maxLength="150"
                    />
                  </label>
                </div>
                <label>
                  Email address
                  <input
                    type="email"
                    value={profileForm.email}
                    onChange={(event) =>
                      setProfileForm((current) => ({
                        ...current,
                        email: event.target.value,
                      }))
                    }
                    required
                  />
                </label>
                <div className="modal-grid">
                  <label>
                    Company
                    <input value={profileForm.company} onChange={(event) => setProfileForm((current) => ({ ...current, company: event.target.value }))} maxLength="150" />
                  </label>
                  <label>
                    Job role
                    <input value={profileForm.job_role} onChange={(event) => setProfileForm((current) => ({ ...current, job_role: event.target.value }))} maxLength="150" />
                  </label>
                </div>
                {profileError && (
                  <SettingsAlert
                    title="Profile could not be saved"
                    onRetry={() => profileFormRef.current?.requestSubmit()}
                  >
                    {profileError}
                  </SettingsAlert>
                )}
                <button className="secondary-button" disabled={profileSaving}>
                  {profileSaving ? "Saving…" : "Save profile"}
                </button>
              </form>
              <div className="settings-section-heading">
                <div><strong>Availability</strong></div>
              </div>
              <div className="settings-row settings-control-row">
                <div>
                  <strong>Presence</strong>
                  <span>
                    Shown to teammates next to your name, like a status in
                    Teams.
                  </span>
                </div>
                <span className="presence-select">
                  <span
                    className={`presence-dot presence-${currentUserPresence}`}
                  />
                  <AppSelect
                    value={currentUserPresence}
                    onChange={handlePresenceChange}
                    disabled={presenceSaving}
                    aria-label="Set your presence"
                  >
                    <option value="available">Available</option>
                    <option value="busy">Busy</option>
                    <option value="away">Away</option>
                    <option value="offline">Offline</option>
                  </AppSelect>
                </span>
              </div>
              {presenceError && (
                <SettingsAlert
                  title="Availability could not be updated"
                  onRetry={presenceRetryValue
                    ? () => handlePresenceChange({ target: { value: presenceRetryValue } })
                    : undefined}
                >
                  {presenceError}
                </SettingsAlert>
              )}
              <div className="settings-row">
                <div>
                  <strong>Workspace role</strong>
                  <span>Access level for this workspace.</span>
                </div>
                <em>{roleLabel}</em>
              </div>
              <p className="settings-note">
                Password changes remain available through your account provider.
              </p>
            </Card>
          )}
          {section === "templates" && (
            <Card className="settings-panel">
              <div className="settings-panel-heading">
                <div>
                  <h2>Templates</h2>
                  <p>
                    Create templates for repeatable tasks and projects, then
                    apply them from the create forms.
                  </p>
                </div>
              </div>
              <div className="settings-template-grid">
              <div className="settings-template-section">
                <h3>Task templates</h3>
                <p className="settings-template-description">Pre-fill priority, recurrence, project, and assignee.</p>
                <form
                  className="settings-template-form"
                  onSubmit={createTaskTemplate}
                >
                  <label>
                    Template name
                    <input
                      value={taskTemplateForm.name}
                      onChange={(event) =>
                        setTaskTemplateForm((current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                      required
                    />
                  </label>
                  <label>
                    Task title
                    <input
                      value={taskTemplateForm.title}
                      onChange={(event) =>
                        setTaskTemplateForm((current) => ({
                          ...current,
                          title: event.target.value,
                        }))
                      }
                      required
                    />
                  </label>
                  <label>
                    Description
                    <textarea
                      value={taskTemplateForm.description}
                      onChange={(event) =>
                        setTaskTemplateForm((current) => ({
                          ...current,
                          description: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <div className="modal-grid">
                    <label>
                      Priority
                      <AppSelect
                        value={taskTemplateForm.priority}
                        onChange={(event) =>
                          setTaskTemplateForm((current) => ({
                            ...current,
                            priority: event.target.value,
                          }))
                        }
                      >
                        <option value="urgent">Urgent</option>
                        <option value="high">High</option>
                        <option value="normal">Normal</option>
                        <option value="low">Low</option>
                      </AppSelect>
                    </label>
                    <label>
                      Recurrence
                      <AppSelect
                        value={taskTemplateForm.recurrence}
                        onChange={(event) =>
                          setTaskTemplateForm((current) => ({
                            ...current,
                            recurrence: event.target.value,
                          }))
                        }
                      >
                        <option value="none">Does not repeat</option>
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                        <option value="monthly">Monthly</option>
                      </AppSelect>
                    </label>
                    <label>
                      Assignee
                      <AppSelect
                        value={taskTemplateForm.assignee_id}
                        onChange={(event) =>
                          setTaskTemplateForm((current) => ({
                            ...current,
                            assignee_id: event.target.value,
                          }))
                        }
                      >
                        <option value="">Unassigned</option>
                        {members.map((member) => (
                          <option key={member.id} value={member.id}>
                            {[member.first_name, member.last_name]
                              .filter(Boolean)
                              .join(" ") || member.email}
                          </option>
                        ))}
                      </AppSelect>
                    </label>
                    <label>
                      Bucket
                      <input
                        value={taskTemplateForm.bucket}
                        onChange={(event) =>
                          setTaskTemplateForm((current) => ({
                            ...current,
                            bucket: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      Project
                      <AppSelect
                        value={taskTemplateForm.project_id}
                        onChange={(event) =>
                          setTaskTemplateForm((current) => ({
                            ...current,
                            project_id: event.target.value,
                          }))
                        }
                      >
                        <option value="">General</option>
                        {projects.map((project) => (
                          <option key={project.id} value={project.id}>
                            {project.name}
                          </option>
                        ))}
                      </AppSelect>
                    </label>
                    <label>
                      Workstream
                      <input
                        value={taskTemplateForm.workstream}
                        onChange={(event) =>
                          setTaskTemplateForm((current) => ({
                            ...current,
                            workstream: event.target.value,
                          }))
                        }
                      />
                    </label>
                  </div>
                  <button
                    className="secondary-button"
                    disabled={templateSaving}
                  >
                    {templateSaving ? "Saving…" : "Create task template"}
                  </button>
                </form>
                <div className="settings-template-list">
                  {taskTemplates.map((template) => (
                    <div className="settings-template-row" key={template.id}>
                      <div>
                        <strong>{template.name}</strong>
                        <span>
                          {template.title} · {template.priority} ·{" "}
                          {template.bucket}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => applyTaskTemplate(template)}
                      >
                        Use
                      </button>
                      {canManageMembers && (
                        <button
                          type="button"
                          className="inline-delete"
                          onClick={() => deleteTaskTemplate(template)}
                          aria-label={`Delete ${template.name}`}
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              <div className="settings-template-section">
                <h3>Project templates</h3>
                <p className="settings-template-description">Create the project shell and a default due window.</p>
                <form
                  className="settings-template-form"
                  onSubmit={createProjectTemplate}
                >
                  <label>
                    Template name
                    <input
                      value={projectTemplateForm.name}
                      onChange={(event) =>
                        setProjectTemplateForm((current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                      required
                    />
                  </label>
                  <label>
                    Project name
                    <input
                      value={projectTemplateForm.project_name}
                      onChange={(event) =>
                        setProjectTemplateForm((current) => ({
                          ...current,
                          project_name: event.target.value,
                        }))
                      }
                      required
                    />
                  </label>
                  <label>
                    Description
                    <textarea
                      value={projectTemplateForm.description}
                      onChange={(event) =>
                        setProjectTemplateForm((current) => ({
                          ...current,
                          description: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    Due in days
                    <input
                      type="number"
                      min="0"
                      max="365"
                      value={projectTemplateForm.due_days}
                      onChange={(event) =>
                        setProjectTemplateForm((current) => ({
                          ...current,
                          due_days: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <div className="settings-template-preview">
                    <span>Preview</span>
                    <strong>{projectTemplateForm.project_name || "New project"}</strong>
                    <small>Due {projectTemplateForm.due_days || 0} days after creation</small>
                    <i
                      aria-hidden="true"
                      style={{
                        "--template-progress": `${Math.min(Math.max(Number(projectTemplateForm.due_days) || 0, 0), 365) / 365 * 100}%`,
                      }}
                    />
                  </div>
                  <button
                    className="secondary-button"
                    disabled={templateSaving}
                  >
                    {templateSaving ? "Saving…" : "Create project template"}
                  </button>
                </form>
                <div className="settings-template-list">
                  {projectTemplates.map((template) => (
                    <div className="settings-template-row" key={template.id}>
                      <div>
                        <strong>{template.name}</strong>
                        <span>
                          {template.project_name} · {template.due_days} days
                        </span>
                      </div>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => applyProjectTemplate(template)}
                      >
                        Use
                      </button>
                      {canManageMembers && (
                        <button
                          type="button"
                          className="inline-delete"
                          onClick={() => deleteProjectTemplate(template)}
                          aria-label={`Delete ${template.name}`}
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
              </div>
              {templateError && (
                <p className="auth-error" role="alert">
                  {templateError}
                </p>
              )}
            </Card>
          )}
          {section === "workspace" && (
            <Card className="settings-panel">
              <div className="settings-panel-heading">
                <div>
                  <h2>Workspace access</h2>
                  <p>
                    Review who can access{" "}
                    {currentWorkspace?.name || "this workspace"}.
                  </p>
                </div>
              </div>
              <div className="settings-workspace-logo">
                <span className="settings-workspace-logo-frame">
                  {workspaceLogoUrl ? (
                    <img src={workspaceLogoUrl} alt="" />
                  ) : (
                    <span aria-hidden="true">
                      {(currentWorkspace?.name || "W").trim().charAt(0).toUpperCase()}
                    </span>
                  )}
                  <label className="avatar-upload-trigger" aria-label="Change workspace logo">
                    <Camera size={14} />
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/gif,image/webp"
                      onChange={handleLogoChange}
                      disabled={logoUploading}
                    />
                  </label>
                </span>
                <div>
                  <strong>Workspace logo</strong>
                  <span>
                    Shown in the sidebar and the workspace switcher. PNG, JPG,
                    GIF or WebP, up to 5 MB.
                  </span>
                  {workspaceLogoUrl && (
                    <button
                      type="button"
                      className="text-button"
                      onClick={handleLogoRemove}
                      disabled={logoUploading}
                    >
                      Remove logo
                    </button>
                  )}
                </div>
              </div>
              {logoError && (
                <p className="auth-error" role="alert">
                  {logoError}
                </p>
              )}
              <div className="settings-stat-grid">
                <div>
                  <strong>{members.length}</strong>
                  <span>Members</span>
                </div>
                <div>
                  <strong>
                    {
                      members.filter(
                        (member) =>
                          member.role === "owner" || member.role === "manager",
                      ).length
                    }
                  </strong>
                  <span>Managers</span>
                </div>
                <div>
                  <strong>
                    {currentWorkspace?.role === "owner"
                      ? "Owner"
                      : canManageMembers
                        ? "Manager"
                        : "Member"}
                  </strong>
                  <span>Your role</span>
                </div>
              </div>
              <div className="settings-section-heading">
                <div><strong>Members and roles</strong></div>
                <span>{members.length} member{members.length === 1 ? "" : "s"}</span>
              </div>
              <div className="settings-member-list">
                {permissionsError && (
                  <p className="auth-error" role="alert">
                    {permissionsError}
                  </p>
                )}
                {members.map((member) => {
                  // Mirrors the backend's member_detail rule: an owner can change anyone
                  // but the owner row; a manager can only change plain members.
                  const canEditThisRow =
                    member.role !== "owner" &&
                    (isOwner || (canManageMembers && member.role === "member"));
                  return (
                    <div className="settings-member-row" key={member.id}>
                      <Avatar
                        name={
                          [member.first_name, member.last_name]
                            .filter(Boolean)
                            .join(" ") || member.email
                        }
                        avatarUrl={member.avatar_url}
                        presence={effectivePresence(member)}
                        small
                      />
                      <div>
                        <strong>
                          {[member.first_name, member.last_name]
                            .filter(Boolean)
                            .join(" ") || member.email}
                        </strong>
                        <span>{member.email}</span>
                      </div>
                      {canEditThisRow ? (
                        <AppSelect
                          value={member.role}
                          disabled={permissionsSavingId === member.id}
                          onChange={(event) =>
                            changeMemberRole(member, event.target.value)
                          }
                          aria-label={`Change role for ${member.email}`}
                        >
                          <option value="member">Member</option>
                          <option value="manager">Manager</option>
                        </AppSelect>
                      ) : (
                        <em>{member.role}</em>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="settings-section-heading settings-working-hours-heading">
                <div>
                  <strong>Working hours</strong>
                  <span>Set daily hours and the days each member works. WorkSpace calculates weekly capacity from that schedule.</span>
                </div>
              </div>
              {workingHoursError && (
                <p className="auth-error settings-working-hours-error" role="alert">
                  {workingHoursError}
                </p>
              )}
              {members.length > 0 && (
                <div className="settings-working-hours-table-head" aria-hidden="true">
                  <span>Member</span>
                  <span>Daily hours</span>
                  <span>Working days</span>
                  <span>Weekly summary</span>
                  <span>Action</span>
                </div>
              )}
              <div className="settings-working-hours-list">
                {members.length ? (
                  members.map((member) => {
                    const canEditHours = member.role === "owner"
                      ? isOwner && String(member.id) === String(currentUserId)
                      : isOwner || (canManageMembers && member.role === "member");
                    return <MemberWorkingHoursRow
                      key={member.id}
                      member={member}
                      canEdit={canEditHours}
                      saving={workingHoursSavingId === member.id}
                      onSave={saveMemberWorkingHours}
                    />;
                  })
                ) : (
                  <p className="settings-working-hours-empty" role="status">
                    No members are available to configure yet.
                  </p>
                )}
              </div>
              <div className="settings-working-hours-guidance">
                <Clock3 size={17} aria-hidden="true" />
                <div>
                  <strong>How Team uses working hours</strong>
                  <span>Daily hours inform today&apos;s progress. Weekly hours are the sum of the selected days and drive allocated versus remaining capacity. Owners can edit their own row and every member; managers can edit regular members only.</span>
                </div>
              </div>
              {canManageMembers && (
                <p className="settings-note">
                  Invite new members and remove existing ones from Team.
                </p>
              )}
              {isOwner &&
                members.filter((member) => member.role === "manager").length >
                  0 && (
                  <div className="settings-manager-panel">
                    <div>
                      <strong>Manager permissions</strong>
                      <span>
                        Fine-tune exactly what each manager can do. Members
                        always keep the fixed minimal set (create and edit their
                        own tasks, use Zuri, view reports).
                      </span>
                    </div>
                    {members
                      .filter((member) => member.role === "manager")
                      .map((manager) => (
                        <div
                          key={manager.id}
                          className="settings-manager-card"
                        >
                          <strong className="block text-sm">
                            {[manager.first_name, manager.last_name]
                              .filter(Boolean)
                              .join(" ") || manager.email}
                          </strong>
                          <span className="mt-1 block text-xs text-text-muted">
                            {manager.email}
                          </span>
                          <div className="settings-permission-grid">
                            {PERMISSION_LABELS.map(([key, label]) => (
                              <label
                                key={key}
                                className="flex items-center gap-2 text-xs"
                              >
                                <input
                                  type="checkbox"
                                  checked={(manager.permissions || []).includes(
                                    key,
                                  )}
                                  disabled={permissionsSavingId === manager.id}
                                  onChange={() =>
                                    toggleManagerPermission(manager, key)
                                  }
                                />
                                {label}
                              </label>
                            ))}
                          </div>
                        </div>
                      ))}
                  </div>
                )}
              {isOwner && (
                <div className="settings-danger-panel">
                  <div>
                    <strong>Danger zone</strong>
                    <span>
                      {isArchived
                        ? "This workspace is archived. Restore it to resume normal use, or delete it permanently."
                        : "Archiving keeps your data but blocks new invitations and stops it from being anyone's default."}
                    </span>
                  </div>
                  {lifecycleError && (
                    <SettingsAlert
                      tone={lifecycleError.tone}
                      title={lifecycleError.title}
                      onRetry={lifecycleError.retry}
                      className="settings-danger-alert"
                    >
                      {lifecycleError.message}
                    </SettingsAlert>
                  )}
                  <div className="settings-danger-actions flex flex-wrap gap-2">
                    {!isArchived && (
                      <Button
                        type="button"
                        variant="outline"
                        loading={lifecycleBusyFor("archive", workspaceId)}
                        disabled={Boolean(lifecycleBusy)}
                        onClick={archiveWorkspace}
                      >
                        {lifecycleBusyFor("archive", workspaceId)
                          ? "Archiving"
                          : "Archive workspace"}
                      </Button>
                    )}
                    {isArchived && (
                      <Button
                        type="button"
                        variant="outline"
                        loading={lifecycleBusyFor("restore", workspaceId)}
                        disabled={Boolean(lifecycleBusy)}
                        onClick={() => restoreWorkspace(workspaceId)}
                      >
                        {lifecycleBusyFor("restore", workspaceId)
                          ? "Restoring"
                          : "Restore workspace"}
                      </Button>
                    )}
                  </div>
                  {isArchived && (
                    <div className="flex flex-wrap items-center gap-2">
                      <label>
                        Type "{currentWorkspace?.name}" to confirm permanent
                        deletion
                        <input
                          value={deleteConfirmText}
                          onChange={(event) =>
                            setDeleteConfirmText(event.target.value)
                          }
                          placeholder={currentWorkspace?.name}
                        />
                      </label>
                      <Button
                        type="button"
                        variant="destructive"
                        loading={lifecycleBusyFor("delete", workspaceId)}
                        disabled={
                          Boolean(lifecycleBusy) ||
                          deleteConfirmText !== currentWorkspace?.name
                        }
                        onClick={() => deleteWorkspace(workspaceId)}
                      >
                        {lifecycleBusyFor("delete", workspaceId)
                          ? "Deleting"
                          : "Delete permanently"}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </Card>
          )}
          {section === "integrations" && (
            <Card className="settings-panel">
              <div className="settings-panel-heading">
                <div>
                  <h2>Integrations</h2>
                  <p>
                    Send WorkSpace notifications to Microsoft Teams or Slack,
                    and subscribe to the team calendar from Outlook or Google
                    Calendar.
                  </p>
                </div>
              </div>
              <div className="settings-integration-card">
                <div className="settings-integration-card-heading">
                  <span><Link2 size={16} aria-hidden="true" /></span>
                  <div>
                    <strong>Calendar subscribe link</strong>
                    <small>
                      Add this feed to Outlook, Google Calendar, or Apple Calendar. It updates automatically as events change.
                    </small>
                  </div>
                </div>
                {calendarSubscribeUrl ? (
                  <div className="settings-webhook-url-row">
                    <Link2 size={14} />
                    <code>{calendarSubscribeUrl}</code>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={copyCalendarSubscribeUrl}
                      aria-label="Copy subscribe link"
                    >
                      <Copy size={14} />
                    </Button>
                  </div>
                ) : (
                  <SkeletonGroup className="settings-inline-skeleton" label="Loading your subscribe link">
                    <Skeleton variant="row" />
                  </SkeletonGroup>
                )}
                {canManageMembers && (
                  <button
                    type="button"
                    className="secondary-button settings-reset-link"
                    disabled={calendarTokenSaving}
                    onClick={resetCalendarToken}
                  >
                    {calendarTokenSaving ? "Resetting..." : "Reset link"}
                  </button>
                )}
              </div>
              <div className="settings-section-heading">
                <div>
                  <strong>Webhooks</strong>
                  <span>Post task, calendar, and chat notifications to a Teams or Slack channel.</span>
                </div>
              </div>
              {webhooksError && (
                <p className="auth-error" role="alert">
                  {webhooksError}
                </p>
              )}
              <div className="settings-webhook-list">
                {webhooks.length ? (
                  webhooks.map((hook) => (
                    <div className="settings-webhook-row" key={hook.id}>
                      <Webhook size={14} />
                      <div>
                        <strong>
                          {hook.label ||
                            (hook.kind === "teams"
                              ? "Microsoft Teams"
                              : hook.kind === "slack"
                                ? "Slack"
                                : "Generic webhook")}
                        </strong>
                        <span>{hook.url}</span>
                      </div>
                      <button
                        type="button"
                        className={`settings-switch ${hook.is_active ? "is-on" : ""}`}
                        aria-pressed={hook.is_active}
                        onClick={() => toggleWebhook(hook)}
                      >
                        <span className="settings-switch-track" aria-hidden="true" />
                        <span className="settings-switch-label">{hook.is_active ? "On" : "Off"}</span>
                      </button>
                      {canManageMembers && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => deleteWebhook(hook)}
                          aria-label={`Remove ${hook.label || hook.url}`}
                        >
                          <X size={14} />
                        </Button>
                      )}
                    </div>
                  ))
                ) : (
                  <p className="settings-note">No webhooks connected yet.</p>
                )}
              </div>
              {canManageMembers && (
                <form className="settings-webhook-form" onSubmit={addWebhook}>
                  <strong className="settings-webhook-form-title">Connect a channel</strong>
                  <AppSelect
                    value={webhookForm.kind}
                    onChange={(event) =>
                      setWebhookForm((current) => ({
                        ...current,
                        kind: event.target.value,
                      }))
                    }
                    aria-label="Webhook type"
                  >
                    <option value="teams">Microsoft Teams</option>
                    <option value="slack">Slack</option>
                    <option value="generic">Generic JSON</option>
                  </AppSelect>
                  <input
                    type="url"
                    required
                    placeholder="https://... incoming webhook URL"
                    value={webhookForm.url}
                    onChange={(event) =>
                      setWebhookForm((current) => ({
                        ...current,
                        url: event.target.value,
                      }))
                    }
                    aria-label="Webhook URL"
                  />
                  <input
                    type="text"
                    placeholder="Label (optional)"
                    value={webhookForm.label}
                    onChange={(event) =>
                      setWebhookForm((current) => ({
                        ...current,
                        label: event.target.value,
                      }))
                    }
                    aria-label="Webhook label"
                    maxLength={120}
                  />
                  <Button type="submit" disabled={webhookSaving}>
                    {webhookSaving ? "Connecting..." : "Connect"}
                  </Button>
                  <small className="settings-webhook-form-note">The webhook starts sending notifications as soon as it is connected.</small>
                </form>
              )}
              {!canManageMembers && (
                <p className="settings-note">
                  Only owners and managers can connect or remove webhooks.
                </p>
              )}
            </Card>
          )}
        </div>
      </div>
    </section>
  );
}

export default SettingsView;
