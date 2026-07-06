import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch(() => {});
  });
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, componentStack: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error("Syndicate crashed:", error, info);
    this.setState({ componentStack: info.componentStack });
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: "100dvh", display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "flex-start", padding: 24, paddingTop: 60,
          fontFamily: "system-ui, sans-serif", background: "#F7F2E7", color: "#10201D",
          textAlign: "center", overflowY: "auto",
        }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
          <h1 style={{ fontSize: 18, marginBottom: 8 }}>Something went wrong</h1>
          <p style={{ fontSize: 13, color: "#6B7A76", marginBottom: 20, maxWidth: 320 }}>
            {this.state.error.message || "An unexpected error occurred."}
          </p>
          <button
            onClick={() => { window.location.hash = ""; window.location.reload(); }}
            style={{
              background: "#2F6F5E", color: "#fff", border: "none", borderRadius: 10,
              padding: "12px 24px", fontSize: 14, fontWeight: 600, cursor: "pointer",
              marginBottom: 24,
            }}
          >
            Go to home screen
          </button>
          {this.state.componentStack && (
            <pre style={{
              fontSize: 10, textAlign: "left", background: "#fff", padding: 12,
              borderRadius: 8, maxWidth: "100%", overflowX: "auto", color: "#8A6A15",
              whiteSpace: "pre-wrap", wordBreak: "break-word",
            }}>
              {this.state.componentStack.trim()}
            </pre>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
