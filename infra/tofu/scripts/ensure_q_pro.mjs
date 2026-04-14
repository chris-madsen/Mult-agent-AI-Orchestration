#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";

const CODEWHISPERER_PROVIDER_ARN =
  "arn:aws:sso::aws:applicationProvider/codewhisperer";

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {
    region: "us-east-1",
    timeoutSec: 900,
    stateDir: ".consilium/runs/playwright/aws-q",
  };

  for (let i = 0; i < args.length; i += 1) {
    const k = args[i];
    const v = args[i + 1];
    if (k === "--region" && v) {
      out.region = v;
      i += 1;
    } else if (k === "--timeout-sec" && v) {
      out.timeoutSec = Number(v);
      i += 1;
    } else if (k === "--state-dir" && v) {
      out.stateDir = v;
      i += 1;
    }
  }
  return out;
}

function runAwsJson(args) {
  const proc = spawnSync("aws", [...args, "--output", "json"], {
    encoding: "utf8",
  });
  if (proc.status !== 0) {
    const stderr = (proc.stderr || "").trim();
    throw new Error(`AWS CLI failed: aws ${args.join(" ")}\n${stderr}`);
  }
  return JSON.parse(proc.stdout);
}

function getInstanceArn(region) {
  const data = runAwsJson(["sso-admin", "list-instances", "--region", region]);
  const instances = data.Instances || [];
  if (instances.length === 0) {
    throw new Error(`No IAM Identity Center instance found in ${region}`);
  }
  return instances[0].InstanceArn;
}

function getCodewhispererApps(region, instanceArn) {
  const data = runAwsJson([
    "sso-admin",
    "list-applications",
    "--region",
    region,
    "--instance-arn",
    instanceArn,
    "--filter",
    `ApplicationProvider=${CODEWHISPERER_PROVIDER_ARN}`,
  ]);
  return data.Applications || [];
}

async function tryClickKnownControls(page) {
  const selectors = [
    "button:has-text('Get started')",
    "button:has-text('Create application')",
    "button:has-text('Create Application')",
    "button:has-text('Create profile')",
    "button:has-text('Continue')",
    "button:has-text('Subscribe')",
    "button:has-text('Enable')",
    "a:has-text('Get started')",
    "a:has-text('Create application')",
  ];

  for (const selector of selectors) {
    try {
      const locator = page.locator(selector).first();
      const visible = await locator.isVisible({ timeout: 700 });
      if (!visible) {
        continue;
      }
      await locator.click({ timeout: 2500 });
      return true;
    } catch {
      // continue to next selector
    }
  }
  return false;
}

async function ensureQApp(region, timeoutSec, stateDirInput) {
  const instanceArn = getInstanceArn(region);
  const existing = getCodewhispererApps(region, instanceArn);
  if (existing.length > 0) {
    const app = existing[0];
    console.log(
      `Managed app already exists: ${app.Name} (${app.ApplicationArn})`,
    );
    return 0;
  }

  const stateDir = path.isAbsolute(stateDirInput)
    ? stateDirInput
    : path.join(process.cwd(), stateDirInput);
  fs.mkdirSync(stateDir, { recursive: true });

  const url = `https://${region}.console.aws.amazon.com/amazonq/developer/home?region=${region}`;
  const deadline = Date.now() + timeoutSec * 1000;
  let context;
  let launchErr;

  const launchPlans = [
    { channel: "chrome", headless: false, args: ["--start-maximized"] },
    { headless: false, args: ["--start-maximized"] },
  ];

  for (const plan of launchPlans) {
    try {
      context = await chromium.launchPersistentContext(stateDir, plan);
      break;
    } catch (err) {
      launchErr = err;
    }
  }
  if (!context) {
    throw new Error(`Cannot launch browser: ${launchErr}`);
  }

  let page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
  await page.goto(url, { waitUntil: "domcontentloaded" });

  console.log("Browser opened for Amazon Q Developer onboarding.");
  console.log("If prompted, complete AWS login/MFA/CAPTCHA in the browser.");
  console.log("Automation will continue and stop when managed app is created.");

  let clickedAny = false;
  while (Date.now() < deadline) {
    if (page.isClosed()) {
      const openPages = context.pages();
      page = openPages.length > 0 ? openPages[0] : await context.newPage();
      await page.goto(url, { waitUntil: "domcontentloaded" });
    }

    const apps = getCodewhispererApps(region, instanceArn);
    if (apps.length > 0) {
      const app = apps[0];
      console.log(`Managed app detected: ${app.Name} (${app.ApplicationArn})`);
      await context.close();
      return 0;
    }

    let clicked = false;
    try {
      await page.waitForLoadState("domcontentloaded", { timeout: 2000 });
      clicked = await tryClickKnownControls(page);
    } catch {
      // ignore and continue
    }

    if (clicked) {
      clickedAny = true;
      await new Promise((resolve) => setTimeout(resolve, 1800));
      continue;
    }

    try {
      await page.reload({ waitUntil: "domcontentloaded", timeout: 10000 });
    } catch {
      // ignore
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  await context.close();
  if (clickedAny) {
    console.error("Timed out after UI actions, managed app not detected.");
  } else {
    console.error("Timed out: no actionable onboarding controls were detected.");
  }
  return 1;
}

async function main() {
  const args = parseArgs();
  const code = await ensureQApp(args.region, args.timeoutSec, args.stateDir);
  process.exit(code);
}

main().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
});
