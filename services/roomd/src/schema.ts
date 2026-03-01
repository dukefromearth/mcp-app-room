import { z } from "zod";
import { isValidServerTarget } from "./server-target";

const serverTargetSchema = z
  .string()
  .min(1)
  .refine((value) => isValidServerTarget(value), {
    message: "server must be a valid HTTP URL or stdio descriptor",
  });

export const gridContainerSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1),
});

export const clientRootSchema = z.object({
  uri: z
    .string()
    .min(1)
    .refine((value) => {
      try {
        return new URL(value).protocol === "file:";
      } catch {
        return false;
      }
    }, "uri must be a valid file:// URI"),
  name: z.string().min(1).optional(),
  _meta: z.record(z.string(), z.unknown()).optional(),
});

const mountClientRootsSchema = z.object({
  enabled: z.boolean().optional(),
  listChanged: z.boolean().optional(),
  roots: z.array(clientRootSchema).optional(),
});

const mountClientSamplingSchema = z.object({
  enabled: z.boolean().optional(),
  requireHumanInTheLoop: z.boolean().optional(),
  allowToolUse: z.boolean().optional(),
  maxOutputTokens: z.number().int().min(1).optional(),
  defaultModel: z.string().min(1).optional(),
});

const mountClientElicitationSchema = z.object({
  enabled: z.boolean().optional(),
  allowFormMode: z.boolean().optional(),
  allowUrlMode: z.boolean().optional(),
  requireUrlForSensitive: z.boolean().optional(),
  sensitiveFieldKeywords: z.array(z.string().min(1)).optional(),
  defaultAction: z.enum(["decline", "cancel"]).optional(),
});

export const mountClientCapabilitiesSchema = z.object({
  roots: mountClientRootsSchema.optional(),
  sampling: mountClientSamplingSchema.optional(),
  elicitation: mountClientElicitationSchema.optional(),
});

const mountCommandSchema = z.object({
  type: z.literal("mount"),
  instanceId: z.string().min(1),
  server: serverTargetSchema,
  container: gridContainerSchema,
  uiResourceUri: z.string().min(1).optional(),
  clientCapabilities: mountClientCapabilitiesSchema.optional(),
});

const hideCommandSchema = z.object({
  type: z.literal("hide"),
  instanceId: z.string().min(1),
});

const showCommandSchema = z.object({
  type: z.literal("show"),
  instanceId: z.string().min(1),
});

const unmountCommandSchema = z.object({
  type: z.literal("unmount"),
  instanceId: z.string().min(1),
});

const selectCommandSchema = z.object({
  type: z.literal("select"),
  instanceId: z.string().min(1).nullable(),
});

const reorderCommandSchema = z.object({
  type: z.literal("reorder"),
  order: z.array(z.string().min(1)),
});

const layoutAxisSchema = z.enum(["x", "y"]);
const layoutInstanceIdsSchema = z.array(z.string().min(1)).min(1).optional();

const setLayoutOpSchema = z.object({
  op: z.literal("set"),
  instanceId: z.string().min(1),
  container: gridContainerSchema,
});

const moveLayoutOpSchema = z.object({
  op: z.literal("move"),
  instanceId: z.string().min(1),
  dx: z.number().int(),
  dy: z.number().int(),
});

const resizeLayoutOpSchema = z.object({
  op: z.literal("resize"),
  instanceId: z.string().min(1),
  dw: z.number().int(),
  dh: z.number().int(),
});

const swapLayoutOpSchema = z.object({
  op: z.literal("swap"),
  first: z.string().min(1),
  second: z.string().min(1),
});

const bringToFrontLayoutOpSchema = z.object({
  op: z.literal("bring-to-front"),
  instanceId: z.string().min(1),
});

const sendToBackLayoutOpSchema = z.object({
  op: z.literal("send-to-back"),
  instanceId: z.string().min(1),
});

const alignLayoutOpSchema = z.object({
  op: z.literal("align"),
  axis: layoutAxisSchema,
  value: z.number().int().min(0),
  instanceIds: layoutInstanceIdsSchema,
});

const distributeLayoutOpSchema = z.object({
  op: z.literal("distribute"),
  axis: layoutAxisSchema,
  gap: z.number().int().min(0).optional(),
  instanceIds: layoutInstanceIdsSchema,
});

const snapLayoutOpSchema = z.object({
  op: z.literal("snap"),
  instanceIds: layoutInstanceIdsSchema,
  stepX: z.number().int().min(1).optional(),
  stepY: z.number().int().min(1).optional(),
});

const layoutCommandSchema = z.object({
  type: z.literal("layout"),
  adapter: z.enum(["grid12"]).optional(),
  ops: z
    .array(
      z.discriminatedUnion("op", [
        setLayoutOpSchema,
        moveLayoutOpSchema,
        resizeLayoutOpSchema,
        swapLayoutOpSchema,
        bringToFrontLayoutOpSchema,
        sendToBackLayoutOpSchema,
        alignLayoutOpSchema,
        distributeLayoutOpSchema,
        snapLayoutOpSchema,
      ]),
    )
    .min(1),
});

export const roomCommandSchema = z.discriminatedUnion("type", [
  mountCommandSchema,
  hideCommandSchema,
  showCommandSchema,
  unmountCommandSchema,
  selectCommandSchema,
  reorderCommandSchema,
  layoutCommandSchema,
]);

export const commandEnvelopeSchema = z.object({
  idempotencyKey: z.string().min(1),
  command: roomCommandSchema,
});

export const createRoomSchema = z.object({
  roomId: z.string().min(1),
});

export const inspectServerSchema = z.object({
  server: serverTargetSchema,
});

export const rootsUpdateSchema = z.object({
  roots: z.array(clientRootSchema),
});

export const samplingUpdateSchema = mountClientSamplingSchema;

export const elicitationUpdateSchema = mountClientElicitationSchema;

export const capabilityPreviewSchema = z.record(z.string(), z.unknown());

export const instanceEvidenceSchema = z.object({
  source: z.enum(["host", "app"]).default("host"),
  event: z.enum([
    "bridge_connected",
    "resource_delivered",
    "app_initialized",
    "app_error",
  ]),
  invocationId: z.string().min(1).optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export const sinceRevisionSchema = z
  .string()
  .regex(/^\d+$/)
  .transform((value) => Number.parseInt(value, 10));
