#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const region = process.env.AWS_REGION || 'us-east-1';
const url = `https://${region}.console.aws.amazon.com/amazonq/developer/home?region=${region}`;
const stateDir = path.join(process.cwd(), '.consilium', 'runs', 'playwright', 'aws-q-pro-fix');
fs.mkdirSync(stateDir, { recursive: true });
const logFile = path.join(stateDir, `network-${Date.now()}.log`);

function log(line) {
  fs.appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`);
  console.log(line);
}

function interesting(u='') {
  return /user-subscriptions|codewhisperer|q\.us-east-1|q\.amazonaws|subscriptions|identitycenter|sso|signin\.aws\.amazon\.com/i.test(u);
}

async function clickByText(page, words) {
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const rx = new RegExp(escaped, 'i');
  const targets = [
    page.getByRole('button', { name: rx }),
    page.getByRole('link', { name: rx }),
    page.getByText(rx),
  ];
  for (const t of targets) {
    try {
      const first = t.first();
      if (await first.isVisible({ timeout: 450 })) {
        await first.click({ timeout: 1800 });
        log(`CLICK_TEXT /${escaped}/`);
        return true;
      }
    } catch {}
  }
  return false;
}

async function ensurePage(context) {
  const pages = context.pages().filter((p) => !p.isClosed());
  const page = pages[0] || await context.newPage();
  return page;
}

async function main() {
  const context = await chromium.launchPersistentContext(stateDir, {
    channel: 'chrome',
    headless: false,
    args: ['--start-maximized'],
  });

  context.on('request', (req) => {
    const u = req.url();
    if (!interesting(u)) return;
    const h = req.headers();
    const tgt = h['x-amz-target'] || '';
    const ct = h['content-type'] || '';
    let body = '';
    try { body = (req.postData() || '').slice(0, 900).replace(/\s+/g, ' '); } catch {}
    log(`REQ ${req.method()} ${u} target=${tgt} ct=${ct} body=${body}`);
  });

  context.on('response', (res) => {
    const u = res.url();
    if (!interesting(u)) return;
    log(`RES ${res.status()} ${u}`);
  });

  let page = await ensurePage(context);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  log(`OPEN ${url}`);
  log(`NETWORK_LOG ${logFile}`);

  const deadline = Date.now() + 15 * 60 * 1000;
  while (Date.now() < deadline) {
    try {
      if (page.isClosed()) {
        page = await ensurePage(context);
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        log('REOPEN_PAGE');
      }

      await clickByText(page, ['Sign in', 'Continue']);
      await clickByText(page, ['Subscriptions', 'Billing', 'Manage subscriptions', 'Users', 'Team members']);
      await clickByText(page, ['Get started', 'Enable', 'Subscribe', 'Upgrade', 'Assign users', 'Assign user', 'Create claim', 'Add users', 'Add subscription', 'Save', 'Confirm', 'Continue']);
      await clickByText(page, ['Pro', 'Q Developer Pro', 'Amazon Q Developer Pro']);
      await clickByText(page, ['q-developer-user', 'Q Developer User', 'ilja.rehemae@gmail.com']);

      await page.waitForTimeout(1600);
    } catch (e) {
      log(`LOOP_ERR ${String(e?.message || e)}`);
      await new Promise((r) => setTimeout(r, 900));
    }
  }

  await context.close();
  log('DONE timeout');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
