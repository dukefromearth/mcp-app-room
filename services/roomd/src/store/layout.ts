import { HttpError } from "../errors";
import type { GridContainer, LayoutAdapterName, LayoutOp } from "../types";

interface LayoutUpdateInput {
  adapterName: LayoutAdapterName | undefined;
  ops: LayoutOp[];
  order: string[];
  containers: Map<string, GridContainer>;
}

interface LayoutUpdateResult {
  nextContainers: Map<string, GridContainer>;
  nextOrder: string[];
  changed: boolean;
}

export function computeLayoutUpdate(input: LayoutUpdateInput): LayoutUpdateResult {
  if (input.ops.length === 0) {
    throw new HttpError(
      400,
      "INVALID_COMMAND",
      "Layout command must include at least one operation",
    );
  }

  const normalize = resolveLayoutAdapter(input.adapterName);
  const nextContainers = new Map<string, GridContainer>();
  for (const [instanceId, container] of input.containers.entries()) {
    nextContainers.set(instanceId, normalize(container));
  }
  let nextOrder = [...input.order];

  for (const op of input.ops) {
    switch (op.op) {
      case "set": {
        assertMountedInstance(nextContainers, op.instanceId);
        nextContainers.set(op.instanceId, normalize(op.container));
        break;
      }
      case "move": {
        const current = requireLayoutContainer(nextContainers, op.instanceId);
        nextContainers.set(
          op.instanceId,
          normalize({
            ...current,
            x: current.x + op.dx,
            y: current.y + op.dy,
          }),
        );
        break;
      }
      case "resize": {
        const current = requireLayoutContainer(nextContainers, op.instanceId);
        nextContainers.set(
          op.instanceId,
          normalize({
            ...current,
            w: current.w + op.dw,
            h: current.h + op.dh,
          }),
        );
        break;
      }
      case "swap": {
        if (op.first === op.second) {
          throw new HttpError(
            400,
            "INVALID_COMMAND",
            "Layout swap requires two distinct instance IDs",
          );
        }
        const first = requireLayoutContainer(nextContainers, op.first);
        const second = requireLayoutContainer(nextContainers, op.second);
        nextContainers.set(op.first, normalize(second));
        nextContainers.set(op.second, normalize(first));
        break;
      }
      case "bring-to-front": {
        assertMountedInstance(nextContainers, op.instanceId);
        nextOrder = moveToEnd(nextOrder, op.instanceId);
        break;
      }
      case "send-to-back": {
        assertMountedInstance(nextContainers, op.instanceId);
        nextOrder = moveToStart(nextOrder, op.instanceId);
        break;
      }
      case "align": {
        const instanceIds = resolveLayoutInstanceIds(
          nextContainers,
          input.order,
          op.instanceIds,
        );
        for (const instanceId of instanceIds) {
          const current = requireLayoutContainer(nextContainers, instanceId);
          nextContainers.set(
            instanceId,
            normalize({
              ...current,
              [op.axis]: op.value,
            }),
          );
        }
        break;
      }
      case "distribute": {
        const instanceIds = resolveLayoutInstanceIds(
          nextContainers,
          input.order,
          op.instanceIds,
        );
        if (instanceIds.length < 2) {
          break;
        }
        const gap = op.gap ?? 0;
        const sorted = [...instanceIds].sort((a, b) => {
          const first = requireLayoutContainer(nextContainers, a);
          const second = requireLayoutContainer(nextContainers, b);
          return first[op.axis] - second[op.axis];
        });
        let cursor = requireLayoutContainer(nextContainers, sorted[0])[op.axis];
        for (const instanceId of sorted) {
          const current = requireLayoutContainer(nextContainers, instanceId);
          const updated = normalize({
            ...current,
            [op.axis]: cursor,
          });
          nextContainers.set(instanceId, updated);
          const size = op.axis === "x" ? updated.w : updated.h;
          cursor += size + gap;
        }
        break;
      }
      case "snap": {
        const stepX = op.stepX ?? 1;
        const stepY = op.stepY ?? 1;
        const instanceIds = resolveLayoutInstanceIds(
          nextContainers,
          input.order,
          op.instanceIds,
        );
        for (const instanceId of instanceIds) {
          const current = requireLayoutContainer(nextContainers, instanceId);
          nextContainers.set(
            instanceId,
            normalize({
              x: snapToStepNonNegative(current.x, stepX),
              y: snapToStepNonNegative(current.y, stepY),
              w: snapToStepPositive(current.w, stepX),
              h: snapToStepPositive(current.h, stepY),
            }),
          );
        }
        break;
      }
      default:
        throw new HttpError(
          400,
          "INVALID_COMMAND",
          `Unsupported layout operation: ${String(op)}`,
        );
    }
  }

  let changed = false;
  for (const [instanceId, nextContainer] of nextContainers.entries()) {
    const current = requireLayoutContainer(input.containers, instanceId);
    if (!sameContainer(current, nextContainer)) {
      changed = true;
      break;
    }
  }
  if (!sameOrder(input.order, nextOrder)) {
    changed = true;
  }

  return {
    nextContainers,
    nextOrder,
    changed,
  };
}

