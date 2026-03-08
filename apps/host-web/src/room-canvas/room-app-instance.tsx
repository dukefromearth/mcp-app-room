import { useEffect, useRef, useState } from "react";
import {
  loadSandboxProxy,
  log,
  type HostAppBridge,
} from "../implementation";
import styles from "../index.module.css";
import {
  connectRoomAppBridge,
  newRoomAppBridge,
  wireBridgeHandlers,
} from "./bridge-wiring";
import type { RoomInvocation, RoomMount, UiResource } from "./contracts";
import type { RoomdClient } from "./roomd-client";

interface RoomAppInstanceProps {
  roomId: string;
  mount: RoomMount;
  invocation?: RoomInvocation;
  roomdClient: RoomdClient;
}

export function RoomAppInstance({
  roomId,
  mount,
  invocation,
  roomdClient,
}: RoomAppInstanceProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const appBridgeRef = useRef<HostAppBridge | null>(null);
  const themeUnsubscribeRef = useRef<(() => void) | null>(null);
  const sentInputInvocationRef = useRef<string | null>(null);
  const sentResultInvocationRef = useRef<string | null>(null);
  const setupGenerationRef = useRef(0);
  const [bridgeReady, setBridgeReady] = useState(false);
  const [resource, setResource] = useState<UiResource | null>(null);

  useEffect(() => {
    const generation = ++setupGenerationRef.current;
    let disposed = false;
    const sessionId = globalThis.crypto?.randomUUID?.() ?? `session-${Date.now()}-${generation}`;
    const reportedPhases = new Set<
      "bridge_connected" | "resource_delivered" | "app_initialized" | "app_error"
    >();
    let seq = 1;

    const isCurrentGeneration = () =>
      !disposed && setupGenerationRef.current === generation;

    const reportPhase = async (
      phase: "bridge_connected" | "resource_delivered" | "app_initialized" | "app_error",
      details?: Record<string, unknown>,
    ) => {
      if (!isCurrentGeneration() || reportedPhases.has(phase)) {
        return;
      }
      try {
        await roomdClient.reportInstanceLifecycle(
          roomId,
          mount.instanceId,
          {
            mountNonce: mount.mountNonce,
            sessionId,
            seq,
            phase,
            ...(details ? { details } : {}),
          },
        );
        reportedPhases.add(phase);
        seq += 1;
      } catch (error) {
        // GOTCHA: lifecycle reporting must never block app bootstrap.
        log.warn("Failed to report instance lifecycle phase", error);
      }
    };

    const setup = async () => {
      if (!mount.uiResourceUri) {
        setResource(null);
        return;
      }
      const fetched = await roomdClient.fetchUiResource(roomId, mount.instanceId);
      if (!isCurrentGeneration()) {
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
      const capabilities = await roomdClient.fetchCapabilities(roomId, mount.instanceId);
      if (!isCurrentGeneration()) {
        return;
      }
      const appBridge = newRoomAppBridge(capabilities);
      themeUnsubscribeRef.current = wireBridgeHandlers({
        appBridge,
        roomdClient,
        roomId,
        instanceId: mount.instanceId,
      });
      appBridge.oninitialized = () => {
        void reportPhase("app_initialized");
      };

      // GOTCHA: The bridge must be connected before resource-ready, but we
      // cannot wait for app initialization first because initialization depends
      // on receiving this resource payload.
      await connectRoomAppBridge(appBridge, iframe);
      await reportPhase("bridge_connected");
      if (!isCurrentGeneration()) {
        return;
      }
      await appBridge.sendSandboxResourceReady({
        html: fetched.html,
        csp: fetched.csp,
        permissions: fetched.permissions,
      });
      await reportPhase("resource_delivered", {
        uiResourceUri: fetched.uiResourceUri,
      });
      if (!isCurrentGeneration()) {
        return;
      }
      appBridgeRef.current = appBridge;
      setBridgeReady(true);
    };

    setup().catch((setupError) => {
      log.error("Failed to initialize room app instance", setupError);
      void reportPhase("app_error", {
        message:
          setupError instanceof Error ? setupError.message : String(setupError),
      });
    });

    return () => {
      disposed = true;
      setBridgeReady(false);
      const appBridge = appBridgeRef.current;
      if (appBridge) {
        appBridge.teardownResource({}).catch((error) => {
          log.warn("Teardown failed", error);
        });
        appBridge.close();
        appBridgeRef.current = null;
      }
      themeUnsubscribeRef.current?.();
      themeUnsubscribeRef.current = null;
      sentInputInvocationRef.current = null;
      sentResultInvocationRef.current = null;
    };
  }, [mount.instanceId, mount.mountNonce, mount.uiResourceUri, roomId, roomdClient]);

  useEffect(() => {
    if (!bridgeReady || !appBridgeRef.current || !invocation) {
      return;
    }
    const appBridge = appBridgeRef.current;
    if (sentInputInvocationRef.current !== invocation.invocationId) {
      appBridge.sendToolInput({ arguments: invocation.input });
      sentInputInvocationRef.current = invocation.invocationId;
      sentResultInvocationRef.current = null;
    }
    const invocationNotSent = sentResultInvocationRef.current !== invocation.invocationId;
    if (invocation.status === "completed" && invocationNotSent) {
      appBridge.sendToolResult(invocation.result as never);
      sentResultInvocationRef.current = invocation.invocationId;
    }
    if (invocation.status === "failed" && invocationNotSent) {
      appBridge.sendToolCancelled({ reason: invocation.error ?? "Unknown error" });
      sentResultInvocationRef.current = invocation.invocationId;
    }
  }, [bridgeReady, invocation]);
  const resourceHint = resource?.uiResourceUri;

  return (
    <div className={styles.roomAppPanel}>
      {!mount.uiResourceUri ? (
        <div className={styles.roomStatus} data-testid={`instance-${mount.instanceId}-no-ui`}>
          No UI resource mounted for this instance.
        </div>
      ) : (
        <iframe ref={iframeRef} title={mount.instanceId} data-testid={`instance-${mount.instanceId}`} />
      )}
      {resourceHint ? <div className={styles.roomResourceHint}>{resourceHint}</div> : null}
    </div>
  );
}
