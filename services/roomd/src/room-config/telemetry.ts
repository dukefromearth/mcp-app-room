import { getRoomdLogger } from "../logging";

export interface RoomConfigMetricLabels {
  action: "upsert" | "load" | "save";
  status: "ok" | "error";
  mode?: string;
  dryRun?: boolean;
  namespace: string;
}

export interface RoomConfigAuditEvent {
  action: "upsert" | "load" | "save";
  status: "ok" | "error";
  namespace: string;
  configId: string;
  roomId?: string;
  mode?: string;
  dryRun?: boolean;
  revision?: number;
  plannedCommands?: number;
  code?: string;
  message?: string;
  timestamp: string;
}

export interface RoomConfigTelemetry {
  increment(metric: "room_config_requests_total", labels: RoomConfigMetricLabels): void;
  record(event: RoomConfigAuditEvent): void;
}

const logger = getRoomdLogger({ component: "room_config_telemetry" });

export class ConsoleRoomConfigTelemetry implements RoomConfigTelemetry {
  increment(
    metric: "room_config_requests_total",
    labels: RoomConfigMetricLabels,
  ): void {
    // GOTCHA: Metrics currently log to stdout until a real collector is wired.
    logger.info("metric.increment", { metric, labels });
  }

  record(event: RoomConfigAuditEvent): void {
    logger.info("audit.record", { event: "room_config_audit", ...event });
  }
}

export class NoopRoomConfigTelemetry implements RoomConfigTelemetry {
  increment(
    _metric: "room_config_requests_total",
    _labels: RoomConfigMetricLabels,
  ): void {}

  record(_event: RoomConfigAuditEvent): void {}
}
