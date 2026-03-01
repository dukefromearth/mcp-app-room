import {
  connectHostAppBridge,
  createHostAppBridge,
  log,
  type HostAppBridge,
} from "../implementation";
import { onThemeChange, type Theme } from "../theme";
import type { RoomdClient } from "./roomd-client";

interface BridgeSetupOptions {
  appBridge: HostAppBridge;
  roomdClient: RoomdClient;
  roomId: string;
  instanceId: string;
}

export function wireBridgeHandlers({
  appBridge,
  roomdClient,
  roomId,
  instanceId,
}: BridgeSetupOptions): () => void {
  appBridge.onmessage = async (params) => {
    log.info("Message from MCP App:", params);
    return {};
  };

  appBridge.onopenlink = async (params) => {
    window.open(params.url, "_blank", "noopener,noreferrer");
    return {};
  };

  appBridge.oncalltool = async (params) => {
    return roomdClient.postInstanceJson(roomId, instanceId, "tools/call", params) as never;
  };

  appBridge.onlistresources = async (params) => {
    return roomdClient.postInstanceJson(
      roomId,
      instanceId,
      "resources/list",
      params,
    ) as never;
  };

  appBridge.onreadresource = async (params) => {
    return roomdClient.postInstanceJson(
      roomId,
      instanceId,
      "resources/read",
      params,
    ) as never;
  };

  appBridge.onlistresourcetemplates = async (params) => {
    return roomdClient.postInstanceJson(
      roomId,
      instanceId,
      "resources/templates/list",
      params,
    ) as never;
  };

  appBridge.onlistprompts = async (params) => {
    return roomdClient.postInstanceJson(roomId, instanceId, "prompts/list", params) as never;
  };

  const unsubscribeTheme = onThemeChange((newTheme: Theme) => {
    appBridge.sendHostContextChange({ theme: newTheme });
  });

  return unsubscribeTheme;
}

export async function connectRoomAppBridge(
  appBridge: HostAppBridge,
  iframe: HTMLIFrameElement,
): Promise<void> {
  const initialized = waitForInitialized(appBridge);
  await connectHostAppBridge(appBridge, iframe);
  await initialized;
}

export function newRoomAppBridge(
  capabilities: Record<string, unknown> | null,
): HostAppBridge {
  return createHostAppBridge({
    hasTools: Boolean(capabilities?.tools),
    hasResources: Boolean(capabilities?.resources),
  });
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
