#!/usr/bin/env python3
"""Ensure Amazon Q Developer managed app exists in standalone Identity Center.

Flow:
1) Check Identity Center instance and existing codewhisperer managed app.
2) If missing, open AWS console in a visible Chromium session.
3) Repeatedly attempt to click known onboarding buttons.
4) Exit success when the managed app appears in AWS API.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright


CODEWHISPERER_PROVIDER_ARN = "arn:aws:sso::aws:applicationProvider/codewhisperer"


def run_aws_json(args: list[str]) -> dict:
    proc = subprocess.run(
        ["aws", *args, "--output", "json"],
        check=False,
        text=True,
        capture_output=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            "AWS CLI failed: "
            + " ".join(args)
            + "\n"
            + proc.stderr.strip()
        )
    return json.loads(proc.stdout)


def get_instance_arn(region: str) -> str:
    payload = run_aws_json(["sso-admin", "list-instances", "--region", region])
    instances = payload.get("Instances", [])
    if not instances:
        raise RuntimeError(
            f"No IAM Identity Center instance found in region {region}."
        )
    return instances[0]["InstanceArn"]


def get_codewhisperer_apps(region: str, instance_arn: str) -> list[dict]:
    payload = run_aws_json(
        [
            "sso-admin",
            "list-applications",
            "--region",
            region,
            "--instance-arn",
            instance_arn,
            "--filter",
            f"ApplicationProvider={CODEWHISPERER_PROVIDER_ARN}",
        ]
    )
    return payload.get("Applications", [])


def try_click_known_controls(page) -> bool:
    selectors = [
        "button:has-text('Get started')",
        "button:has-text('Create application')",
        "button:has-text('Create Application')",
        "button:has-text('Create profile')",
        "button:has-text('Continue')",
        "button:has-text('Subscribe')",
        "button:has-text('Enable')",
        "a:has-text('Get started')",
        "a:has-text('Create application')",
    ]
    for selector in selectors:
        locator = page.locator(selector).first
        try:
            if locator.is_visible(timeout=700):
                locator.click(timeout=2000)
                return True
        except PlaywrightTimeoutError:
            continue
        except Exception:
            continue
    return False


def open_console_and_ensure(
    region: str,
    instance_arn: str,
    timeout_sec: int,
    state_dir: Path,
) -> int:
    console_url = (
        f"https://{region}.console.aws.amazon.com/amazonq/developer/home"
        f"?region={region}"
    )
    deadline = time.time() + timeout_sec

    with sync_playwright() as p:
        state_dir.mkdir(parents=True, exist_ok=True)
        context = None
        last_error: Exception | None = None

        for launch_opts in (
            {"channel": "chrome", "headless": False, "args": ["--start-maximized"]},
            {"headless": False, "args": ["--start-maximized"]},
        ):
            try:
                context = p.chromium.launch_persistent_context(
                    user_data_dir=str(state_dir),
                    **launch_opts,
                )
                break
            except Exception as exc:
                last_error = exc

        if context is None:
            raise RuntimeError(f"Cannot launch browser: {last_error}")

        page = context.pages[0] if context.pages else context.new_page()
        page.goto(console_url, wait_until="domcontentloaded")

        print(
            "Browser opened for Amazon Q Developer onboarding.\n"
            "If AWS asks for login/MFA/CAPTCHA, complete it in the browser window.\n"
            "Automation will continue after authentication.",
            flush=True,
        )

        clicked_any = False
        while time.time() < deadline:
            apps = get_codewhisperer_apps(region, instance_arn)
            if apps:
                app = apps[0]
                print(
                    f"Managed app detected: {app.get('Name')} "
                    f"({app.get('ApplicationArn')})",
                    flush=True,
                )
                context.close()
                return 0

            try:
                page.wait_for_load_state("domcontentloaded", timeout=2000)
            except Exception:
                pass

            if try_click_known_controls(page):
                clicked_any = True
                time.sleep(2)
            else:
                try:
                    page.reload(wait_until="domcontentloaded", timeout=10000)
                except Exception:
                    pass
                time.sleep(2)

        context.close()
        if clicked_any:
            print(
                "Timed out waiting for managed app creation after UI actions.",
                file=sys.stderr,
            )
        else:
            print(
                "Timed out without finding actionable controls in the UI.",
                file=sys.stderr,
            )
        return 1


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Ensure Amazon Q Developer managed app exists."
    )
    parser.add_argument("--region", default="us-east-1")
    parser.add_argument("--timeout-sec", type=int, default=900)
    parser.add_argument(
        "--state-dir",
        default=".consilium/runs/playwright/aws-q",
        help="Persistent browser profile directory.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    state_dir = Path(args.state_dir)
    if not state_dir.is_absolute():
        state_dir = Path.cwd() / state_dir

    instance_arn = get_instance_arn(args.region)
    existing = get_codewhisperer_apps(args.region, instance_arn)
    if existing:
        app = existing[0]
        print(
            f"Managed app already exists: {app.get('Name')} "
            f"({app.get('ApplicationArn')})"
        )
        return 0

    return open_console_and_ensure(
        region=args.region,
        instance_arn=instance_arn,
        timeout_sec=args.timeout_sec,
        state_dir=state_dir,
    )


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
