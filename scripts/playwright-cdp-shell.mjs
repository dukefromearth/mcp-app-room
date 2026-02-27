#!/usr/bin/env node
import process from "node:process";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { chromium } from "playwright";

/**
 * Remote debugging endpoint used when attaching Playwright over CDP.
 *
 * This should point at an already-running Chromium/Chrome instance with
 * remote debugging enabled.
 */
const cdpEndpoint = process.env.PLAYWRIGHT_CDP_ENDPOINT ?? "http://127.0.0.1:9222";
/**
 * Optional URL to open immediately after the shell attaches.
 *
 * When provided, the shell navigates the first available page (or a new page)
 * before entering the command loop.
 */
const initialUrl = process.env.PLAYWRIGHT_OPEN_URL ?? "";
/**
 * Opt-in gate for arbitrary JavaScript execution via `eval`.
 *
 * The shell defaults to safe, inspect-oriented commands. `eval` is intentionally
 * disabled unless explicitly enabled to avoid accidental arbitrary execution.
 */
const allowUnsafeEval = process.env.PLAYWRIGHT_ALLOW_UNSAFE_EVAL === "true";

/**
 * Default values for `inspect` queries when flags are omitted.
 *
 * These provide practical defaults for interactive debugging while keeping
 * response payloads readable.
 */
const INSPECT_DEFAULTS = Object.freeze({
  max: 50,
  truncate: 400,
  context: 1,
  timeoutMs: 1500,
});
/**
 * Hard upper bounds for `inspect` and telemetry capture.
 *
 * These limits keep the shell responsive even against large pages and large
 * in-memory objects.
 */
const INSPECT_LIMITS = Object.freeze({
  max: 200,
  truncate: 4000,
  context: 5,
  scanFactor: 10,
  telemetrySize: 200,
});

/**
 * Per-page telemetry store for lightweight recent history inspection.
 *
 * Uses weak references so page telemetry is released when Playwright pages are
 * destroyed.
 */
const pageTelemetry = new WeakMap();

/**
 * Register telemetry listeners for a page exactly once.
 *
 * Captures console events and network requests into fixed-size ring buffers so
 * `inspect console` and `inspect network` can run without extra wiring.
 *
 * @param {import("playwright").Page} page - Page to instrument.
 */
function ensurePageTelemetry(page) {
  if (pageTelemetry.has(page)) {
    return;
  }

  const telemetry = {
    console: [],
    network: [],
  };
  pageTelemetry.set(page, telemetry);

  page.on("console", (message) => {
    const location = message.location();
    telemetry.console.push({
      ts: new Date().toISOString(),
      type: message.type(),
      text: message.text(),
      url: location.url ?? "",
      lineNumber: location.lineNumber ?? null,
      columnNumber: location.columnNumber ?? null,
    });
    trimArray(telemetry.console, INSPECT_LIMITS.telemetrySize);
  });

  page.on("request", (request) => {
    telemetry.network.push({
      ts: new Date().toISOString(),
      method: request.method(),
      url: request.url(),
      resourceType: request.resourceType(),
    });
    trimArray(telemetry.network, INSPECT_LIMITS.telemetrySize);
  });
}

/**
 * Start an interactive Playwright CDP shell.
 *
 * Connects to an existing browser, selects an active page, and handles command
 * execution until the user exits.
 *
 * The shell supports direct interaction commands (`click`, `fill`, etc.) plus
 * structured inspection via `inspect`.
 */
