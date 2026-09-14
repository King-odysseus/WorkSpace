import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";

import {
  dismissInstallBanner,
  getInstallSnapshot,
  isInstallBannerDismissed,
  promptToInstall,
  subscribeToInstallState,
} from "../lib/install-prompt.js";

export default function InstallAppBanner({ userId, onOpenGuide }) {
  const [installState, setInstallState] = useState(() => getInstallSnapshot());
  const [dismissed, setDismissed] = useState(() => isInstallBannerDismissed(userId));
  const [busy, setBusy] = useState(false);

  useEffect(() => subscribeToInstallState(() => setInstallState(getInstallSnapshot())), []);

  if (dismissed || installState.installed || !installState.eligible) return null;

  const install = async () => {
    if (!installState.canPrompt) {
      onOpenGuide();
      return;
    }

    setBusy(true);
    const outcome = await promptToInstall();
    setBusy(false);
    if (outcome === "unavailable") onOpenGuide();
  };

  const dismiss = () => {
    dismissInstallBanner(userId);
    setDismissed(true);
  };

  return (
    <aside className="install-app-banner" aria-label="Install WorkSpace">
      <span className="install-app-banner-icon" aria-hidden="true">
        <Download size={18} />
      </span>
      <div className="install-app-banner-copy">
        <strong>
          {installState.ios ? "Add WorkSpace to your Home Screen" : "Install WorkSpace for faster access"}
        </strong>
        <span>
          {installState.ios
            ? "Open WorkSpace like an app and enable notifications on iPhone or iPad."
            : "Open WorkSpace in its own window and get to your work faster."}
        </span>
      </div>
      <div className="install-app-banner-actions">
        <button type="button" className="primary-button" disabled={busy} onClick={install}>
          {busy ? "Opening..." : installState.canPrompt ? "Install app" : "View install steps"}
        </button>
        <button
          type="button"
          className="install-app-banner-dismiss"
          aria-label="Dismiss install app banner"
          title="Dismiss install app banner"
          onClick={dismiss}
        >
          <X size={16} />
        </button>
      </div>
    </aside>
  );
}
