import { urlBase64ToUint8Array, savePushSubscription } from "../lib/push-subscriptions.js";
import { AppSelect } from "./ui/select.jsx";
// The Settings area: appearance, notification preferences, profile, workspace
// access, reusable templates, and outbound integrations (webhooks + the calendar
// subscribe link).

import { lazy, Suspense, useEffect, useState } from "react";
import {
  Bell,
  Building2,
  Camera,
  ClipboardList,
  Copy,
  Link2,
  Sparkles,
  Sun,
  Users,
  Webhook,
  X,
} from "lucide-react";
import { Button } from "./ui/button.jsx";
import { Card } from "./ui/card.jsx";
import Avatar from "./Avatar.jsx";
const AISettingsPanel = lazy(() =>
  import("./WorkspaceTools.jsx").then((module) => ({
    default: module.AISettingsPanel,
  })),
);
import { WorkspaceViewHeading } from "./workspace-ui.jsx";
import { effectivePresence, getCsrfToken } from "../lib/workspace-format.js";

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
  taskTemplates = [],
  projectTemplates = [],
  projects = [],
  onRefresh,
}) {
  const [section, setSection] = useState("appearance");
  const [notificationPrefs, setNotificationPrefs] = useState(null);
  const [checkInSettings, setCheckInSettings] = useState(null);
  const [checkInSettingsError, setCheckInSettingsError] = useState("");
  const [prefsError, setPrefsError] = useState("");
  const [browserPermission, setBrowserPermission] = useState(() =>
    "Notification" in window ? Notification.permission : "unsupported",
  );
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarError, setAvatarError] = useState("");
  const [presenceSaving, setPresenceSaving] = useState(false);
  const [presenceError, setPresenceError] = useState("");
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
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [lifecycleError, setLifecycleError] = useState("");
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [permissionsSavingId, setPermissionsSavingId] = useState(null);
  const [permissionsError, setPermissionsError] = useState("");
  const isOwner = currentWorkspace?.role === "owner";
  const isArchived = currentWorkspace?.status === "archived";
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
  const runLifecycleAction = async (
    targetWorkspaceId,
    method,
    path,
    confirmMessage,
  ) => {
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    setLifecycleBusy(true);
    setLifecycleError("");
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
      if (!response.ok)
        throw new Error(data.error || "This action could not be completed.");
      // Membership, the default-workspace fallback, and which workspace is
      // "current" can all change from this one call - reload so the app
      // re-derives session state from scratch instead of hand-patching every
      // affected piece of client state.
      window.location.reload();
    } catch (error) {
      setLifecycleError(error.message || "This action could not be completed.");
      setLifecycleBusy(false);
    }
  };
  const leaveWorkspace = (targetWorkspaceId, name) =>
    runLifecycleAction(
      targetWorkspaceId,
      "POST",
      "/leave/",
      `Leave ${name || "this workspace"}? You will lose access until you are invited again.`,
    );
  const archiveWorkspace = () =>
    runLifecycleAction(
      workspaceId,
      "POST",
      "/archive/",
      `Archive ${currentWorkspace?.name || "this workspace"}? Members keep read access; only the owner can restore or permanently delete it.`,
    );
  const restoreWorkspace = () =>
    runLifecycleAction(workspaceId, "POST", "/restore/", "");
  const deleteWorkspace = () =>
    runLifecycleAction(workspaceId, "DELETE", "/", "");
  // Regular members only ever see personal settings (appearance, notifications,
  // profile/presence); workspace-wide administration is owner/manager-only.
  // This is a UI convenience, not the authorization boundary - every endpoint
  // behind these panels re-checks the actor's permission server-side.
  const sections = [
    ["appearance", "Appearance", Sun],
    ["notifications", "Notifications", Bell],
    ["profile", "Profile", Users],
    ...(canManageMembers
      ? [
          ["templates", "Templates", ClipboardList],
          ["workspace", "Workspace access", Building2],
          ["integrations", "Integrations", Webhook],
          ["ai", "Zuri", Sparkles],
        ]
      : []),
  ];
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
      "Play the browser notification sound whether WorkSpace is open, backgrounded, or minimized.",
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
    fetch(`/api/workspaces/${workspaceId}/notification-preferences/`, {
      credentials: "include",
      headers: { "X-Workspace-Id": String(workspaceId) },
    })
      .then((response) =>
        response.json().then((data) => ({ ok: response.ok, data })),
      )
      .then(({ ok, data }) => {
        if (isCurrent && ok) setNotificationPrefs(data.preferences);
      })
      .catch(() => {
        if (isCurrent)
          setPrefsError("Notification preferences could not be loaded.");
      });
    return () => {
      isCurrent = false;
    };
  }, [workspaceId]);
  useEffect(() => {
    if (!workspaceId || !canManageMembers) return undefined;
    let isCurrent = true;
    fetch(`/api/workspaces/${workspaceId}/check-in-settings/`, { credentials: "include" })
      .then((response) => response.json().then((data) => ({ ok: response.ok, data })))
      .then(({ ok, data }) => {
        if (!isCurrent) return;
        if (!ok) throw new Error(data.error || "Check-in settings could not be loaded.");
        setCheckInSettings(data.settings);
      })
      .catch((error) => {
        if (isCurrent) setCheckInSettingsError(error.message);
      });
    return () => { isCurrent = false; };
  }, [workspaceId, canManageMembers]);
  const updateCheckInReminderHour = async (value) => {
    const previous = checkInSettings;
    setCheckInSettings((current) => ({ ...current, check_in_reminder_hour: Number(value) }));
    setCheckInSettingsError("");
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
    } catch (error) {
      setCheckInSettings(previous);
      setCheckInSettingsError(error.message);
    }
  };
  const updatePreference = async (key, value) => {
    const previous = notificationPrefs;
    setNotificationPrefs((current) => ({ ...current, [key]: value }));
    setPrefsError("");
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
    } catch (error) {
      setNotificationPrefs(previous);
      setPrefsError(error.message || "Preference could not be saved.");
    }
  };
  useEffect(() => {
    if (!workspaceId || section !== "integrations") return undefined;
    let isCurrent = true;
    fetch(`/api/workspaces/${workspaceId}/webhooks/?page_size=500`, {
      credentials: "include",
      headers: { "X-Workspace-Id": String(workspaceId) },
    })
      .then((response) =>
        response.json().then((data) => ({ ok: response.ok, data })),
      )
      .then(({ ok, data }) => {
        if (isCurrent && ok) setWebhooks(data.webhooks);
      })
      .catch(() => {
        if (isCurrent) setWebhooksError("Webhooks could not be loaded.");
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
  const pushSupported = "Notification" in window && "serviceWorker" in navigator && "PushManager" in window;
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
      .catch((error) => setPushError(error.message || "Push notification configuration could not be loaded."));
  }, []);
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
  }, [pushSupported, pushConfigured, pushPublicKey]);
  const togglePushSubscription = async () => {
    if (!pushSupported || !pushConfigured || pushBusy) return;
    setPushBusy(true);
    setPushError("");
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
      setPushError(error.message || "Push notifications could not be updated.");
    } finally {
      setPushBusy(false);
    }
  };
  const handleAvatarChange = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
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
    } catch (error) {
      setAvatarError(error.message || "Photo could not be uploaded.");
    } finally {
      setAvatarUploading(false);
    }
  };
  const handleAvatarRemove = async () => {
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
    } catch (error) {
      setAvatarError(error.message || "Photo could not be removed.");
    } finally {
      setAvatarUploading(false);
    }
  };
  const handlePresenceChange = async (event) => {
    const presence = event.target.value;
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
    <section className="workspace-view page-view settings-view">
      <WorkspaceViewHeading
        title="Settings"
        subtitle="Control your workspace, account, and notification preferences."
      />
      <div className="settings-shell">
        <nav className="settings-nav" aria-label="Settings sections">
          {sections.map(([value, label, Icon]) => (
            <button
              type="button"
              key={value}
              className={section === value ? "active" : ""}
              onClick={() => setSection(value)}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </nav>
        <div className="settings-content">
          {section === "appearance" && (
            <Card className="settings-panel">
              <div className="settings-panel-heading">
                <div>
                  <p className="eyebrow">Personal preferences</p>
                  <h2>Appearance</h2>
                  <p>Choose how WorkSpace looks on this device.</p>
                </div>
              </div>
              <div className="settings-row settings-control-row">
                <div>
                  <strong>Theme</strong>
                  <span>Light, dark, or follow your operating system.</span>
                </div>
                <div
                  className="settings-segmented"
                  role="radiogroup"
                  aria-label="Theme"
                >
                  <button
                    type="button"
                    className={theme === "light" ? "active" : ""}
                    onClick={() => onSetTheme("light")}
                  >
                    Light
                  </button>
                  <button
                    type="button"
                    className={theme === "dark" ? "active" : ""}
                    onClick={() => onSetTheme("dark")}
                  >
                    Dark
                  </button>
                  <button
                    type="button"
                    className={theme === "system" ? "active" : ""}
                    onClick={() => onSetTheme("system")}
                  >
                    System
                  </button>
                </div>
              </div>
              <div className="settings-row settings-control-row">
                <div>
                  <strong>Sidebar</strong>
                  <span>Use a full navigation menu or compact icon rail.</span>
                </div>
                <button
                  type="button"
                  className="settings-switch"
                  aria-pressed={!sidebarCollapsed}
                  onClick={onToggleSidebar}
                >
                  <span />
                  {sidebarCollapsed ? "Collapsed" : "Expanded"}
                </button>
              </div>
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
          {section === "profile" && workspaces.length >= 1 && (
            <Card className="settings-panel">
              <div className="settings-panel-heading">
                <div>
                  <p className="eyebrow">Workspace entry</p>
                  <h2>Default workspace</h2>
                  <p>
                    Choose the workspace WorkSpace opens when you sign in, or
                    leave one you no longer need.
                  </p>
                </div>
              </div>
              {lifecycleError && (
                <p className="auth-error" role="alert">
                  {lifecycleError}
                </p>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                {workspaces.map((workspace) => (
                  <div
                    key={workspace.id}
                    className={`rounded-xl border p-4 text-left transition-colors ${workspace.id === defaultWorkspaceId ? "border-primary bg-primary/5" : "border-border hover:bg-surface-secondary"}`}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        workspace.status === "active" &&
                        onSetDefaultWorkspace?.(workspace.id)
                      }
                      aria-pressed={workspace.id === defaultWorkspaceId}
                      disabled={workspace.status !== "active"}
                      className="block w-full text-left"
                    >
                      <strong className="block text-sm">
                        {workspace.name}
                        {workspace.status === "archived" ? " (archived)" : ""}
                      </strong>
                      <span className="mt-1 block text-xs text-text-muted">
                        {workspace.id === defaultWorkspaceId
                          ? "Default entry workspace"
                          : workspace.status === "active"
                            ? "Set as default"
                            : "Archived - cannot be a default"}
                      </span>
                    </button>
                    {workspace.role !== "owner" && (
                      <button
                        type="button"
                        className="text-button mt-2"
                        disabled={lifecycleBusy}
                        onClick={() =>
                          leaveWorkspace(workspace.id, workspace.name)
                        }
                      >
                        Leave workspace
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          )}
          {section === "notifications" && (
            <Card className="settings-panel">
              <div className="settings-panel-heading">
                <div>
                  <p className="eyebrow">Stay informed</p>
                  <h2>Notifications</h2>
                  <p>
                    {unreadCount
                      ? `${unreadCount} unread workspace updates.`
                      : "You are all caught up."}
                  </p>
                </div>
              </div>
              {notificationPrefs ? (
                preferenceRows.map(([key, label, description]) => (
                  <div className="settings-row settings-control-row" key={key}>
                    <div>
                      <strong>{label}</strong>
                      <span>{description}</span>
                    </div>
                    <button
                      type="button"
                      className={`settings-switch ${notificationPrefs[key] ? "is-on" : ""}`}
                      aria-pressed={notificationPrefs[key]}
                      onClick={() =>
                        updatePreference(key, !notificationPrefs[key])
                      }
                    >
                      <span />
                      {notificationPrefs[key] ? "On" : "Off"}
                    </button>
                  </div>
                ))
              ) : (
                <p className="settings-note">Loading your preferences…</p>
              )}
              {prefsError && (
                <p className="auth-error" role="alert">
                  {prefsError}
                </p>
              )}
              {canManageMembers && checkInSettings && (
                <div className="settings-row settings-control-row">
                  <div>
                    <strong>Daily check-in reminder</strong>
                    <span>Send reminders at this workspace’s local time.</span>
                  </div>
                  <select
                    value={checkInSettings.check_in_reminder_hour}
                    onChange={(event) => updateCheckInReminderHour(event.target.value)}
                    aria-label="Daily check-in reminder hour"
                  >
                    {Array.from({ length: 24 }, (_, hour) => (
                      <option key={hour} value={hour}>{`${String(hour).padStart(2, "0")}:00`}</option>
                    ))}
                  </select>
                </div>
              )}
              {checkInSettingsError && <p className="auth-error" role="alert">{checkInSettingsError}</p>}
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
              {pushError && <p className="settings-note" role="alert">{pushError}</p>}
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
                  <p className="eyebrow">Your account</p>
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
                <p className="auth-error" role="alert">
                  {avatarError}
                </p>
              )}
              <form className="settings-profile-form" onSubmit={saveProfile}>
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
                  <p className="auth-error" role="alert">
                    {profileError}
                  </p>
                )}
                <button className="secondary-button" disabled={profileSaving}>
                  {profileSaving ? "Saving…" : "Save profile"}
                </button>
              </form>
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
                <p className="auth-error" role="alert">
                  {presenceError}
                </p>
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
                  <p className="eyebrow">Reusable setup</p>
                  <h2>Templates</h2>
                  <p>
                    Create templates for repeatable tasks and projects, then
                    apply them from the create forms.
                  </p>
                </div>
              </div>
              <div className="settings-template-section">
                <h3>Task templates</h3>
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
                      Repeat
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
                  <p className="eyebrow">Workspace administration</p>
                  <h2>Workspace access</h2>
                  <p>
                    Review who can access{" "}
                    {currentWorkspace?.name || "this workspace"}.
                  </p>
                </div>
              </div>
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
              {canManageMembers && (
                <p className="settings-note">
                  Invite new members and remove existing ones from Team board.
                </p>
              )}
              {isOwner &&
                members.filter((member) => member.role === "manager").length >
                  0 && (
                  <div
                    className="settings-row settings-control-row"
                    style={{
                      marginTop: "1rem",
                      flexDirection: "column",
                      alignItems: "stretch",
                      gap: "0.75rem",
                    }}
                  >
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
                          className="rounded-xl border border-border p-4"
                        >
                          <strong className="block text-sm">
                            {[manager.first_name, manager.last_name]
                              .filter(Boolean)
                              .join(" ") || manager.email}
                          </strong>
                          <span className="mt-1 block text-xs text-text-muted">
                            {manager.email}
                          </span>
                          <div className="mt-3 grid gap-2 sm:grid-cols-2">
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
                <div
                  className="settings-row settings-control-row"
                  style={{
                    marginTop: "1rem",
                    flexDirection: "column",
                    alignItems: "stretch",
                    gap: "0.75rem",
                  }}
                >
                  <div>
                    <strong>Danger zone</strong>
                    <span>
                      {isArchived
                        ? "This workspace is archived. Restore it to resume normal use, or delete it permanently."
                        : "Archiving keeps your data but blocks new invitations and stops it from being anyone's default."}
                    </span>
                  </div>
                  {lifecycleError && (
                    <p className="auth-error" role="alert">
                      {lifecycleError}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {!isArchived && (
                      <Button
                        type="button"
                        variant="outline"
                        disabled={lifecycleBusy}
                        onClick={archiveWorkspace}
                      >
                        Archive workspace
                      </Button>
                    )}
                    {isArchived && (
                      <Button
                        type="button"
                        variant="outline"
                        disabled={lifecycleBusy}
                        onClick={restoreWorkspace}
                      >
                        Restore workspace
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
                        disabled={
                          lifecycleBusy ||
                          deleteConfirmText !== currentWorkspace?.name
                        }
                        onClick={deleteWorkspace}
                      >
                        Delete permanently
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
                  <p className="eyebrow">Connect other tools</p>
                  <h2>Integrations</h2>
                  <p>
                    Send WorkSpace notifications to Microsoft Teams or Slack,
                    and subscribe to the team calendar from Outlook or Google
                    Calendar.
                  </p>
                </div>
              </div>
              <div className="settings-row settings-control-row">
                <div>
                  <strong>Calendar subscribe link</strong>
                  <span>
                    Add this feed to Outlook, Google Calendar, or Apple Calendar
                    - it updates automatically as events change.
                  </span>
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
                <p className="settings-note">Loading your subscribe link…</p>
              )}
              {canManageMembers && (
                <button
                  type="button"
                  className="text-button"
                  disabled={calendarTokenSaving}
                  onClick={resetCalendarToken}
                >
                  {calendarTokenSaving ? "Resetting…" : "Reset link"}
                </button>
              )}
              <div
                className="settings-row settings-control-row"
                style={{ marginTop: "1rem" }}
              >
                <div>
                  <strong>Webhooks</strong>
                  <span>
                    Post task, calendar, and chat notifications to a Teams or
                    Slack channel.
                  </span>
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
                        <span />
                        {hook.is_active ? "On" : "Off"}
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
                    {webhookSaving ? "Connecting…" : "Connect"}
                  </Button>
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