async function main() {
  const browser = await chromium.connectOverCDP(cdpEndpoint);
  const context = browser.contexts()[0] ?? (await browser.newContext());

  if (initialUrl) {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(initialUrl);
  }

  let activePage = context.pages()[0] ?? (await context.newPage());
  context.pages().forEach(ensurePageTelemetry);
  context.on("page", ensurePageTelemetry);

  console.log(`[playwright] Attached to ${cdpEndpoint}`);
  console.log("[playwright] Type 'help' for commands.");

  const rl = readline.createInterface({ input, output });

  try {
    while (true) {
      const line = (await rl.question("pw> ")).trim();
      if (!line) continue;

      const [command, ...args] = splitArgs(line);

      if (command === "exit" || command === "quit") {
        break;
      }

      if (command === "help") {
        printHelp();
        continue;
      }

      if (command === "list") {
        const pages = context.pages();
        pages.forEach((page, idx) => {
          const marker = page === activePage ? "*" : " ";
          console.log(`${marker} [${idx}] ${page.url() || "about:blank"}`);
        });
        continue;
      }

      if (command === "use") {
        const index = Number.parseInt(args[0] ?? "", 10);
        if (Number.isNaN(index) || !context.pages()[index]) {
          console.log("Usage: use <page-index>");
          continue;
        }
        activePage = context.pages()[index];
        console.log(`[playwright] Active page set to [${index}] ${activePage.url()}`);
        continue;
      }

      if (command === "new") {
        activePage = await context.newPage();
        console.log("[playwright] Created new page");
        continue;
      }

      if (command === "goto") {
        const url = args[0];
        if (!url) {
          console.log("Usage: goto <url>");
          continue;
        }
        await activePage.goto(url);
        console.log(`[playwright] Navigated: ${activePage.url()}`);
        continue;
      }

      if (command === "reload") {
        await activePage.reload();
        console.log(`[playwright] Reloaded: ${activePage.url()}`);
        continue;
      }

      if (command === "click") {
        const selector = args[0];
        if (!selector) {
          console.log("Usage: click <selector>");
          continue;
        }
        await activePage.click(selector);
        console.log(`[playwright] Clicked: ${selector}`);
        continue;
      }

      if (command === "fill") {
        const selector = args[0];
        const value = args.slice(1).join(" ");
        if (!selector || value.length === 0) {
          console.log("Usage: fill <selector> <text>");
          continue;
        }
        await activePage.fill(selector, value);
        console.log(`[playwright] Filled: ${selector}`);
        continue;
      }

      if (command === "type") {
        const selector = args[0];
        const value = args.slice(1).join(" ");
        if (!selector || value.length === 0) {
          console.log("Usage: type <selector> <text>");
          continue;
        }
        await activePage.type(selector, value);
        console.log(`[playwright] Typed: ${selector}`);
        continue;
      }

      if (command === "press") {
        const key = args[0];
        if (!key) {
          console.log("Usage: press <key>");
          continue;
        }
        await activePage.keyboard.press(key);
        console.log(`[playwright] Pressed: ${key}`);
        continue;
      }

      if (command === "eval") {
        if (!allowUnsafeEval) {
          console.log("Unsafe eval is disabled. Set PLAYWRIGHT_ALLOW_UNSAFE_EVAL=true to enable.");
          continue;
        }
        const expression = args.join(" ");
        if (!expression) {
          console.log("Usage: eval <js-expression>");
          continue;
        }

        const result = await activePage.evaluate((expr) => {
          // eslint-disable-next-line no-eval
          return eval(expr);
        }, expression);
        console.log(JSON.stringify(result, null, 2));
        continue;
      }

      if (command === "inspect") {
        const request = parseInspectArgs(args);
        if (!request) {
          console.log("Usage: inspect <dom|globals|state|storage|network|console> [--selector <css>] [--path <dot.path>] [--filter </pattern/flags|text>] [--context <n>] [--max <n>] [--truncate <n>] [--format <json|table>]");
          continue;
        }

        const startedAt = Date.now();
        try {
          const data = await withTimeout(runInspect(activePage, request), INSPECT_DEFAULTS.timeoutMs);
          const durationMs = Date.now() - startedAt;
          const envelope = {
            version: 1,
            target: request.target,
            query: serializeQuery(request),
            meta: {
              count: Array.isArray(data) ? data.length : data && typeof data === "object" ? 1 : 0,
              durationMs,
            },
            data,
          };
          printInspectOutput(envelope, request.format);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.log(`[inspect] ${message}`);
        }
        continue;
      }

      if (command === "html") {
        const selector = args[0] ?? "html";
        const html = await activePage.locator(selector).first().innerHTML();
        console.log(html);
        continue;
      }

      if (command === "screenshot") {
        const file = args[0] ?? `cdp-${Date.now()}.png`;
        await activePage.screenshot({ path: file, fullPage: true });
        console.log(`[playwright] Wrote ${file}`);
        continue;
      }

      console.log(`Unknown command: ${command}`);
    }
  } finally {
    rl.close();
    await browser.close();
  }
}

