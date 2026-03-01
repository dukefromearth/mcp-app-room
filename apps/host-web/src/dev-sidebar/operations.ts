import type {
  OperationDescriptor,
  OperationId,
  SidebarMountTool,
  WireEnvelope,
} from "./contracts";
import { OPERATION_IDS } from "./contracts";
import {
  asRecord,
  readNonEmptyTrimmedString,
  readRecord,
  readString,
} from "./utils";

type DescriptorContext = Parameters<OperationDescriptor["execute"]>[0];

function invalidInput(message: string): WireEnvelope<unknown> {
  return {
    ok: false,
    error: {
      status: 400,
      message,
      code: "INVALID_INPUT",
    },
  };
}

function gateMissingInstance(): Promise<{ allowed: false; reason: string }> {
  return Promise.resolve({
    allowed: false,
    reason: "Select a mounted instance before running dev sidebar operations.",
  });
}

function extractToolName(input: unknown): string | undefined {
  return readNonEmptyTrimmedString(asRecord(input), "name");
}

function extractToolArgs(input: unknown): Record<string, unknown> {
  const args = asRecord(input).arguments;
  return asRecord(args);
}

function findTool(tools: SidebarMountTool[], name: string): SidebarMountTool | undefined {
  return tools.find((tool) => tool.name === name);
}

function createCursorSchema() {
  return {
    type: "object",
    properties: {
      cursor: {
        type: "string",
        title: "Cursor",
      },
    },
  };
}

function readCursor(input: unknown): string | undefined {
  return readString(asRecord(input), "cursor");
}

function createCursorListDescriptor(
  descriptor: Pick<OperationDescriptor, "id" | "tab" | "label" | "description">,
  execute: (context: DescriptorContext, cursor: string | undefined) => Promise<WireEnvelope<unknown>>,
): OperationDescriptor {
  return {
    ...descriptor,
    getInputSchema: async () => createCursorSchema(),
    canRun: async () => ({ allowed: true }),
    execute: (context, input) => execute(context, readCursor(input)),
  };
}

function createUriSchema() {
  return {
    type: "object",
    required: ["uri"],
    properties: {
      uri: {
        type: "string",
        title: "Resource URI",
        minLength: 1,
      },
    },
  };
}

function readRequiredUri(input: unknown): string | undefined {
  return readNonEmptyTrimmedString(asRecord(input), "uri");
}

function createUriDescriptor(
  descriptor: Pick<OperationDescriptor, "id" | "tab" | "label" | "description">,
  execute: (context: DescriptorContext, uri: string) => Promise<WireEnvelope<unknown>>,
): OperationDescriptor {
  return {
    ...descriptor,
    getInputSchema: async () => createUriSchema(),
    canRun: async (context, input) => {
      if (!context.mount) {
        return gateMissingInstance();
      }
      return readRequiredUri(input)
        ? { allowed: true }
        : { allowed: false, reason: "Resource URI is required." };
    },
    execute: async (context, input) => {
      const uri = readRequiredUri(input);
      if (!uri) {
        return invalidInput("Resource URI is required.");
      }
      return execute(context, uri);
    },
  };
}

function createNameArgsSchema() {
  return {
    type: "object",
    required: ["name"],
    properties: {
      name: { type: "string", minLength: 1 },
      arguments: { type: "object", default: {} },
    },
  };
}

function createPromptsGetDescriptor(): OperationDescriptor {
  return {
    id: "prompts.get",
    tab: "prompts",
    label: "Get Prompt",
    description: "Fetch prompt content by name and arguments.",
    getInputSchema: async () => createNameArgsSchema(),
    canRun: async (_context, input) => {
      const hasName = !!extractToolName(input);
      return hasName
        ? { allowed: true }
        : { allowed: false, reason: "Prompt name is required." };
    },
    execute: async (context, input) => {
      const name = extractToolName(input);
      if (!name) {
        return invalidInput("Prompt name is required.");
      }
      return context.protocol.getPrompt(context.scope, {
        name,
        arguments: extractToolArgs(input),
      });
    },
  };
}