function resolveLayoutAdapter(
  name: LayoutAdapterName | undefined,
): (container: GridContainer) => GridContainer {
  const effective = name ?? "grid12";
  if (effective === "grid12") {
    return normalizeGrid12;
  }
  throw new HttpError(
    400,
    "INVALID_COMMAND",
    `Unsupported layout adapter: ${effective}`,
  );
}

function normalizeGrid12(container: GridContainer): GridContainer {
  const clampedWidth = clamp(Math.trunc(container.w), 1, 12);
  const clampedHeight = Math.max(1, Math.trunc(container.h));
  const clampedX = clamp(Math.trunc(container.x), 0, Math.max(0, 12 - clampedWidth));
  const clampedY = Math.max(0, Math.trunc(container.y));
  return {
    x: clampedX,
    y: clampedY,
    w: clampedWidth,
    h: clampedHeight,
  };
}

function resolveLayoutInstanceIds(
  containers: Map<string, GridContainer>,
  order: string[],
  instanceIds: string[] | undefined,
): string[] {
  if (!instanceIds || instanceIds.length === 0) {
    return [...order];
  }
  const seen = new Set<string>();
  const resolved: string[] = [];
  for (const instanceId of instanceIds) {
    if (seen.has(instanceId)) {
      continue;
    }
    assertMountedInstance(containers, instanceId);
    seen.add(instanceId);
    resolved.push(instanceId);
  }
  return resolved;
}

function assertMountedInstance(
  containers: Map<string, GridContainer>,
  instanceId: string,
): void {
  if (!containers.has(instanceId)) {
    throw new HttpError(
      404,
      "INSTANCE_NOT_FOUND",
      `Instance not found: ${instanceId}`,
    );
  }
}

function requireLayoutContainer(
  containers: Map<string, GridContainer>,
  instanceId: string,
): GridContainer {
  const container = containers.get(instanceId);
  if (!container) {
    throw new HttpError(
      404,
      "INSTANCE_NOT_FOUND",
      `Instance not found: ${instanceId}`,
    );
  }
  return container;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function sameContainer(left: GridContainer, right: GridContainer): boolean {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.w === right.w &&
    left.h === right.h
  );
}

function sameOrder(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, idx) => value === right[idx]);
}

function moveToStart(items: string[], value: string): string[] {
  const without = items.filter((item) => item !== value);
  return [value, ...without];
}

function moveToEnd(items: string[], value: string): string[] {
  const without = items.filter((item) => item !== value);
  return [...without, value];
}

function snapToStepNonNegative(value: number, step: number): number {
  return Math.max(0, Math.round(value / step) * step);
}

function snapToStepPositive(value: number, step: number): number {
  return Math.max(1, Math.round(value / step) * step);
}