/**
 * Split a command line into arguments with simple double-quote handling.
 *
 * Supports quoted segments with spaces but intentionally keeps parsing rules
 * minimal for interactive use.
 *
 * @param {string} line - Raw prompt input.
 * @returns {string[]} Parsed arguments.
 */
function splitArgs(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === " " && !inQuotes) {
      if (current.length > 0) {
        result.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current.length > 0) {
    result.push(current);
  }

  return result;
}

/**
 * Parse CLI args for the `inspect` command.
 *
 * Recognizes a fixed target set and known option flags, then applies default
 * values and safety clamping.
 *
 * @param {string[]} args - Command args after `inspect`.
 * @returns {object | null} Parsed request or `null` when target is invalid.
 */
function parseInspectArgs(args) {
  const target = args[0];
  if (!target) {
    return null;
  }
  if (!["dom", "globals", "state", "storage", "network", "console"].includes(target)) {
    return null;
  }

  const request = {
    target,
    selector: "body",
    path: "",
    filter: null,
    context: INSPECT_DEFAULTS.context,
    max: INSPECT_DEFAULTS.max,
    truncate: INSPECT_DEFAULTS.truncate,
    format: "json",
  };

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    if (arg === "--selector" && next) {
      request.selector = next;
      i += 1;
      continue;
    }
    if (arg === "--path" && next) {
      request.path = next;
      i += 1;
      continue;
    }
    if (arg === "--filter" && next) {
      request.filter = parseRegexToken(next);
      i += 1;
      continue;
    }
    if (arg === "--context" && next) {
      request.context = clampInt(next, INSPECT_DEFAULTS.context, 0, INSPECT_LIMITS.context);
      i += 1;
      continue;
    }
    if (arg === "--max" && next) {
      request.max = clampInt(next, INSPECT_DEFAULTS.max, 1, INSPECT_LIMITS.max);
      i += 1;
      continue;
    }
    if (arg === "--truncate" && next) {
      request.truncate = clampInt(next, INSPECT_DEFAULTS.truncate, 32, INSPECT_LIMITS.truncate);
      i += 1;
      continue;
    }
    if (arg === "--format" && next) {
      request.format = next === "table" ? "table" : "json";
      i += 1;
      continue;
    }
  }

  return request;
}

/**
 * Route an inspect request to its target handler.
 *
 * Each target handler is read-oriented and returns JSON-safe data.
 *
 * @param {import("playwright").Page} page - Active page.
 * @param {object} request - Parsed inspect request.
 * @returns {Promise<unknown>} Handler payload.
 */
async function runInspect(page, request) {
  if (request.target === "dom") {
    return inspectDom(page, request);
  }
  if (request.target === "globals") {
    return inspectGlobals(page, request);
  }
  if (request.target === "state") {
    return inspectState(page, request);
  }
  if (request.target === "storage") {
    return inspectStorage(page, request);
  }
  if (request.target === "network") {
    return inspectTelemetry(page, "network", request);
  }
  if (request.target === "console") {
    return inspectTelemetry(page, "console", request);
  }
  throw new Error(`Unsupported target: ${request.target}`);
}

/**
 * Inspect DOM nodes matched by selector and optional text filter.
 *
 * Returns compact match summaries with lightweight sibling context.
 * This is intended for quick interactive diagnostics, not full-page scraping.
 *
 * @param {import("playwright").Page} page - Active page.
 * @param {object} request - Parsed inspect request.
 * @returns {Promise<unknown[]>} DOM match summaries.
 */
