#!/usr/bin/env node
import process from "node:process";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { chromium } from "playwright";

const cdpEndpoint = process.env.PLAYWRIGHT_CDP_ENDPOINT ?? "http://127.0.0.1:9222";
const initialUrl = process.env.PLAYWRIGHT_OPEN_URL ?? "";

async function main() {
  const browser = await chromium.connectOverCDP(cdpEndpoint);
  const context = browser.contexts()[0] ?? (await browser.newContext());

  if (initialUrl) {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(initialUrl);
  }

  let activePage = context.pages()[0] ?? (await context.newPage());
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
  eval <js-expression>
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
