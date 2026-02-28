import express from "express";
import { z } from "zod";
import {
  capabilityPreviewSchema,
  elicitationUpdateSchema,
  rootsUpdateSchema,
  samplingUpdateSchema,
} from "./schema";
import { RoomStore } from "./store";
import type {
  CompletionCompleteParams,
  PromptGetParams,
  ResourceSubscriptionParams,
} from "./types";

interface ParsedSchema<TParsed> {
  parse(input: unknown): TParsed;
}

interface InstanceRouteSchemas {
  getPromptRequestParamsSchema: ParsedSchema<PromptGetParams>;
  completeRequestParamsSchema: ParsedSchema<CompletionCompleteParams>;
  subscribeRequestParamsSchema: ParsedSchema<ResourceSubscriptionParams>;
  unsubscribeRequestParamsSchema: ParsedSchema<ResourceSubscriptionParams>;
}

export function registerInstanceRoutes(
  app: express.Express,
  store: RoomStore,
  schemas: InstanceRouteSchemas,
): void {
  app.get("/rooms/:roomId/instances/:instanceId/ui", async (req, res, next) => {
    try {
      const resource = await store.getInstanceUiResource(
        req.params.roomId,
        req.params.instanceId,
      );
      res.json({ ok: true, resource });
    } catch (error) {
      next(error);
    }
  });

  app.get(
    "/rooms/:roomId/instances/:instanceId/capabilities",
    async (req, res, next) => {
      try {
        const capabilities = await store.getInstanceCapabilities(
          req.params.roomId,
          req.params.instanceId,
        );
        res.json({ ok: true, capabilities });
      } catch (error) {
        next(error);
      }
    },
  );

  app.get(
    "/rooms/:roomId/instances/:instanceId/client-capabilities",
    async (req, res, next) => {
      try {
        const capabilities = await store.getInstanceClientCapabilities(
          req.params.roomId,
          req.params.instanceId,
        );
        res.json({ ok: true, capabilities });
      } catch (error) {
        next(error);
      }
    },
  );

  app.put(
    "/rooms/:roomId/instances/:instanceId/client-capabilities/roots",
    async (req, res, next) => {
      try {
        const body = rootsUpdateSchema.parse(req.body);
        const capabilities = await store.setInstanceRoots(
          req.params.roomId,
          req.params.instanceId,
          body.roots,
        );
        res.json({ ok: true, capabilities });
      } catch (error) {
        next(error);
      }
    },
  );

  app.patch(
    "/rooms/:roomId/instances/:instanceId/client-capabilities/sampling",
    async (req, res, next) => {
      try {
        const patch = samplingUpdateSchema.parse(req.body);
        const capabilities = await store.configureInstanceSampling(
          req.params.roomId,
          req.params.instanceId,
          patch,
        );
        res.json({ ok: true, capabilities });
      } catch (error) {
        next(error);
      }
    },
  );

  app.patch(
    "/rooms/:roomId/instances/:instanceId/client-capabilities/elicitation",
    async (req, res, next) => {
      try {
        const patch = elicitationUpdateSchema.parse(req.body);
        const capabilities = await store.configureInstanceElicitation(
          req.params.roomId,
          req.params.instanceId,
          patch,
        );
        res.json({ ok: true, capabilities });
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    "/rooms/:roomId/instances/:instanceId/client-capabilities/sampling/preview",
    async (req, res, next) => {
      try {
        const params = capabilityPreviewSchema.parse(req.body ?? {});
        const result = await store.previewInstanceSampling(
          req.params.roomId,
          req.params.instanceId,
          params,
        );
        res.json({ ok: true, result });
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    "/rooms/:roomId/instances/:instanceId/client-capabilities/elicitation/preview",
    async (req, res, next) => {
      try {
        const params = capabilityPreviewSchema.parse(req.body ?? {});
        const result = await store.previewInstanceElicitation(
          req.params.roomId,
          req.params.instanceId,
          params,
        );
        res.json({ ok: true, result });
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    "/rooms/:roomId/instances/:instanceId/tools/list",
    async (req, res, next) => {
      try {
        const body = z.object({ cursor: z.string().optional() }).parse(req.body ?? {});
        const result = await store.listInstanceTools(
          req.params.roomId,
          req.params.instanceId,
          body.cursor,
        );
        res.json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    "/rooms/:roomId/instances/:instanceId/tools/call",
    async (req, res, next) => {
      try {
        const schema = z.object({
          name: z.string().min(1),
          arguments: z.record(z.string(), z.unknown()).optional(),
        });
        const body = schema.parse(req.body);
        const result = await store.callInstanceTool(
          req.params.roomId,
          req.params.instanceId,
          body.name,
          body.arguments ?? {},
        );
        res.json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    "/rooms/:roomId/instances/:instanceId/resources/list",
    async (req, res, next) => {
      try {
        const body = z.object({ cursor: z.string().optional() }).parse(req.body ?? {});
        const result = await store.listInstanceResources(
          req.params.roomId,
          req.params.instanceId,
          body.cursor,
        );
        res.json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    "/rooms/:roomId/instances/:instanceId/resources/read",
    async (req, res, next) => {
      try {
        const body = z.object({ uri: z.string().min(1) }).parse(req.body);
        const result = await store.readInstanceResource(
          req.params.roomId,
          req.params.instanceId,
          body.uri,
        );
        res.json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    "/rooms/:roomId/instances/:instanceId/resources/templates/list",
    async (req, res, next) => {
      try {
        const body = z.object({ cursor: z.string().optional() }).parse(req.body ?? {});
        const result = await store.listInstanceResourceTemplates(
          req.params.roomId,
          req.params.instanceId,
          body.cursor,
        );
        res.json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    "/rooms/:roomId/instances/:instanceId/prompts/list",
    async (req, res, next) => {
      try {
        const body = z.object({ cursor: z.string().optional() }).parse(req.body ?? {});
        const result = await store.listInstancePrompts(
          req.params.roomId,
          req.params.instanceId,
          body.cursor,
        );
        res.json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    "/rooms/:roomId/instances/:instanceId/prompts/get",
    async (req, res, next) => {
      try {
        const body = schemas.getPromptRequestParamsSchema.parse(req.body);
        const result = await store.getInstancePrompt(
          req.params.roomId,
          req.params.instanceId,
          body,
        );
        res.json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    "/rooms/:roomId/instances/:instanceId/completion/complete",
    async (req, res, next) => {
      try {
        const body = schemas.completeRequestParamsSchema.parse(req.body);
        const result = await store.completeInstance(
          req.params.roomId,
          req.params.instanceId,
          body,
        );
        res.json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    "/rooms/:roomId/instances/:instanceId/resources/subscribe",
    async (req, res, next) => {
      try {
        const body = schemas.subscribeRequestParamsSchema.parse(req.body);
        const result = await store.subscribeInstanceResource(
          req.params.roomId,
          req.params.instanceId,
          body,
        );
        res.json(result);
      } catch (error) {
        next(error);
      }
    },
  );

  app.post(
    "/rooms/:roomId/instances/:instanceId/resources/unsubscribe",
    async (req, res, next) => {
      try {
        const body = schemas.unsubscribeRequestParamsSchema.parse(req.body);
        const result = await store.unsubscribeInstanceResource(
          req.params.roomId,
          req.params.instanceId,
          body,
        );
        res.json(result);
      } catch (error) {
        next(error);
      }
    },
  );
}
