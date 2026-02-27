import { z } from "zod";

export const gridContainerSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  w: z.number().int().min(1).max(12),
  h: z.number().int().min(1),
});

const mountCommandSchema = z.object({
  type: z.literal("mount"),
  instanceId: z.string().min(1),
  server: z.string().url(),
  toolName: z.string().min(1),
  container: gridContainerSchema,
  initialInput: z.record(z.string(), z.unknown()).optional(),
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

const callCommandSchema = z.object({
  type: z.literal("call"),
  instanceId: z.string().min(1),
  input: z.record(z.string(), z.unknown()).optional(),
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
  callCommandSchema,
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

export const sinceRevisionSchema = z
  .string()
  .regex(/^\d+$/)
  .transform((value) => Number.parseInt(value, 10));
