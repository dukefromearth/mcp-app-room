import type { RoomInvocation, RoomMount } from "./contracts";

export function latestInvocationForInstance(
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

  for (let idx = invocations.length - 1; idx >= 0; idx--) {
    const invocation = invocations[idx];
    if (invocation.instanceId !== mount.instanceId) {
      continue;
    }
    if (isAppOnlyTool(invocation.toolName)) {
      continue;
    }
    return invocation;
  }
  return undefined;
}
