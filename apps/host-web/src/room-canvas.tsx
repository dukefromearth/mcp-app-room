import { useEffect, useMemo, useState } from "react";
import styles from "./index.module.css";
import { DevSidebar } from "./dev-sidebar/dev-sidebar";
import { DEV_SIDEBAR_CONFIG } from "./dev-sidebar/default-config";
import type { HostConfig, RoomMount, RoomState } from "./room-canvas/contracts";
import { latestInvocationForInstance } from "./room-canvas/invocations";
import { RoomAppInstance } from "./room-canvas/room-app-instance";
import { subscribeToRoomEvents } from "./room-canvas/room-events";
import { createRoomdClient } from "./room-canvas/roomd-client";

interface RoomCanvasHostProps {
  config: HostConfig;
}

export function RoomCanvasHost({ config }: RoomCanvasHostProps) {
  const roomdClient = useMemo(
    () => createRoomdClient(config.roomdUrl),
    [config.roomdUrl],
  );
  const [state, setState] = useState<RoomState | null>(null);
  const [connectionState, setConnectionState] = useState<
    "loading" | "connected" | "reconnecting"
  >("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | null = null;

    setConnectionState("loading");
    setError(null);

    subscribeToRoomEvents(
      roomdClient,
      config.roomId,
      {
        roomConfigId: config.roomConfigId,
        roomConfigNamespace: config.roomConfigNamespace,
      },
      {
        onSnapshot(snapshot) {
          if (disposed) {
            return;
          }
          setState(snapshot);
          setConnectionState("connected");
        },
        onEvent(nextState) {
          if (disposed) {
            return;
          }
          setState(nextState);
          setConnectionState("connected");
        },
        onError(message) {
          if (disposed) {
            return;
          }
          setError(message);
        },
        onReconnect() {
          if (disposed) {
            return;
          }
          setConnectionState("reconnecting");
        },
      },
    )
      .then((cleanup) => {
        if (disposed) {
          cleanup();
          return;
        }
        unsubscribe = cleanup;
      })
      .catch((connectError) => {
        if (disposed) {
          return;
        }
        setError(
          connectError instanceof Error ? connectError.message : String(connectError),
        );
      });

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [config.roomId, roomdClient]);

  if (error) {
    return <div className={styles.error}>Room mode error: {error}</div>;
  }

  if (!state) {
    return <div className={styles.roomStatus}>Loading room state...</div>;
  }

  const orderedMounts = orderMounts(state);
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
                roomdClient={roomdClient}
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

function orderMounts(state: RoomState): RoomMount[] {
  const mountsById = new Map(state.mounts.map((mount) => [mount.instanceId, mount]));
  return state.order
    .map((instanceId) => mountsById.get(instanceId))
    .filter((mount): mount is RoomMount => !!mount);
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
