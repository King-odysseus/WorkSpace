import { House, LifeBuoy, RefreshCw, TriangleAlert } from "lucide-react";
import { formatSentenceBreaks } from "../lib/sentence-format.js";

export default function BrandedStatusScreen({
  loading = false,
  onReload,
  onGoToToday,
}) {
  if (loading) {
    return (
      <main
        className="branded-status-screen is-loading"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-busy="true"
        aria-label="Loading WorkSpace"
      >
        <img
          className="branded-status-logo"
          src="/tijha-logo.png"
          alt=""
          aria-hidden="true"
        />
      </main>
    );
  }

  const reload = onReload || (() => window.location.reload());
  const goToToday =
    onGoToToday ||
    (() => {
      localStorage.setItem("workspace-last-page", "Today");
      const target = new URL(window.location.href);
      target.search = "?view=Today";
      target.hash = "";
      window.location.assign(target);
    });

  return (
    <main
      className="branded-status-screen is-error"
      role="alert"
      aria-labelledby="branded-status-title"
      aria-describedby="branded-status-description"
    >
      <section className="branded-status-content">
        <div className="branded-status-brand">
          <span className="branded-status-brand-mark" aria-hidden="true">
            <img src="/tijha-logo.png" alt="" />
          </span>
          <p className="branded-status-wordmark">WorkSpace</p>
        </div>

        <span className="branded-status-error-mark" aria-hidden="true">
          <TriangleAlert />
        </span>
        <p className="branded-status-eyebrow">Workspace error</p>
        <h1
          id="branded-status-title"
          aria-label="The workspace could not render this view"
        >
          <span className="branded-status-title-desktop">
            The workspace could not render this view
          </span>
          <span className="branded-status-title-mobile">
            This view could not render
          </span>
        </h1>
        <p id="branded-status-description" className="branded-status-description sentence-breaks">
          {formatSentenceBreaks("Your data is safe. Reload this view, or return to Today if the same screen keeps failing.")}
        </p>

        <div className="branded-status-actions">
          <button
            type="button"
            className="branded-status-primary-action"
            onClick={reload}
          >
            <RefreshCw aria-hidden="true" />
            Reload view
          </button>
          <button
            type="button"
            className="branded-status-secondary-action"
            onClick={goToToday}
          >
            <House aria-hidden="true" />
            Go to Today
          </button>
        </div>

        <p className="branded-status-support">
          <LifeBuoy aria-hidden="true" />
          <span className="sentence-breaks">
            {formatSentenceBreaks("Reloading keeps the current route. Go to Today clears the saved crash route before reloading.")}
          </span>
        </p>
      </section>
    </main>
  );
}
