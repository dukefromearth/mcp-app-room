import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

interface BrowserLaunchConfig {
  hostPort: number;
  hostMode: string;
  roomdUrl: string;
  roomId: string;
  remoteDebuggingPort: number;
}

function shouldLaunchBrowser(): boolean {
  if (process.env.AUTO_LAUNCH_BROWSER === "false") return false;
  if (process.env.CI === "true") return false;
  if (process.env.PLAYWRIGHT_TEST === "1") return false;
  return true;
}

function getLaunchUrl(config: BrowserLaunchConfig): string {
  const url = new URL(`http://localhost:${config.hostPort}/`);
  url.searchParams.set("mode", config.hostMode);

  if (config.hostMode === "room" && config.roomdUrl) {
    url.searchParams.set("roomd", config.roomdUrl);
    url.searchParams.set("room", config.roomId);
  }

  return url.toString();
}

function detectChromeCommand(): string | undefined {
  const fromEnv = process.env.CHROME_PATH;
  if (fromEnv && existsSync(fromEnv)) {
    return fromEnv;
  }

  if (process.platform === "darwin") {
    const candidates = [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    ];
    return candidates.find((candidate) => existsSync(candidate));
  }

  if (process.platform === "win32") {
    const candidates = [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      join(
        process.env.LOCALAPPDATA || "",
        "Google",
        "Chrome",
        "Application",
        "chrome.exe",
      ),
    ];
    return candidates.find((candidate) => existsSync(candidate));
  }

  const linuxCandidates = [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  return linuxCandidates.find((candidate) => existsSync(candidate));
}

export function maybeLaunchBrowser(config: BrowserLaunchConfig): void {
  if (!shouldLaunchBrowser()) {
    return;
  }

  const launchUrl = getLaunchUrl(config);
  const chromeCommand = detectChromeCommand();

  if (!chromeCommand) {
    console.warn(
      "[Host] Could not find Chrome/Chromium to auto-launch with remote debugging.",
    );
    console.warn(`[Host] Open manually: ${launchUrl}`);
    return;
  }

  const userDataDir = join(
    homedir(),
    ".cache",
    "mcp-app-room-chrome-profile",
  );
  mkdirSync(userDataDir, { recursive: true });

  const args = [
    `--remote-debugging-port=${config.remoteDebuggingPort}`,
    `--user-data-dir=${userDataDir}`,
    "--new-window",
    launchUrl,
  ];

  const child = spawn(chromeCommand, args, {
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  console.log(
    `[Host] Launched browser with remote debugging on :${config.remoteDebuggingPort}`,
  );
  console.log(`[Host] URL: ${launchUrl}`);
}
