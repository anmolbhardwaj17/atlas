"use client";

/**
 * Top-level error boundary (docs/09 §7). Replaces the root layout when an uncaught error
 * bubbles up, so it must render its own <html>/<body>. Keeps the mono aesthetic and offers
 * a recovery action. Also lets Next generate the error page via the app router (avoids the
 * pages-router `_error`/`_document` prerender path).
 */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <main
          style={{
            minHeight: "100dvh",
            display: "grid",
            placeItems: "center",
            padding: "1.5rem",
            textAlign: "center",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <div style={{ maxWidth: "28rem" }}>
            <h1 style={{ fontSize: "1.5rem", fontWeight: 600 }}>Something went wrong</h1>
            <p style={{ marginTop: "0.5rem", fontSize: "0.875rem", color: "#666" }}>
              An unexpected error occurred. You can try again - if it persists, please reload.
            </p>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                marginTop: "1.5rem",
                height: "2.25rem",
                padding: "0 1rem",
                borderRadius: "0.375rem",
                background: "#111",
                color: "#fff",
                fontSize: "0.875rem",
                fontWeight: 500,
                border: "none",
                cursor: "pointer",
              }}
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