function createToolsCallDescriptor(): OperationDescriptor {
  return {
    id: "tools.call",
    tab: "tools",
    label: "Call Tool",
    description: "Execute a mounted tool with JSON arguments.",
    getInputSchema: async (context) => {
      const options = (context.mount?.tools ?? []).map((tool) => ({
        const: tool.name,
        title: tool.title ?? tool.name,
        description: tool.description,
      }));
      return {
        type: "object",
        required: ["name"],
        properties: {
          name: {
            type: "string",
            title: "Tool",
            ...(options.length > 0 ? { oneOf: options } : {}),
          },
          arguments: {
            type: "object",
            title: "Arguments",
            default: {},
          },
        },
      };
    },
    canRun: async (context, input) => {
      if (!context.mount) {
        return gateMissingInstance();
      }

      const name = extractToolName(input);
      if (!name) {
        return { allowed: false, reason: "Tool name is required." };
      }

      const tool = findTool(context.mount.tools, name);
      if (!tool) {
        return {
          allowed: false,
          reason: `Tool "${name}" was not found in mounted tool catalog.`,
        };
      }

      if (tool.visibility && !tool.visibility.includes("app")) {
        return {
          allowed: false,
          reason: `Tool "${name}" is not callable from app visibility policy.`,
        };
      }

      return { allowed: true };
    },
    execute: async (context, input) => {
      const name = extractToolName(input);
      if (!name) {
        return invalidInput("Tool name is required.");
      }
      return context.protocol.callTool(context.scope, {
        name,
        arguments: extractToolArgs(input),
      });
    },
  };
}

function createCompletionDescriptor(): OperationDescriptor {
  return {
    id: "completion.complete",
    tab: "completion",
    label: "Completion",
    description: "Request completion candidates for prompt/resource refs.",
    getInputSchema: async () => ({
      type: "object",
      required: ["ref", "argument"],
      properties: {
        ref: {
          type: "object",
          required: ["type"],
          properties: {
            type: { type: "string", enum: ["ref/resource", "ref/prompt"] },
            uri: { type: "string" },
            name: { type: "string" },
          },
        },
        argument: {
          type: "object",
          required: ["name", "value"],
          properties: {
            name: { type: "string" },
            value: { type: "string" },
          },
        },
      },
    }),
    canRun: async () => ({ allowed: true }),
    execute: async (context, input) => {
      const record = asRecord(input);
      const ref = readRecord(record, "ref");
      const argument = readRecord(record, "argument");
      const type = ref.type;
      const name = argument.name;
      const value = argument.value;

      if (
        (type !== "ref/resource" && type !== "ref/prompt")
        || typeof name !== "string"
        || typeof value !== "string"
      ) {
        return invalidInput("Invalid completion input payload.");
      }

      return context.protocol.complete(context.scope, {
        ref: {
          type,
          ...(typeof ref.uri === "string" ? { uri: ref.uri } : {}),
          ...(typeof ref.name === "string" ? { name: ref.name } : {}),
        },
        argument: { name, value },
      });
    },
  };
}

function createOperationRegistry(): Record<OperationId, OperationDescriptor> {
  return {
    "tools.call": createToolsCallDescriptor(),
    "tools.list": createCursorListDescriptor(
      {
        id: "tools.list",
        tab: "tools",
        label: "List Tools",
        description: "List tools from mounted instance.",
      },
      (context, cursor) => context.protocol.listTools(context.scope, { cursor }),
    ),
    "resources.read": createUriDescriptor(
      {
        id: "resources.read",
        tab: "resources",
        label: "Read Resource",
        description: "Read a resource by URI.",
      },
      (context, uri) => context.protocol.readResource(context.scope, { uri }),
    ),
    "resources.list": createCursorListDescriptor(
      {
        id: "resources.list",
        tab: "resources",
        label: "List Resources",
        description: "List resources from mounted instance.",
      },
      (context, cursor) => context.protocol.listResources(context.scope, { cursor }),
    ),
    "resources.templates.list": createCursorListDescriptor(
      {
        id: "resources.templates.list",
        tab: "resources",
        label: "List Resource Templates",
        description: "List resource templates from mounted instance.",
      },
      (context, cursor) => context.protocol.listResourceTemplates(context.scope, { cursor }),
    ),
    "resources.subscribe": createUriDescriptor(
      {
        id: "resources.subscribe",
        tab: "resources",
        label: "Subscribe Resource",
        description: "Subscribe to resource update notifications.",
      },
      (context, uri) => context.protocol.subscribeResource(context.scope, { uri }),
    ),
    "resources.unsubscribe": createUriDescriptor(
      {
        id: "resources.unsubscribe",
        tab: "resources",
        label: "Unsubscribe Resource",
        description: "Unsubscribe from resource update notifications.",
      },
      (context, uri) => context.protocol.unsubscribeResource(context.scope, { uri }),
    ),
    "prompts.get": createPromptsGetDescriptor(),
    "prompts.list": createCursorListDescriptor(
      {
        id: "prompts.list",
        tab: "prompts",
        label: "List Prompts",
        description: "List prompts from mounted instance.",
      },
      (context, cursor) => context.protocol.listPrompts(context.scope, { cursor }),
    ),
    "completion.complete": createCompletionDescriptor(),
  };
}

export function createDefaultOperationDescriptors(): OperationDescriptor[] {
  const registry = createOperationRegistry();
  return OPERATION_IDS.map((id) => registry[id]);
}

