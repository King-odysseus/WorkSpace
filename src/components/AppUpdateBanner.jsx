import { useEffect, useState } from "react";

import { applyAppUpdate, subscribeToAppUpdates } from "../lib/app-updates.js";

// Shown when a newer build is waiting to take over. Reloading is the user's
// call: an unprompted swap would drop whatever they were typing, and this app
// holds plenty of half-finished work (a task draft, a chat message, a document).
//
// Dismissing only hides the banner. The waiting worker stays waiting and takes
// over the next time the app is closed and reopened, so nothing is lost by
// choosing "Later".
export default function AppUpdateBanner() {
  const [updateReady, setUpdateReady] = useState(false);
  const [reloading, setReloading] = useState(false);

  useEffect(() => subscribeToAppUpdates(setUpdateReady), []);

  if (!updateReady) return null;

  return (
    <div className="app-update-banner" role="status" aria-live="polite">
      <span className="app-update-banner-mark" aria-hidden="true" />
      <div className="app-update-banner-copy">
        <strong>A new version of WorkSpace is available</strong>
        <span>Reload to pick up the latest changes.</span>
      </div>
      <button
        type="button"
        className="primary-button"
        disabled={reloading}
        onClick={() => {
          setReloading(true);
          applyAppUpdate();
        }}
      >
        {reloading ? "Reloading..." : "Reload now"}
      </button>
      <button
        type="button"
        className="app-update-banner-dismiss"
        onClick={() => setUpdateReady(false)}
      >
        Later
      </button>
    </div>
  );
}
