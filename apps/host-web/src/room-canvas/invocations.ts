import type { RoomInvocation, RoomMount } from "./contracts";

export function latestInvocationForInstance(
  invocations: RoomInvocation[],
  mount: RoomMount,
): RoomInvocation | undefined {
  const appOnlyTools = new Set(
    mount.tools
      .filter((tool) => tool.visibility?.length && !tool.visibility.includes("model"))
      .map((tool) => tool.name),
  );
  for (let idx = invocations.length - 1; idx >= 0; idx -= 1) {
    const invocation = invocations[idx]!;
    if (invocation.instanceId !== mount.instanceId) {
      continue;
    }
    if (invocation.toolName && appOnlyTools.has(invocation.toolName)) {
      continue;
    }
    return invocation;
  }
  return undefined;
}
