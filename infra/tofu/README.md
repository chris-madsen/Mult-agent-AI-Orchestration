# Consilium AWS Setup (OpenTofu)

This directory contains OpenTofu code to manage:

- IAM user: `q-developer-user`
- IAM role: `QDeveloperUserRole`
- IAM policy attachments for Amazon Q Developer
- IAM Identity Center account instance
- IAM Identity Center user and group
- Custom IAM Identity Center application and user assignment
- Amazon Q Developer managed app bootstrap and user assignment automation
- Amazon Q subscription prerequisites (service-linked roles and AWS Organizations guard)

## Prerequisites

- AWS CLI authenticated with admin permissions in account `165518479016`
- OpenTofu installed
- AWS CLI available in PATH for OpenTofu local-exec bootstrap

## Usage

```bash
cd infra/tofu
tofu init
tofu plan -var 'identity_center_user_email=ilja.rehemae@gmail.com'
tofu apply -auto-approve -var 'identity_center_user_email=ilja.rehemae@gmail.com'
```

## Notes

- Default AWS region in this stack is `us-east-1`.
- The stack bootstraps an IAM Identity Center instance in the selected region.
- AWS account quota allows only one IAM Identity Center instance per account.
- If the account already has an instance in another region, set
  `identity_center_region` to that home region.
- This stack targets standalone account instances of IAM Identity Center.
- The stack ensures required service-linked roles exist:
  - `AWSServiceRoleForAmazonQDeveloper`
  - `AWSServiceRoleForUserSubscriptions`
- If AWS Organizations is not enabled, this stack continues to work in standalone mode by default.
- Optional strict mode: set `-var 'fail_if_organization_missing_for_q_subscription=true'` to fail fast when Organizations is missing.
- Optional: to let this stack auto-create Organizations (ALL features), set:
  `-var 'ensure_organization_for_q_subscription=true'`
- Important: if an IAM Identity Center **account instance** was created before Organizations was enabled, it remains an account instance. For some Amazon Q Developer Pro capabilities (AWS console/web app usage), AWS requires an **organization instance** in the management account.
- `ssoadmin` permission set/account assignment resources are not created because AWS does not support those APIs for standalone account instances.
- The stack creates `aws_ssoadmin_application_assignment` for `q-developer-user` when Amazon Q managed app exists.
- By default, the stack does not create a custom Identity Center application (`create_custom_identity_center_application=false`).
- Playwright bootstrap is disabled by default (`auto_create_q_managed_app=false`).
- If explicitly enabled, `tofu apply` runs Playwright bootstrap (`scripts/ensure_q_pro.mjs`) and then retries assignment.
- If needed, override `region`:

```bash
tofu apply -auto-approve \
  -var 'region=us-east-1' \
  -var 'identity_center_region=us-east-1' \
  -var 'identity_center_user_email=ilja.rehemae@gmail.com'
```

If your account does not have AWS Organizations enabled and you want IaC to fix it:

```bash
tofu apply -auto-approve \
  -var 'region=us-east-1' \
  -var 'identity_center_user_email=ilja.rehemae@gmail.com' \
  -var 'ensure_organization_for_q_subscription=true'
```

- `iam_q_developer_policy_arn` defaults to:
  `arn:aws:iam::aws:policy/AmazonQDeveloperAccess`
- Amazon Q Developer Pro subscription and Q profile activation are performed in the Amazon Q Developer console workflow for standalone accounts:
  https://docs.aws.amazon.com/amazonq/latest/qdeveloper-ug/subscribe-standalone.html

## Browser Automation For Q Managed App

AWS requires managed app creation through Amazon Q Developer console integration.
This directory includes Playwright automation for the UI onboarding step.

Prerequisites:

```bash
export NVM_DIR="$HOME/.nvm"
. "$NVM_DIR/nvm.sh"
nvm use 22.3.0
cd infra/tofu
npm install
npx playwright install chromium
```

Run automation in `us-east-1`:

```bash
npm run q:ensure
```

Direct run with custom timeout:

```bash
node ./scripts/ensure_q_pro.mjs --region us-east-1 --timeout-sec 1200
```

After managed app is created, authenticate Q CLI:

```bash
q login --license pro --region us-east-1 --identity-provider https://d-906608821d.awsapps.com/start --use-device-flow
q whoami
q profile
```
