import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { createWriteStream, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createServer } from "node:net";

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function runCommand(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = {},
): Promise<CommandResult> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        ...env,
      },
      stdio: "pipe",
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
  });
}

export function pipeLogs(
  prefix: string,
  child: ChildProcessWithoutNullStreams,
  options?: { logPath?: string },
): void {
  const stream = options?.logPath
    ? (() => {
      mkdirSync(dirname(options.logPath), { recursive: true });
      return createWriteStream(options.logPath, { flags: "a" });
    })()
    : undefined;

  child.stdout.on("data", (chunk) => {
    const line = `${prefix} ${String(chunk)}`;
    process.stdout.write(line);
    stream?.write(line);
  });
  child.stderr.on("data", (chunk) => {
    const line = `${prefix} ${String(chunk)}`;
    process.stderr.write(line);
    stream?.write(line);
  });

  if (stream) {
    child.on("close", () => {
      stream.end();
    });
  }
}

export async function terminateProcess(
  child: ChildProcessWithoutNullStreams | undefined,
): Promise<void> {
  if (!child || child.killed) {
    return;
  }

  child.kill("SIGTERM");
  const exitedOnTerm = await Promise.race([
    once(child, "exit").then(() => true).catch(() => false),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5_000)),
  ]);
  if (exitedOnTerm) {
    return;
  }

  child.kill("SIGKILL");
  await once(child, "exit").catch(() => undefined);
}

export async function waitForHttp(
  url: string,
  isReady: (status: number) => boolean,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (isReady(response.status)) {
        return;
      }
    } catch {
      // retry until timeout
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

export async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1");
    server.on("listening", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Unable to resolve free port"));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
    server.on("error", reject);
  });
}
