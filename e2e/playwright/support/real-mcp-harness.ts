import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  ensureDir,
  getFreePort,
  pipeProcessLogs,
  runCommand,
  terminateProcess,
  waitForHttp,
} from "./process-utils";

export type Envelope = {
  status: number;
  body: Record<string, any>;
};

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

export class RealMcpHarness {
  readonly repoRoot: string;
  readonly artifactDir: string;
  readonly fixtureServerPath: string;

  tempDir = "";
  configPath = "";
  roomId = "";
  roomdPort = 0;
  integrationPort = 0;
  roomdBaseUrl = "";
  integrationServerUrl = "";

  integrationProcess: ChildProcessWithoutNullStreams | undefined;
  roomdProcess: ChildProcessWithoutNullStreams | undefined;

  private closeLogStreams: Array<() => void> = [];

  constructor(repoRoot: string) {
    this.repoRoot = repoRoot;
    this.artifactDir = process.env.REAL_MCP_ARTIFACT_DIR
      ?? path.join(repoRoot, "artifacts", "real-mcp");
    this.fixtureServerPath = path.join(
      repoRoot,
      "e2e",
      "fixtures",
      "integration-server",
      "main.mjs",
    );
  }

  async start(roomIdPrefix: string): Promise<void> {
    this.roomdPort = await getFreePort();
    const hostPort = await getFreePort();
    const sandboxPort = await getFreePort();
    this.integrationPort = await getFreePort();

    this.roomdBaseUrl = `http://127.0.0.1:${this.roomdPort}`;
    this.integrationServerUrl = `http://127.0.0.1:${this.integrationPort}/mcp`;
    this.roomId = `${roomIdPrefix}-${Date.now()}`;

    this.tempDir = await mkdtemp(path.join(tmpdir(), "roomctl-real-mcp-"));
    this.configPath = path.join(this.tempDir, "global.yaml");

    await ensureDir(this.artifactDir);
    await writeFile(
      this.configPath,
      [
        "version: 1",
        "roomd:",
        `  baseUrl: \"${this.roomdBaseUrl}\"`,
        "host:",
        "  mode: \"room\"",
        `  roomId: \"${this.roomId}\"`,
        "  ports:",
        `    host: ${hostPort}`,
        `    sandbox: ${sandboxPort}`,
        "  browser:",
        "    remoteDebuggingPort: 9222",
        "  servers:",
        `    - \"${this.integrationServerUrl}\"`,
        "security:",
        "  profile: \"local-dev\"",
        "",
      ].join("\n"),
    );

    this.integrationProcess = spawn(process.execPath, [this.fixtureServerPath], {
      cwd: this.repoRoot,
      env: {
        ...process.env,
        PORT: String(this.integrationPort),
        PLAYWRIGHT_TEST: "1",
      },
      stdio: "pipe",
    });
    this.closeLogStreams.push(pipeProcessLogs("[fixture-mcp]", this.integrationProcess, this.artifactDir));
    await waitForHttp(this.integrationServerUrl, (status) => status > 0, 20_000);

    this.roomdProcess = spawn(process.execPath, ["scripts/run-roomd.mjs", "start"], {
      cwd: this.repoRoot,
      env: {
        ...process.env,
        PLAYWRIGHT_TEST: "1",
        MCP_APP_ROOM_CONFIG: this.configPath,
      },
      stdio: "pipe",
    });
    this.closeLogStreams.push(pipeProcessLogs("[roomd]", this.roomdProcess, this.artifactDir));
    await waitForHttp(`${this.roomdBaseUrl}/health`, (status) => status === 200, 30_000);
  }

  async stop(): Promise<void> {
    await terminateProcess(this.roomdProcess);
    await terminateProcess(this.integrationProcess);
    for (const close of this.closeLogStreams) {
      close();
    }
    this.closeLogStreams = [];
    if (this.tempDir) {
      await rm(this.tempDir, { recursive: true, force: true });
    }
  }

  async roomctl(args: string[]): Promise<Envelope> {
    const command = await runCommand(
      npmCmd,
      [
        "run",
        "--silent",
        "roomd:cli",
        "--",
        // GOTCHA: roomctl currently resolves config only from --config (not MCP_APP_ROOM_CONFIG env).
        "--config",
        this.configPath,
        "--output",
        "json",
        ...args,
      ],
      this.repoRoot,
      process.env,
    );

    if (command.exitCode !== 0) {
      throw new Error(`roomctl failed: ${command.stderr || command.stdout}`);
    }

    return JSON.parse(command.stdout) as Envelope;
  }
}
