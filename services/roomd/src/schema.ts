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

export const roomCommandSchema = z.discriminatedUnion("type", [
  mountCommandSchema,
  hideCommandSchema,
  showCommandSchema,
  unmountCommandSchema,
  callCommandSchema,
  selectCommandSchema,
  reorderCommandSchema,
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
