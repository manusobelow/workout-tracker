import React from "react";

type Props = { children: React.ReactNode };

type State = {
  hasError: boolean;
  errorMsg: string;
  stack: string;
};

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, errorMsg: "", stack: "" };
  }

  static getDerivedStateFromError(err: unknown) {
    const e = err as any;
    return {
      hasError: true,
      errorMsg: String(e?.message || e || "Unknown error"),
      stack: String(e?.stack || ""),
    };
  }

  componentDidCatch(err: unknown) {
    console.error("ErrorBoundary caught:", err);
  }

  private reload = () => window.location.reload();

  private clearAndReload = () => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {}
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div
        style={{
          minHeight: "100vh",
          padding: 18,
          background: "#111",
          color: "#f2f2f2",
          fontFamily: "system-ui, Segoe UI, Arial",
        }}
      >
        <h2 style={{ margin: "0 0 10px 0" }}>App crashed</h2>

        <div
          style={{
            background: "#2a1414",
            border: "1px solid #4a2222",
            borderRadius: 14,
            padding: 12,
            marginBottom: 12,
          }}
        >
          <div style={{ fontWeight: 900, marginBottom: 6 }}>Error</div>
          <div style={{ whiteSpace: "pre-wrap" }}>{this.state.errorMsg}</div>

          {this.state.stack ? (
            <>
              <div style={{ fontWeight: 900, marginTop: 10, marginBottom: 6 }}>Stack</div>
              <pre style={{ margin: 0, whiteSpace: "pre-wrap", color: "#ffb3b3" }}>
                {this.state.stack}
              </pre>
            </>
          ) : null}
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            onClick={this.reload}
            style={{
              background: "#222",
              color: "#f2f2f2",
              border: "1px solid #333",
              borderRadius: 999,
              padding: "10px 14px",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Reload
          </button>

          <button
            onClick={this.clearAndReload}
            style={{
              background: "#222",
              color: "#f2f2f2",
              border: "1px solid #333",
              borderRadius: 999,
              padding: "10px 14px",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            Clear storage + Reload
          </button>
        </div>
      </div>
    );
  }
}

// Export BOTH ways so imports never drift:
export default ErrorBoundary;
