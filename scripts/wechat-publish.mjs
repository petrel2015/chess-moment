#!/usr/bin/env node
/**
 * WeChat publisher CLI.
 *
 * Usage:
 *   node scripts/wechat-publish.mjs <command> [options]
 *
 * Commands:
 *   prepare  -- Generate and validate payload, verify interactive URL
 *   publish  -- Execute publish flow (dry-run or mock mode only by default)
 *   status   -- Query publish status by idempotency key
 *   retry    -- Retry a failed publish
 *   list     -- List all publish state records
 *
 * Options:
 *   --slug <slug>          Lesson slug (required for prepare/publish/retry)
 *   --mode <mode>          dry-run | mock | production (default: dry-run)
 *   --mock-url <url>       Mock server URL (for mock mode)
 *   --state-dir <dir>      State directory (default: _artifacts/wechat/state)
 *   --check-url            Verify interactive URL is accessible before publish
 *   --app-id <id>          WeChat AppID (production only, or env WECHAT_APP_ID)
 *   --timeout <ms>         Per-request timeout in milliseconds (default: 30000)
 *
 * AppSecret is NEVER accepted on the command line.  In production mode it must
 * come from the WECHAT_APP_SECRET environment variable (or a runtime secret
 * store).  This prevents credentials leaking into shell history or process
 * listings.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadLessons, publicLesson, interactiveUrl, idempotencyKey } from "./content-lib.mjs";
import { buildWechatPayload, auditPayload } from "./wechat-payload.mjs";
import { publishWechat, getPublishStatus, listPublishStates, retryFailed } from "./wechat-publisher.mjs";

function parseArgs(argv) {
  const args = { command: null, _positional: [] };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2).replace(/-/g, "_");
      const value = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
      args[key] = value;
    } else if (!args.command) {
      args.command = arg;
    } else {
      args._positional.push(arg);
    }
  }
  return args;
}

async function findLesson(slug) {
  const lessons = await loadLessons();
  const lesson = lessons.find(l => l.slug === slug);
  if (!lesson) {
    throw new Error(`Lesson not found: ${slug}. Available: ${lessons.map(l => l.slug).join(", ")}`);
  }
  return publicLesson(lesson);
}

async function checkUrlAccessible(url) {
  try {
    const response = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(10000) });
    return { accessible: response.ok, status: response.status, url };
  } catch (error) {
    return { accessible: false, status: 0, url, error: error.message };
  }
}

async function cmdPrepare(args) {
  if (!args.slug) {
    console.error("Error: --slug is required for prepare");
    process.exit(1);
  }
  const lesson = await findLesson(args.slug);
  const payload = await buildWechatPayload(lesson);

  // Audit payload
  const violations = auditPayload(payload);
  if (violations.length) {
    console.error("Payload audit failed:");
    violations.forEach(v => console.error(`  - ${v}`));
    process.exit(1);
  }

  // Check interactive URL if requested
  if (args.check_url) {
    const urlCheck = await checkUrlAccessible(payload.interactive_url);
    if (!urlCheck.accessible) {
      console.error(`Interactive URL not accessible: ${payload.interactive_url}`);
      console.error(`  Status: ${urlCheck.status}, Error: ${urlCheck.error || "N/A"}`);
      console.error("  Cannot publish until interactive page is accessible.");
      process.exit(1);
    }
    console.log(`Interactive URL verified: ${urlCheck.url} (${urlCheck.status})`);
  }

  const outPath = path.join(process.cwd(), "_artifacts", "wechat", `${args.slug}.payload.json`);
  console.log(`Payload generated and validated: ${outPath}`);
  console.log(`  Idempotency key: ${payload.idempotency_key}`);
  console.log(`  Content hash: ${payload.content_hash}`);
  console.log(`  Interactive URL: ${payload.interactive_url}`);
  console.log(`  WeChat preview: ${payload.wechat_preview_url}`);
  console.log(`  Assets: ${payload.assets.length}`);
  console.log("Ready for publish. Run: node scripts/wechat-publish.mjs publish --slug " + args.slug + " --mode <mode>");
}

async function cmdPublish(args) {
  if (!args.slug) {
    console.error("Error: --slug is required for publish");
    process.exit(1);
  }
  const mode = args.mode || "dry-run";
  if (mode === "production" && !process.env.WECHAT_APP_SECRET) {
    console.error("Error: production mode requires WECHAT_APP_SECRET environment variable");
    console.error("  Do not pass AppSecret on the command line.");
    process.exit(1);
  }

  const lesson = await findLesson(args.slug);

  // Re-generate payload to ensure it's fresh
  const payload = await buildWechatPayload(lesson);

  const config = {
    mode,
    stateDir: args.state_dir || path.join(process.cwd(), "_artifacts", "wechat", "state"),
    maxRetries: 3,
    pollIntervalMs: 100,
    pollMaxAttempts: 20,
    timeoutMs: args.timeout ? parseInt(args.timeout, 10) : 30000,
  };

  if (mode === "mock") {
    config.mockServerUrl = args.mock_url || "http://127.0.0.1:3000";
  }

  if (mode === "production") {
    config.appId = args.app_id || process.env.WECHAT_APP_ID;
    config.appSecret = process.env.WECHAT_APP_SECRET;
  }

  console.log(`Publishing ${args.slug} in ${mode} mode...`);
  console.log(`  Idempotency key: ${payload.idempotency_key}`);

  const result = await publishWechat(payload, config);

  console.log("\n=== Result ===");
  console.log(`  Final status: ${result.state.final_status}`);
  console.log(`  Article URL: ${result.state.article_url || "N/A"}`);
  console.log(`  Error code: ${result.state.error_code || "None"}`);
  if (result.state.error_message) {
    console.log(`  Error message: ${result.state.error_message}`);
  }
  console.log(`  Summary: ${result.state.summary}`);
  console.log(`  Total attempts: ${result.state.attempts}`);

  if (result.state.final_status === "failed") {
    process.exit(1);
  }
}

async function cmdStatus(args) {
  if (!args.slug) {
    console.error("Error: --slug is required for status");
    process.exit(1);
  }
  const lesson = await findLesson(args.slug);
  const key = idempotencyKey(lesson);
  const stateDir = args.state_dir || path.join(process.cwd(), "_artifacts", "wechat", "state");
  const result = await getPublishStatus(key, stateDir);

  if (!result.found) {
    console.log(`No record found for ${args.slug} (key: ${key})`);
    process.exit(0);
  }

  console.log(`Status for ${args.slug}:`);
  console.log(`  Key: ${key}`);
  console.log(`  Final status: ${result.state.final_status}`);
  console.log(`  Article URL: ${result.state.article_url || "N/A"}`);
  console.log(`  Error: ${result.state.error_code || "None"} ${result.state.error_message || ""}`);
  console.log(`  Summary: ${result.summary}`);
  console.log("\nStages:");
  for (const [name, stage] of Object.entries(result.state.stages)) {
    console.log(`  ${name}: ${stage.status} (attempts: ${stage.attempts})`);
  }
}

async function cmdRetry(args) {
  if (!args.slug) {
    console.error("Error: --slug is required for retry");
    process.exit(1);
  }
  const mode = args.mode || "dry-run";
  const lesson = await findLesson(args.slug);
  const payload = await buildWechatPayload(lesson);
  const key = idempotencyKey(lesson);

  const config = {
    mode,
    stateDir: args.state_dir || path.join(process.cwd(), "_artifacts", "wechat", "state"),
    maxRetries: 3,
    pollIntervalMs: 100,
    pollMaxAttempts: 20,
  };

  if (mode === "mock") {
    config.mockServerUrl = args.mock_url || "http://127.0.0.1:3000";
  }

  console.log(`Retrying ${args.slug} (key: ${key})...`);
  const result = await retryFailed(key, payload, config);
  console.log(`  Final status: ${result.state.final_status}`);
  console.log(`  Summary: ${result.state.summary}`);
}

async function cmdList(args) {
  const stateDir = args.state_dir || path.join(process.cwd(), "_artifacts", "wechat", "state");
  const records = await listPublishStates(stateDir);
  if (records.length === 0) {
    console.log("No publish records found.");
    return;
  }
  console.log(`Found ${records.length} publish record(s):`);
  for (const r of records) {
    console.log(`  [${r.final_status}] ${r.idempotency_key}`);
    if (r.article_url) console.log(`    URL: ${r.article_url}`);
    if (r.error_code) console.log(`    Error: ${r.error_code}`);
  }
}

// Main
const args = parseArgs(process.argv);

switch (args.command) {
  case "prepare":
    await cmdPrepare(args);
    break;
  case "publish":
    await cmdPublish(args);
    break;
  case "status":
    await cmdStatus(args);
    break;
  case "retry":
    await cmdRetry(args);
    break;
  case "list":
    await cmdList(args);
    break;
  default:
    console.error(`Unknown command: ${args.command || "(none)"}`);
    console.error("Usage: node scripts/wechat-publish.mjs <prepare|publish|status|retry|list> [options]");
    process.exit(1);
}
