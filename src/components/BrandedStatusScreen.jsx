export default function BrandedStatusScreen({ loading = false, error = "" }) {
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

  return (
    <main className="branded-status-screen is-error" role="alert">
      <section className="branded-status-content">
        <img
          className="branded-status-logo"
          src="/tijha-logo.png"
          alt="WorkSpace"
        />
        <p className="branded-status-wordmark">WorkSpace</p>
        <div className="branded-status-mark">!</div>
        <p className="eyebrow">WorkSpace error</p>
        <h1>There was an error</h1>
        <p>{error}</p>
        <button
          className="primary-button"
          onClick={() => window.location.reload()}
        >
          Try again
        </button>
      </section>
    </main>
  );
}
