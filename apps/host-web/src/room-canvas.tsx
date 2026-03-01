import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  connectHostAppBridge,
  createHostAppBridge,
  loadSandboxProxy,
  log,
  type HostAppBridge,
  type HostUiResourceCsp,
  type HostUiResourcePermissions,
} from "./implementation";
import styles from "./index.module.css";
import { onThemeChange, type Theme } from "./theme";
import { DevSidebar } from "./dev-sidebar/dev-sidebar";
import { DEV_SIDEBAR_CONFIG } from "./dev-sidebar/default-config";

interface RoomMount {
  instanceId: string;
  server: string;
  uiResourceUri?: string;
  visible: boolean;
  container: { x: number; y: number; w: number; h: number };
  tools: Array<{
    name: string;
    title?: string;
    description?: string;
    inputSchema: unknown;
    uiResourceUri?: string;
    visibility?: Array<"model" | "app">;
  }>;
}

interface RoomInvocation {
  invocationId: string;
  instanceId: string;
  toolName?: string;
  input: Record<string, unknown>;
  status: "running" | "completed" | "failed";
  result?: unknown;
  error?: string;
}

interface RoomState {
  roomId: string;
  revision: number;
  mounts: RoomMount[];
  order: string[];
  selectedInstanceId: string | null;
  invocations: RoomInvocation[];
}

interface RoomEvent {
  revision: number;
  type: "state-updated" | "snapshot-reset";
  state: RoomState;
}

interface HostConfig {
  roomdUrl: string;
  roomId: string;
}

interface RoomCanvasHostProps {
  config: HostConfig;
}

interface UiResource {
  uiResourceUri: string;
  html: string;
  csp?: HostUiResourceCsp;
  permissions?: HostUiResourcePermissions;
}

export function RoomCanvasHost({ config }: RoomCanvasHostProps) {
  const [state, setState] = useState<RoomState | null>(null);
  const [connectionState, setConnectionState] = useState<
    "loading" | "connected" | "reconnecting"
  >("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let source: EventSource | null = null;

    const connect = async () => {
      setConnectionState("loading");
      setError(null);

      await ensureRoom(config.roomdUrl, config.roomId);
      const snapshot = await fetchRoomState(config.roomdUrl, config.roomId);
      if (disposed) {
        return;
      }

      setState(snapshot);
      setConnectionState("connected");

      const eventsUrl = new URL(
        `/rooms/${encodeURIComponent(config.roomId)}/events`,
        config.roomdUrl,
      );
      eventsUrl.searchParams.set("sinceRevision", String(snapshot.revision));

      source = new EventSource(eventsUrl.toString());

      const onStateEvent = (event: MessageEvent) => {
        try {
          const parsed = JSON.parse(event.data) as RoomEvent;
          setState(parsed.state);
          setConnectionState("connected");
        } catch (parseError) {
          setError(
            parseError instanceof Error
              ? parseError.message
              : String(parseError),
          );
        }
      };

      source.addEventListener("state-updated", onStateEvent);
      source.addEventListener("snapshot-reset", onStateEvent);
      source.onerror = () => {
        setConnectionState("reconnecting");
      };
    };

    connect().catch((connectError) => {
      setError(
        connectError instanceof Error ? connectError.message : String(connectError),
      );
    });

    return () => {
      disposed = true;
      source?.close();
    };
  }, [config.roomId, config.roomdUrl]);

  if (error) {
    return <div className={styles.error}>Room mode error: {error}</div>;
  }

  if (!state) {
    return <div className={styles.roomStatus}>Loading room state...</div>;
  }

  const mountsById = new Map(state.mounts.map((mount) => [mount.instanceId, mount]));
  const orderedMounts = state.order
    .map((instanceId) => mountsById.get(instanceId))
    .filter((mount): mount is RoomMount => !!mount);
  const devSidebarEnabled = isDevSidebarEnabled();

  return (
    <div className={styles.roomHostRoot}>
      <div className={styles.roomStatus}>
        Room <code>{state.roomId}</code> revision <code>{state.revision}</code> status <code>{connectionState}</code>
      </div>
      <div className={styles.roomLayout}>
        <div className={styles.roomCanvasGrid} data-testid="room-canvas">
          {orderedMounts.map((mount) => (
            <div
              key={mount.instanceId}
              data-instance-id={mount.instanceId}
              className={`${styles.roomTile} ${mount.visible ? "" : styles.roomTileHidden}`.trim()}
              style={{
                gridColumn: `${mount.container.x + 1} / span ${mount.container.w}`,
                gridRow: `${mount.container.y + 1} / span ${mount.container.h}`,
              }}
            >
              <div className={styles.roomTileHeader}>
                <span>
                  {mount.instanceId} <strong>{mount.uiResourceUri || "app instance"}</strong>
                </span>
                <span className={styles.roomTileServer}>{mount.server}</span>
              </div>
              <RoomAppInstance
                roomdUrl={config.roomdUrl}
                roomId={state.roomId}
                mount={mount}
                invocation={latestInvocationForInstance(state.invocations, mount)}
              />
            </div>
          ))}
        </div>
        {devSidebarEnabled && (
          <DevSidebar
            roomdUrl={config.roomdUrl}
            roomId={state.roomId}
            mounts={orderedMounts}
            selectedInstanceId={state.selectedInstanceId}
          />
        )}
      </div>
    </div>
  );
}

