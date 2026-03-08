import express from "express";
import { HttpError } from "./errors";
import {
  roomConfigLoadSchema,
  roomConfigPlanSchema,
  roomConfigSaveSchema,
  roomConfigUpsertSchema,
} from "./schema";
import { RoomConfigService } from "./room-config/service";
import { getRoomdLogger } from "./logging";

const logger = getRoomdLogger({ component: "room_config_routes" });

export function registerRoomConfigRoutes(
  app: express.Express,
  roomConfigService: RoomConfigService,
): void {
  logger.info("registerRoomConfigRoutes.enter");
  app.get("/room-configs", async (req, res, next) => {
    try {
      const namespace = parseNamespaceQuery(req.query.namespace);
      const configs = await roomConfigService.list(namespace);
      res.json({ ok: true, configs });
    } catch (error) {
      next(error);
    }
  });

  app.get("/room-configs/:configId", async (req, res, next) => {
    try {
      const namespace = parseNamespaceQuery(req.query.namespace);
      const config = await roomConfigService.get(namespace, req.params.configId);
      if (!config) {
        throw new HttpError(
          404,
          "CONFIG_NOT_FOUND",
          `Unknown room configuration: ${namespace}/${req.params.configId}`,
        );
      }
      res.json({ ok: true, config });
    } catch (error) {
      next(error);
    }
  });

  app.put("/room-configs/:configId", async (req, res, next) => {
    try {
      const body = roomConfigUpsertSchema.parse(req.body ?? {});
      const config = await roomConfigService.upsert({
        namespace: body.namespace,
        configId: req.params.configId,
        ...(body.owner ? { owner: body.owner } : {}),
        visibility: body.visibility,
        spec: body.spec,
      });
      res.json({ ok: true, config });
    } catch (error) {
      next(error);
    }
  });

  app.post("/room-configs/:configId/plan", async (req, res, next) => {
    try {
      const body = roomConfigPlanSchema.parse(req.body ?? {});
      const result = await roomConfigService.planLoad({
        namespace: body.namespace,
        configId: req.params.configId,
        roomId: body.roomId,
        mode: body.mode,
      });
      res.json({
        ok: true,
        namespace: body.namespace,
        configId: req.params.configId,
        roomId: body.roomId,
        mode: body.mode,
        revision: result.config.revision,
        plannedCommands: result.plan.operations.length,
        plan: result.plan,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/room-configs/:configId/load", async (req, res, next) => {
    try {
      const body = roomConfigLoadSchema.parse(req.body ?? {});
      const result = await roomConfigService.loadIntoRoom({
        namespace: body.namespace,
        configId: req.params.configId,
        roomId: body.roomId,
        mode: body.mode,
        dryRun: body.dryRun,
        idempotencyKey: body.idempotencyKey,
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/rooms/:roomId/configs/:configId/save", async (req, res, next) => {
    try {
      const body = roomConfigSaveSchema.parse(req.body ?? {});
      const config = await roomConfigService.saveFromRoomState({
        namespace: body.namespace,
        roomId: req.params.roomId,
        configId: req.params.configId,
        ...(body.owner ? { owner: body.owner } : {}),
        visibility: body.visibility,
        ...(body.title ? { title: body.title } : {}),
        ...(body.description ? { description: body.description } : {}),
        ...(body.tags ? { tags: body.tags } : {}),
      });
      res.json({ ok: true, config });
    } catch (error) {
      next(error);
    }
  });
  logger.info("registerRoomConfigRoutes.exit");
}

function parseNamespaceQuery(value: unknown): string {
  logger.debug("parseNamespaceQuery.enter", { type: typeof value });
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = value.trim();
    logger.debug("parseNamespaceQuery.exit", { namespace: parsed });
    return parsed;
  }
  logger.debug("parseNamespaceQuery.exit", { namespace: "default" });
  return "default";
}