async function inspectDom(page, request) {
  const selector = request.selector || "body";
  const payload = {
    selector,
    filter: request.filter,
    max: request.max,
    truncate: request.truncate,
    context: request.context,
    scanLimit: Math.min(request.max * INSPECT_LIMITS.scanFactor, INSPECT_LIMITS.max * INSPECT_LIMITS.scanFactor),
  };

  return page.evaluate((options) => {
    const results = [];
    const nodes = Array.from(document.querySelectorAll(options.selector));
    const regex = options.filter ? new RegExp(options.filter.source, options.filter.flags) : null;

    const truncate = (value) => {
      const text = String(value ?? "");
      return text.length > options.truncate ? `${text.slice(0, options.truncate)}...` : text;
    };

    const cssPath = (element) => {
      const parts = [];
      let current = element;
      while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 6) {
        let part = current.tagName.toLowerCase();
        if (current.id) {
          part += `#${current.id}`;
          parts.unshift(part);
          break;
        }
        if (current.classList.length > 0) {
          part += `.${Array.from(current.classList).slice(0, 2).join(".")}`;
        }
        const parent = current.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter((node) => node.tagName === current.tagName);
          if (siblings.length > 1) {
            part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
          }
        }
        parts.unshift(part);
        current = current.parentElement;
      }
      return parts.join(" > ");
    };

    for (let i = 0; i < nodes.length && i < options.scanLimit; i++) {
      const element = nodes[i];
      const text = truncate(element.textContent || "");
      if (regex && !regex.test(text)) {
        continue;
      }

      const siblings = element.parentElement ? Array.from(element.parentElement.children) : [];
      const index = siblings.indexOf(element);
      const before = [];
      const after = [];
      for (let k = 1; k <= options.context; k++) {
        const b = siblings[index - k];
        const a = siblings[index + k];
        if (b) before.unshift(truncate(b.textContent || b.tagName));
        if (a) after.push(truncate(a.textContent || a.tagName));
      }

      results.push({
        path: cssPath(element),
        tag: element.tagName.toLowerCase(),
        id: element.id || "",
        classes: Array.from(element.classList).slice(0, 5),
        text,
        context: { before, after },
      });
      if (results.length >= options.max) {
        break;
      }
    }
    return results;
  }, payload);
}

/**
 * Inspect global object keys at a path with optional key filtering.
 *
 * Values are returned as summaries so output remains stable and bounded.
 * This avoids returning large live objects directly.
 *
 * @param {import("playwright").Page} page - Active page.
 * @param {object} request - Parsed inspect request.
 * @returns {Promise<unknown[]>} Global key summaries.
 */
async function inspectGlobals(page, request) {
  const payload = {
    path: request.path || "",
    filter: request.filter,
    max: request.max,
    truncate: request.truncate,
  };

  return page.evaluate((options) => {
    const resolvePath = (root, path) => {
      if (!path) return root;
      return path.split(".").filter(Boolean).reduce((current, part) => {
        if (current && typeof current === "object" && part in current) {
          return current[part];
        }
        return undefined;
      }, root);
    };

    const summarize = (value) => {
      if (value === null) return "null";
      const t = typeof value;
      if (t === "undefined") return "undefined";
      if (t === "string") return value.length > options.truncate ? `${value.slice(0, options.truncate)}...` : value;
      if (t === "number" || t === "boolean" || t === "bigint") return String(value);
      if (t === "function") return `[function ${(value.name || "anonymous")}]`;
      if (Array.isArray(value)) return `[array(${value.length})]`;
      if (value instanceof Date) return value.toISOString();
      if (t === "object") return `[object ${(value.constructor && value.constructor.name) || "Object"}]`;
      return `[${t}]`;
    };

    const regex = options.filter ? new RegExp(options.filter.source, options.filter.flags) : null;
    const target = resolvePath(window, options.path);
    const output = [];
    if (!target || (typeof target !== "object" && typeof target !== "function")) {
      return output;
    }
    const keys = Object.getOwnPropertyNames(target);
    for (const key of keys) {
      if (regex && !regex.test(key)) {
        continue;
      }
      let value;
      try {
        value = target[key];
      } catch {
        value = "[unreadable]";
      }
      output.push({
        key,
        type: typeof value,
        summary: summarize(value),
      });
      if (output.length >= options.max) {
        break;
      }
    }
    return output;
  }, payload);
}

/**
 * Inspect application state from `window.__APP_STATE__`.
 *
 * The returned value is sanitized and depth-limited to prevent oversized output.
 *
 * @param {import("playwright").Page} page - Active page.
 * @param {object} request - Parsed inspect request.
 * @returns {Promise<unknown>} Sanitized state snapshot.
 */
