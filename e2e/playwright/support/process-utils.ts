import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";

export async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

export async function runCommand(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
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

export function pipeProcessLogs(
  prefix: string,
  child: ChildProcessWithoutNullStreams,
  logDir: string,
): () => void {
  const safePrefix = prefix.replace(/[^a-z0-9_-]/gi, "_").toLowerCase();
  const stdoutPath = path.join(logDir, `${safePrefix}.stdout.log`);
  const stderrPath = path.join(logDir, `${safePrefix}.stderr.log`);
  const stdoutStream = createWriteStream(stdoutPath, { flags: "a" });
  const stderrStream = createWriteStream(stderrPath, { flags: "a" });

  child.stdout.on("data", (chunk) => {
    const text = String(chunk);
    process.stdout.write(`${prefix} ${text}`);
    stdoutStream.write(text);
  });

  child.stderr.on("data", (chunk) => {
    const text = String(chunk);
    process.stderr.write(`${prefix} ${text}`);
    stderrStream.write(text);
  });

  return () => {
    safeCloseStream(stdoutStream);
    safeCloseStream(stderrStream);
  };
}

function safeCloseStream(stream: WriteStream): void {
  if (stream.closed || stream.destroyed) {
    return;
  }
  stream.end();
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