interface RoomAppInstanceProps {
  roomdUrl: string;
  roomId: string;
  mount: RoomMount;
  invocation?: RoomInvocation;
}

function RoomAppInstance({ roomdUrl, roomId, mount, invocation }: RoomAppInstanceProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const appBridgeRef = useRef<HostAppBridge | null>(null);
  const [bridgeReady, setBridgeReady] = useState(false);
  const [resource, setResource] = useState<UiResource | null>(null);
  const sentInputInvocationRef = useRef<string | null>(null);
  const sentResultInvocationRef = useRef<string | null>(null);
  const themeUnsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let disposed = false;

    const setup = async () => {
      if (!mount.uiResourceUri) {
        setResource(null);
        return;
      }

      const fetched = await fetchUiResource(roomdUrl, roomId, mount.instanceId);
      if (disposed) {
        return;
      }
      setResource(fetched);

      const iframe = iframeRef.current;
      if (!iframe) {
        return;
      }

      const firstLoad = await loadSandboxProxy(iframe, fetched.csp, fetched.permissions);
      if (!firstLoad && appBridgeRef.current) {
        return;
      }

      const capabilities = await fetchCapabilities(roomdUrl, roomId, mount.instanceId);
      if (disposed) {
        return;
      }

      const appBridge = createHostAppBridge({
        hasTools: Boolean(capabilities?.tools),
        hasResources: Boolean(capabilities?.resources),
      });

      appBridge.onmessage = async (params) => {
        log.info("Message from MCP App:", params);
        return {};
      };

      appBridge.onopenlink = async (params) => {
        window.open(params.url, "_blank", "noopener,noreferrer");
        return {};
      };

      appBridge.oncalltool = async (params) => {
        const response = await postJson(
          roomdUrl,
          `/rooms/${encodeURIComponent(roomId)}/instances/${encodeURIComponent(
            mount.instanceId,
          )}/tools/call`,
          params,
        );
        return response as never;
      };

      appBridge.onlistresources = async (params) => {
        const response = await postJson(
          roomdUrl,
          `/rooms/${encodeURIComponent(roomId)}/instances/${encodeURIComponent(
            mount.instanceId,
          )}/resources/list`,
          params,
        );
        return response as never;
      };

      appBridge.onreadresource = async (params) => {
        const response = await postJson(
          roomdUrl,
          `/rooms/${encodeURIComponent(roomId)}/instances/${encodeURIComponent(
            mount.instanceId,
          )}/resources/read`,
          params,
        );
        return response as never;
      };

      appBridge.onlistresourcetemplates = async (params) => {
        const response = await postJson(
          roomdUrl,
          `/rooms/${encodeURIComponent(roomId)}/instances/${encodeURIComponent(
            mount.instanceId,
          )}/resources/templates/list`,
          params,
        );
        return response as never;
      };

      appBridge.onlistprompts = async (params) => {
        const response = await postJson(
          roomdUrl,
          `/rooms/${encodeURIComponent(roomId)}/instances/${encodeURIComponent(
            mount.instanceId,
          )}/prompts/list`,
          params,
        );
        return response as never;
      };

      themeUnsubscribeRef.current = onThemeChange((newTheme: Theme) => {
        appBridge.sendHostContextChange({ theme: newTheme });
      });

      const appInitialized = waitForInitialized(appBridge);

      await connectHostAppBridge(appBridge, iframe);

      await appBridge.sendSandboxResourceReady({
        html: fetched.html,
        csp: fetched.csp,
        permissions: fetched.permissions,
      });

      await appInitialized;
      appBridgeRef.current = appBridge;
      setBridgeReady(true);
    };

    setup().catch((setupError) => {
      log.error("Failed to initialize room app instance", setupError);
    });

    return () => {
      disposed = true;
      setBridgeReady(false);
      if (appBridgeRef.current) {
        appBridgeRef.current.teardownResource({}).catch((error) => {
          log.warn("Teardown failed", error);
        });
        appBridgeRef.current.close();
        appBridgeRef.current = null;
      }
      themeUnsubscribeRef.current?.();
      themeUnsubscribeRef.current = null;
      sentInputInvocationRef.current = null;
      sentResultInvocationRef.current = null;
    };
  }, [mount.instanceId, mount.uiResourceUri, roomId, roomdUrl]);

  useEffect(() => {
    if (!bridgeReady || !appBridgeRef.current || !invocation) {
      return;
    }

    if (sentInputInvocationRef.current !== invocation.invocationId) {
      appBridgeRef.current.sendToolInput({ arguments: invocation.input });
      sentInputInvocationRef.current = invocation.invocationId;
      sentResultInvocationRef.current = null;
    }

    if (
      invocation.status === "completed" &&
      sentResultInvocationRef.current !== invocation.invocationId
    ) {
      appBridgeRef.current.sendToolResult(invocation.result as never);
      sentResultInvocationRef.current = invocation.invocationId;
    }

    if (
      invocation.status === "failed" &&
      sentResultInvocationRef.current !== invocation.invocationId
    ) {
      appBridgeRef.current.sendToolCancelled({ reason: invocation.error ?? "Unknown error" });
      sentResultInvocationRef.current = invocation.invocationId;
    }
  }, [bridgeReady, invocation]);

  const resourceHint = useMemo(() => {
    if (!resource?.uiResourceUri) {
      return "";
    }
    return resource.uiResourceUri;
  }, [resource?.uiResourceUri]);

  return (
    <div className={styles.roomAppPanel}>
      {!mount.uiResourceUri ? (
        <div className={styles.roomStatus} data-testid={`instance-${mount.instanceId}-no-ui`}>
          No UI resource mounted for this instance.
        </div>
      ) : (
        <iframe ref={iframeRef} title={mount.instanceId} data-testid={`instance-${mount.instanceId}`} />
      )}
      {resourceHint && <div className={styles.roomResourceHint}>{resourceHint}</div>}
    </div>
  );
}