async function inspectState(page, request) {
  const payload = {
    path: request.path || "",
    truncate: request.truncate,
  };
  const raw = await page.evaluate((options) => {
    const resolvePath = (root, path) => {
      if (!path) return root;
      return path.split(".").filter(Boolean).reduce((current, part) => {
        if (current && typeof current === "object" && part in current) {
          return current[part];
        }
        return undefined;
      }, root);
    };

    const stateRoot = window.__APP_STATE__;
    return resolvePath(stateRoot, options.path);
  }, payload);
  return sanitizeValue(raw, {
    maxItems: request.max,
    maxString: request.truncate,
    maxDepth: 4,
  });
}

/**
 * Inspect local/session storage contents with optional filtering.
 *
 * Use `--path local` or `--path session` to scope to one store.
 * Without `--path`, both stores are returned.
 *
 * @param {import("playwright").Page} page - Active page.
 * @param {object} request - Parsed inspect request.
 * @returns {Promise<unknown>} Storage payload.
 */
async function inspectStorage(page, request) {
  const payload = {
    filter: request.filter,
    max: request.max,
    truncate: request.truncate,
    path: request.path || "",
  };

  return page.evaluate((options) => {
    const truncate = (value) => {
      const text = String(value ?? "");
      return text.length > options.truncate ? `${text.slice(0, options.truncate)}...` : text;
    };
    const regex = options.filter ? new RegExp(options.filter.source, options.filter.flags) : null;

    const readStore = (name, store) => {
      const entries = [];
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i);
        if (!key) {
          continue;
        }
        const value = store.getItem(key);
        const matchSource = `${key} ${value ?? ""}`;
        if (regex && !regex.test(matchSource)) {
          continue;
        }
        entries.push({ key, value: truncate(value) });
        if (entries.length >= options.max) {
          break;
        }
      }
      return { store: name, entries };
    };

    if (options.path === "local") {
      return readStore("local", window.localStorage);
    }
    if (options.path === "session") {
      return readStore("session", window.sessionStorage);
    }
    return [
      readStore("local", window.localStorage),
      readStore("session", window.sessionStorage),
    ];
  }, payload);
}

/**
 * Inspect captured telemetry rows for `console` or `network`.
 *
 * Results are returned newest-first and constrained by the request limits.
 *
 * @param {import("playwright").Page} page - Active page.
 * @param {"console" | "network"} kind - Telemetry stream kind.
 * @param {object} request - Parsed inspect request.
 * @returns {unknown[]} Filtered telemetry entries.
 */
function inspectTelemetry(page, kind, request) {
  const telemetry = pageTelemetry.get(page);
  if (!telemetry) {
    return [];
  }
  const rows = telemetry[kind] ?? [];
  const regex = request.filter ? new RegExp(request.filter.source, request.filter.flags) : null;
  const filtered = rows
    .slice()
    .reverse()
    .filter((row) => {
      if (!regex) return true;
      return regex.test(JSON.stringify(row));
    })
    .slice(0, request.max)
    .map((row) => sanitizeValue(row, { maxItems: request.max, maxString: request.truncate, maxDepth: 3 }));
  return filtered;
}

/**
 * Serialize inspect query inputs for response metadata.
 *
 * Produces a stable, display-friendly shape that can be logged or piped.
 *
 * @param {object} request - Parsed inspect request.
 * @returns {object} Stable query metadata object.
 */
function serializeQuery(request) {
  return {
    target: request.target,
    selector: request.selector || undefined,
    path: request.path || undefined,
    filter: request.filter ? `/${request.filter.source}/${request.filter.flags}` : undefined,
    context: request.context,
    max: request.max,
    truncate: request.truncate,
    format: request.format,
  };
}

/**
 * Print inspect results in JSON or table form.
 *
 * JSON output always includes the response envelope; table output is a compact
 * view for array data.
 *
 * @param {object} envelope - Versioned inspect response.
 * @param {"json" | "table"} format - Output format.
 */
function printInspectOutput(envelope, format) {
  if (format === "table" && Array.isArray(envelope.data)) {
    console.log(`[inspect:${envelope.target}] count=${envelope.meta.count} durationMs=${envelope.meta.durationMs}`);
    console.table(envelope.data);
    return;
  }
  console.log(JSON.stringify(envelope, null, 2));
}

