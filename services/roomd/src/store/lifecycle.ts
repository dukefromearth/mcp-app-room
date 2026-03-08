import { HttpError } from "../errors";
import { stableStringify } from "../hash";
import type { LifecyclePhase, RoomLifecycle, RoomMount, RoomState } from "../types";

export interface RoomLifecycleRuntime {
  instanceId: string;
  mountNonce: string;
  sessionId: string;
  phase: LifecyclePhase;
  seq: number;
  updatedAt: string;
  lastError?: string;
  detailsHash?: string;
}

interface LifecyclePayload {
  instanceId: string;
  mountNonce: string;
  sessionId: string;
  seq: number;
  phase: LifecyclePhase;
  details?: Record<string, unknown>;
}

export function createMountNonce(instanceId: string, counter: number): string {
  return `mnt-${Date.now()}-${counter}-${instanceId}`;
}

export function transitionLifecycle(
  existing: RoomLifecycleRuntime | undefined,
  payload: LifecyclePayload,
  options: {
    knownSessionIds?: ReadonlySet<string>;
  } = {},
): {
  accepted: "applied" | "duplicate";
  next: RoomLifecycleRuntime;
} {
  if (!existing) {
    assertInitialLifecyclePhase(payload.instanceId, payload.phase, payload.seq);
    return {
      accepted: "applied",
      next: makeLifecycleState(payload),
    };
  }

  if (existing.sessionId !== payload.sessionId) {
    if (options.knownSessionIds?.has(payload.sessionId)) {
      throw new HttpError(
        409,
        "LIFECYCLE_STALE_SESSION",
        `Lifecycle session is stale for instance ${payload.instanceId}`,
        {
          details: {
            expectedSessionId: existing.sessionId,
            receivedSessionId: payload.sessionId,
          },
          hint: "Refresh room state and resume lifecycle with the active session.",
        },
      );
    }

    if (payload.seq !== 1) {
      throw new HttpError(
        409,
        "LIFECYCLE_STALE_SESSION",
        `Lifecycle session is stale for instance ${payload.instanceId}`,
        {
          details: {
            expectedSessionId: existing.sessionId,
            receivedSessionId: payload.sessionId,
            expectedSeq: 1,
            receivedSeq: payload.seq,
          },
          hint: "Start a new lifecycle session from seq=1 after reconnect/remount.",
        },
      );
    }

    assertInitialLifecyclePhase(payload.instanceId, payload.phase, payload.seq);
    return {
      accepted: "applied",
      next: makeLifecycleState(payload),
    };
  }

  if (payload.seq === existing.seq) {
    const incomingHash = stableStringify({
      phase: payload.phase,
      details: payload.details ?? null,
    });

    if (existing.phase === payload.phase && existing.detailsHash === incomingHash) {
      return {
        accepted: "duplicate",
        next: existing,
      };
    }

    throw new HttpError(
      409,
      "LIFECYCLE_SEQ_CONFLICT",
      `Lifecycle seq conflict for instance ${payload.instanceId}`,
      {
        details: {
          instanceId: payload.instanceId,
          sessionId: payload.sessionId,
          seq: payload.seq,
          previousPhase: existing.phase,
          receivedPhase: payload.phase,
        },
        hint: "Retry with the next sequence value and stable payload per sequence number.",
      },
    );
  }

  const expectedSeq = existing.seq + 1;
  if (payload.seq !== expectedSeq) {
    throw new HttpError(
      409,
      "LIFECYCLE_SEQ_OUT_OF_ORDER",
      `Lifecycle seq out of order for instance ${payload.instanceId}`,
      {
        details: {
          instanceId: payload.instanceId,
          sessionId: payload.sessionId,
          expectedSeq,
          receivedSeq: payload.seq,
        },
        hint: "Use strict contiguous sequencing (+1) within a lifecycle session.",
      },
    );
  }

  assertLifecycleTransition(payload.instanceId, existing.phase, payload.phase);
  return {
    accepted: "applied",
    next: makeLifecycleState(payload),
  };
}

export function buildLifecycle(
  mounts: RoomMount[],
  lifecycleByInstance: Map<string, RoomLifecycleRuntime>,
): RoomLifecycle {
  const instances = mounts
    .map((mount) => lifecycleByInstance.get(mount.instanceId))
    .filter((entry): entry is RoomLifecycleRuntime => !!entry)
    .map((entry) => ({
      instanceId: entry.instanceId,
      mountNonce: entry.mountNonce,
      sessionId: entry.sessionId,
      phase: entry.phase,
      seq: entry.seq,
      updatedAt: entry.updatedAt,
      ...(entry.lastError ? { lastError: entry.lastError } : {}),
    }));
  return { instances };
}

