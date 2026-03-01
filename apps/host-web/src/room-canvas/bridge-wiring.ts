import { connectHostAppBridge, createHostAppBridge, log, type HostAppBridge } from "../implementation";
import { onThemeChange, type Theme } from "../theme";
import type { RoomdClient } from "./roomd-client";

interface BridgeSetupOptions { appBridge: HostAppBridge; roomdClient: RoomdClient; roomId: string; instanceId: string }

export function wireBridgeHandlers({
  appBridge,
  roomdClient,
  roomId,
  instanceId,
}: BridgeSetupOptions): () => void {
  const postJson = (pathSuffix: string) => async (params: unknown): Promise<never> =>
    roomdClient.postInstanceJson(roomId, instanceId, pathSuffix, params) as never;

  appBridge.onmessage = async (params) => {
    log.info("Message from MCP App:", params);
    return {};
  };
  appBridge.onopenlink = async (params) => {
    window.open(params.url, "_blank", "noopener,noreferrer");
    return {};
  };
  appBridge.oncalltool = postJson("tools/call");
  appBridge.onlistresources = postJson("resources/list");
  appBridge.onreadresource = postJson("resources/read");
  appBridge.onlistresourcetemplates = postJson("resources/templates/list");
  appBridge.onlistprompts = postJson("prompts/list");
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
  return new Promise<void>((resolve) => {
    const original = appBridge.oninitialized;
    appBridge.oninitialized = (...args) => {
      appBridge.oninitialized = original;
      appBridge.oninitialized?.(...args);
      resolve();
    };
  });
}