/**
 * Parse and clamp integer input to a bounded range.
 *
 * Invalid values fall back to the provided default.
 *
 * @param {string} value - Raw CLI value.
 * @param {number} fallback - Fallback value for invalid input.
 * @param {number} min - Minimum accepted value.
 * @param {number} max - Maximum accepted value.
 * @returns {number} Bounded integer.
 */
function clampInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/**
 * Parse regex token format `/pattern/flags` or fallback to escaped text search.
 *
 * The fallback mode builds a case-insensitive literal match to keep filtering
 * predictable for non-regex input.
 *
 * @param {string} token - Raw filter token.
 * @returns {{source: string, flags: string}} Regex descriptor.
 */
function parseRegexToken(token) {
  const match = token.match(/^\/(.+)\/([a-z]*)$/i);
  if (!match) {
    return { source: escapeRegex(token), flags: "i" };
  }
  const [, source, flags] = match;
  try {
    // Validate the parsed pattern before returning it.
    new RegExp(source, flags);
    return { source, flags };
  } catch {
    return { source: escapeRegex(token), flags: "i" };
  }
}

/**
 * Escape special characters in literal text for safe regex construction.
 *
 * @param {string} text - Untrusted literal string.
 * @returns {string} Regex-escaped string.
 */
function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Sanitize nested values for bounded, JSON-safe transport.
 *
 * Applies depth, item count, and string length limits recursively.
 *
 * @param {unknown} value - Value to sanitize.
 * @param {{maxItems: number, maxString: number, maxDepth: number}} limits - Sanitization limits.
 * @param {number} depth - Current recursion depth.
 * @returns {unknown} Sanitized value.
 */
function sanitizeValue(value, limits, depth = 0) {
  if (value === null || value === undefined) {
    return value;
  }
  if (typeof value === "string") {
    return value.length > limits.maxString ? `${value.slice(0, limits.maxString)}...` : value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "function") {
    return `[function ${value.name || "anonymous"}]`;
  }
  if (depth >= limits.maxDepth) {
    return "[max-depth]";
  }
  if (Array.isArray(value)) {
    return value.slice(0, limits.maxItems).map((item) => sanitizeValue(item, limits, depth + 1));
  }
  if (typeof value === "object") {
    const result = {};
    const keys = Object.keys(value).slice(0, limits.maxItems);
    for (const key of keys) {
      result[key] = sanitizeValue(value[key], limits, depth + 1);
    }
    return result;
  }
  return String(value);
}

/**
 * Keep only the newest entries in an array.
 *
 * Used by telemetry collectors to maintain fixed-size history.
 *
 * @param {unknown[]} values - Target array.
 * @param {number} maxSize - Maximum number of entries to keep.
 */
function trimArray(values, maxSize) {
  if (values.length <= maxSize) {
    return;
  }
  values.splice(0, values.length - maxSize);
}

/**
 * Resolve a promise with a timeout guard.
 *
 * Used to prevent long-running inspect commands from blocking the shell loop.
 *
 * @template T
 * @param {Promise<T>} promise - Promise to wrap.
 * @param {number} timeoutMs - Timeout in milliseconds.
 * @returns {Promise<T>} Result or timeout error.
 */
function withTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

/**
 * Print interactive help for shell commands.
 *
 * This is the canonical command reference shown to shell users.
 */
function printHelp() {
  console.log(`Commands:
  help
  list
  use <page-index>
  new
  goto <url>
  reload
  click <selector>
  fill <selector> <text>
  type <selector> <text>
  press <key>
  inspect <target> [options]
    targets: dom | globals | state | storage | network | console
    options:
      --selector <css>
      --path <dot.path>
      --filter </pattern/flags|text>
      --context <n>
      --max <n>
      --truncate <n>
      --format <json|table>
  eval <js-expression> (unsafe; requires PLAYWRIGHT_ALLOW_UNSAFE_EVAL=true)
  html [selector]
  screenshot [file]
  exit | quit
`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[playwright] ${message}`);
  process.exit(1);
});