export function buildAssuranceFromLifecycle(
  mounts: RoomMount[],
  lifecycle: RoomLifecycle,
): RoomState["assurance"] {
  const lifecycleByInstance = new Map(
    lifecycle.instances.map((entry) => [entry.instanceId, entry] as const),
  );

  const instances = mounts.map((mount) => {
    const item = lifecycleByInstance.get(mount.instanceId);
    const hasBridge = item
      ? item.phase === "bridge_connected"
        || item.phase === "resource_delivered"
        || item.phase === "app_initialized"
        || (item.phase === "app_error" && item.seq >= 2)
      : false;
    const hasResource = item
      ? item.phase === "resource_delivered"
        || item.phase === "app_initialized"
        || (item.phase === "app_error" && item.seq >= 3)
      : false;
    const hasInitialized = item
      ? item.phase === "app_initialized"
        || (item.phase === "app_error" && item.seq >= 4)
      : false;
    const hasAppError = item?.phase === "app_error";

    let level: RoomState["assurance"]["instances"][number]["level"] = "control_plane_ok";
    if (hasBridge) {
      level = "ui_bridge_connected";
    }
    if (hasResource) {
      level = "ui_resource_delivered";
    }
    if (hasInitialized) {
      level = "ui_app_initialized";
    }

    const proven = ["Control-plane mount exists and is addressable."];
    if (hasBridge) {
      proven.push("Host bridge connected to sandbox transport.");
    }
    if (hasResource) {
      proven.push("Host delivered UI resource payload to sandbox.");
    }
    if (hasInitialized) {
      proven.push("App signaled initialization through protocol callback.");
    }

    const unknown: string[] = [];
    if (!hasInitialized) {
      unknown.push("User-visible render completeness is unknown.");
    }
    if (hasAppError) {
      unknown.push("App reported a runtime error; current visible state may differ.");
    }

    return {
      instanceId: mount.instanceId,
      level,
      proven,
      unknown,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    instances,
  };
}

function makeLifecycleState(payload: LifecyclePayload): RoomLifecycleRuntime {
  const lastError = payload.phase === "app_error"
    ? extractLifecycleError(payload.details)
    : undefined;

  return {
    instanceId: payload.instanceId,
    mountNonce: payload.mountNonce,
    sessionId: payload.sessionId,
    seq: payload.seq,
    phase: payload.phase,
    updatedAt: new Date().toISOString(),
    ...(lastError ? { lastError } : {}),
    detailsHash: stableStringify({
      phase: payload.phase,
      details: payload.details ?? null,
    }),
  };
}

function extractLifecycleError(details?: Record<string, unknown>): string | undefined {
  const message = details?.message;
  if (typeof message === "string" && message.trim().length > 0) {
    return message.trim();
  }
  return "App reported lifecycle error";
}

function assertInitialLifecyclePhase(
  instanceId: string,
  phase: LifecyclePhase,
  seq: number,
): void {
  if (seq !== 1) {
    throw new HttpError(
      409,
      "LIFECYCLE_SEQ_OUT_OF_ORDER",
      `Initial lifecycle event must start with seq=1 for ${instanceId}`,
      {
        details: {
          expectedSeq: 1,
          receivedSeq: seq,
        },
      },
    );
  }

  if (phase === "bridge_connected" || phase === "app_error") {
    return;
  }

  throw new HttpError(
    409,
    "LIFECYCLE_INVALID_TRANSITION",
    `Invalid initial lifecycle phase for ${instanceId}`,
    {
      details: {
        fromPhase: null,
        toPhase: phase,
      },
      hint: "Initial phase must be bridge_connected (or app_error for early failure).",
    },
  );
}

function assertLifecycleTransition(
  instanceId: string,
  fromPhase: LifecyclePhase,
  toPhase: LifecyclePhase,
): void {
  if (toPhase === "app_error") {
    if (fromPhase === "app_error") {
      throw new HttpError(
        409,
        "LIFECYCLE_INVALID_TRANSITION",
        `Lifecycle for ${instanceId} is already terminal in app_error`,
        {
          details: {
            fromPhase,
            toPhase,
          },
        },
      );
    }
    return;
  }

  const legal = (
    (fromPhase === "bridge_connected" && toPhase === "resource_delivered")
    || (fromPhase === "resource_delivered" && toPhase === "app_initialized")
  );
  if (legal) {
    return;
  }

  throw new HttpError(
    409,
    "LIFECYCLE_INVALID_TRANSITION",
    `Invalid lifecycle transition for ${instanceId}: ${fromPhase} -> ${toPhase}`,
    {
      details: {
        fromPhase,
        toPhase,
      },
    },
  );
}