async function waitForInitialized(appBridge: HostAppBridge): Promise<void> {
  const original = appBridge.oninitialized;
  return new Promise<void>((resolve) => {
    appBridge.oninitialized = (...args) => {
      resolve();
      appBridge.oninitialized = original;
      appBridge.oninitialized?.(...args);
    };
  });
}

function latestInvocationForInstance(
  invocations: RoomInvocation[],
  mount: RoomMount,
): RoomInvocation | undefined {
  const isAppOnlyTool = (toolName?: string): boolean => {
    if (!toolName) {
      return false;
    }
    const tool = mount.tools.find((candidate) => candidate.name === toolName);
    if (!tool?.visibility || tool.visibility.length === 0) {
      return false;
    }
    return !tool.visibility.includes("model");
  };

  for (let i = invocations.length - 1; i >= 0; i--) {
    if (invocations[i].instanceId !== mount.instanceId) {
      continue;
    }
    if (isAppOnlyTool(invocations[i].toolName)) {
      continue;
    }
    if (invocations[i].instanceId === mount.instanceId) {
      return invocations[i];
    }
  }
  return undefined;
}

async function ensureRoom(roomdUrl: string, roomId: string): Promise<void> {
  const response = await fetch(new URL("/rooms", roomdUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ roomId }),
  });

  if (response.status === 201 || response.status === 409) {
    return;
  }

  const message = await readErrorMessage(response);
  throw new Error(message);
}

async function fetchRoomState(roomdUrl: string, roomId: string): Promise<RoomState> {
  const response = await fetch(
    new URL(`/rooms/${encodeURIComponent(roomId)}/state`, roomdUrl),
  );
  if (!response.ok) {
    const message = await readErrorMessage(response);
    throw new Error(message);
  }

  const data = (await response.json()) as { state: RoomState };
  return data.state;
}

async function fetchUiResource(
  roomdUrl: string,
  roomId: string,
  instanceId: string,
): Promise<UiResource> {
  const response = await fetch(
    new URL(
      `/rooms/${encodeURIComponent(roomId)}/instances/${encodeURIComponent(instanceId)}/ui`,
      roomdUrl,
    ),
  );
  if (!response.ok) {
    const message = await readErrorMessage(response);
    throw new Error(message);
  }

  const data = (await response.json()) as { resource: UiResource };
  return data.resource;
}

async function fetchCapabilities(
  roomdUrl: string,
  roomId: string,
  instanceId: string,
): Promise<Record<string, unknown> | null> {
  const response = await fetch(
    new URL(
      `/rooms/${encodeURIComponent(roomId)}/instances/${encodeURIComponent(instanceId)}/capabilities`,
      roomdUrl,
    ),
  );

  if (!response.ok) {
    return null;
  }

  const data = (await response.json()) as { capabilities: Record<string, unknown> };
  return data.capabilities;
}

async function postJson(
  baseUrl: string,
  path: string,
  body: unknown,
): Promise<unknown> {
  const response = await fetch(new URL(path, baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const message = await readErrorMessage(response);
    throw new Error(message);
  }

  return response.json();
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    if (body?.error) {
      return body.error;
    }
  } catch {
    // Ignore JSON parse errors for fallback message.
  }

  return `${response.status} ${response.statusText}`;
}

function isDevSidebarEnabled(): boolean {
  if (!DEV_SIDEBAR_CONFIG.features.visible) {
    return false;
  }

  if (typeof window === "undefined") {
    return false;
  }

  const params = new URLSearchParams(window.location.search);
  const value = (params.get("devSidebar") ?? "").trim().toLowerCase();
  if (value === "0" || value === "false" || value === "off") {
    return false;
  }

  return true;
}
