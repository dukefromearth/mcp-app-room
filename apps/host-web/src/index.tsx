import {
  Component,
  type ErrorInfo,
  type ReactNode,
  StrictMode,
  Suspense,
  use,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { RoomCanvasHost } from "./room-canvas";
import { getTheme, onThemeChange, toggleTheme, type Theme } from "./theme";
import styles from "./index.module.css";

interface HostConfig {
  roomdUrl: string;
  roomId: string;
}

function getQueryParams() {
  const params = new URLSearchParams(window.location.search);
  const debug = params.get("debug");
  return {
    debugMode: debug === "1" || debug === "true",
    roomd: params.get("roomd"),
    room: params.get("room"),
    hideThemeToggle: params.get("theme") === "hide",
  };
}

async function fetchHostConfig(): Promise<HostConfig> {
  const response = await fetch("/api/host-config");
  if (!response.ok) {
    throw new Error(`Failed to load host config (${response.status})`);
  }

  const data = (await response.json()) as Partial<HostConfig>;
  if (typeof data.roomdUrl !== "string" || data.roomdUrl.trim().length === 0) {
    throw new Error("host config is missing roomdUrl");
  }
  if (typeof data.roomId !== "string" || data.roomId.trim().length === 0) {
    throw new Error("host config is missing roomId");
  }

  return {
    roomdUrl: data.roomdUrl,
    roomId: data.roomId,
  };
}

function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(getTheme);

  useEffect(() => {
    return onThemeChange(setTheme);
  }, []);

  return (
    <button
      className={styles.themeToggle}
      onClick={() => toggleTheme()}
      title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
    >
      {theme === "dark" ? "☀️" : "🌙"}
    </button>
  );
}

interface HostEntryProps {
  hostConfigPromise: Promise<HostConfig>;
}

function HostEntry({ hostConfigPromise }: HostEntryProps) {
  const queryParams = useMemo(() => getQueryParams(), []);
  const hostConfig = use(hostConfigPromise);

  // GOTCHA: room/roomd query overrides are intentionally gated behind debug mode.
  // Without `debug=1`, runtime routing always follows /api/host-config values.
  const roomdUrl = queryParams.debugMode
    ? queryParams.roomd ?? hostConfig.roomdUrl
    : hostConfig.roomdUrl;
  const roomId = queryParams.debugMode
    ? queryParams.room ?? hostConfig.roomId
    : hostConfig.roomId;

  if (!roomdUrl) {
    return (
      <div className={styles.error}>
        <strong>ERROR:</strong> room mode requires <code>ROOMD_URL</code>.
      </div>
    );
  }

  return (
    <>
      {!queryParams.hideThemeToggle && <ThemeToggle />}
      <RoomCanvasHost config={{ roomdUrl, roomId }} />
    </>
  );
}

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: unknown;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: undefined };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo): void {
    console.error("[HOST] Caught:", error, errorInfo.componentStack);
  }

  render(): ReactNode {
    if (this.state.hasError) {
      const message =
        this.state.error instanceof Error
          ? this.state.error.message
          : String(this.state.error);
      return (
        <div className={styles.error}>
          <strong>ERROR:</strong> {message}
        </div>
      );
    }

    return this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <Suspense fallback="Loading host...">
        <HostEntry hostConfigPromise={fetchHostConfig()} />
      </Suspense>
    </ErrorBoundary>
  </StrictMode>,
);
