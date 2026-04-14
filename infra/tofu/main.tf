data "aws_caller_identity" "current" {}

resource "terraform_data" "q_subscription_prerequisites" {
  provisioner "local-exec" {
    command     = <<-EOT
      set -euo pipefail

      ensure_role() {
        local service_name="$1"
        local role_name="$2"
        if aws iam get-role --role-name "$role_name" >/dev/null 2>&1; then
          echo "Service-linked role already exists: $role_name"
          return 0
        fi
        echo "Creating service-linked role: $role_name ($service_name)"
        aws iam create-service-linked-role --aws-service-name "$service_name" >/dev/null
      }

      if [ "${var.ensure_q_service_linked_roles}" = "true" ]; then
        ensure_role "q.amazonaws.com" "AWSServiceRoleForAmazonQDeveloper"
        ensure_role "user-subscriptions.amazonaws.com" "AWSServiceRoleForUserSubscriptions"
      fi

      if aws organizations describe-organization >/dev/null 2>&1; then
        echo "AWS Organizations is enabled."
        exit 0
      fi

      if [ "${var.ensure_organization_for_q_subscription}" = "true" ]; then
        echo "AWS Organizations is not enabled. Creating organization with ALL features."
        aws organizations create-organization --feature-set ALL >/dev/null
        for i in $(seq 1 30); do
          if aws organizations describe-organization >/dev/null 2>&1; then
            echo "AWS Organizations created."
            exit 0
          fi
          sleep 2
        done
        echo "AWS Organizations did not become available in time." >&2
        exit 1
      fi

      if [ "${var.fail_if_organization_missing_for_q_subscription}" = "true" ]; then
        echo "AWS Organizations is not enabled. Amazon Q Developer Pro subscription can fail with 'Account does not meet requirements for this operation'. Set ensure_organization_for_q_subscription=true or enable Organizations manually." >&2
        exit 1
      fi

      echo "AWS Organizations is not enabled, continuing because fail_if_organization_missing_for_q_subscription=false."
    EOT
    interpreter = ["/bin/bash", "-c"]
  }
}

resource "terraform_data" "identity_center_instance" {
  depends_on = [terraform_data.q_subscription_prerequisites]

  provisioner "local-exec" {
    command     = <<-EOT
      set -euo pipefail
      REGION="${local.identity_center_region}"
      NAME="${var.identity_center_instance_name}"
      EXISTING=$(aws sso-admin list-instances --region "$REGION" --query 'Instances[0].InstanceArn' --output text || true)
      if [ -z "$EXISTING" ] || [ "$EXISTING" = "None" ]; then
        aws sso-admin create-instance --name "$NAME" --region "$REGION" >/dev/null
      fi
      for i in $(seq 1 30); do
        CURR=$(aws sso-admin list-instances --region "$REGION" --query 'Instances[0].InstanceArn' --output text || true)
        if [ -n "$CURR" ] && [ "$CURR" != "None" ]; then
          exit 0
        fi
        sleep 2
      done
      echo "Identity Center instance was not created in time" >&2
      exit 1
    EOT
    interpreter = ["/bin/bash", "-c"]
  }
}

data "aws_ssoadmin_instances" "current" {
  provider   = aws.identity_center
  depends_on = [terraform_data.identity_center_instance]
}

locals {
  identity_center_region = var.identity_center_region != "" ? var.identity_center_region : var.region
  sso_instance_arn       = one(data.aws_ssoadmin_instances.current.arns)
  identity_store_id      = one(data.aws_ssoadmin_instances.current.identity_store_ids)
  identity_start_url     = "https://${one(data.aws_ssoadmin_instances.current.identity_store_ids)}.awsapps.com/start"
  iam_user_name          = var.iam_user_name
  iam_role_name          = var.iam_role_name
  sso_given_name         = "Q"
  sso_family_name        = "Developer"
  sso_user_name          = var.identity_center_user_name
  sso_display_name       = "Q Developer User"
  account_id             = data.aws_caller_identity.current.account_id
}

resource "aws_iam_user" "q_developer_user" {
  name = local.iam_user_name
  depends_on = [
    terraform_data.identity_center_instance
  ]

  tags = {
    ManagedBy = "tofu"
    Project   = "consilium"
  }
}

resource "aws_iam_user_policy_attachment" "q_developer_user_policy" {
  user       = aws_iam_user.q_developer_user.name
  policy_arn = var.iam_q_developer_policy_arn
}

resource "aws_iam_role" "q_developer_user_role" {
  name = local.iam_role_name
  depends_on = [
    terraform_data.identity_center_instance
  ]

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "sso.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  tags = {
    ManagedBy = "tofu"
    Project   = "consilium"
  }
}

resource "aws_iam_role_policy_attachment" "q_developer_role_policy" {
  role       = aws_iam_role.q_developer_user_role.name
  policy_arn = var.iam_q_developer_policy_arn
}

resource "aws_identitystore_user" "q_developer_user" {
  provider = aws.identity_center

  identity_store_id = local.identity_store_id
  display_name      = local.sso_display_name
  user_name         = local.sso_user_name

  name {
    given_name  = local.sso_given_name
    family_name = local.sso_family_name
  }

  emails {
    value   = var.identity_center_user_email
    type    = "work"
    primary = true
  }
}

resource "aws_identitystore_group" "q_developer_group" {
  provider = aws.identity_center

  identity_store_id = local.identity_store_id
  display_name      = var.identity_center_group_name
  description       = "Group for Consilium Q Developer access"
}

resource "aws_identitystore_group_membership" "q_developer_group_membership" {
  provider = aws.identity_center

  identity_store_id = local.identity_store_id
  group_id          = aws_identitystore_group.q_developer_group.group_id
  member_id         = aws_identitystore_user.q_developer_user.user_id
}

resource "aws_ssoadmin_application" "custom_q_application" {
  provider = aws.identity_center
  count    = var.create_custom_identity_center_application ? 1 : 0

  instance_arn             = local.sso_instance_arn
  application_provider_arn = var.custom_application_provider_arn
  name                     = var.custom_identity_center_application_name
  description              = "Custom IAM Identity Center app for Consilium access flow"

  depends_on = [
    terraform_data.identity_center_instance,
    aws_identitystore_user.q_developer_user
  ]
}

resource "aws_ssoadmin_application_assignment" "custom_q_application_user_assignment" {
  provider = aws.identity_center
  count    = var.create_custom_identity_center_application ? 1 : 0

  application_arn = aws_ssoadmin_application.custom_q_application[0].application_arn
  principal_id    = aws_identitystore_user.q_developer_user.user_id
  principal_type  = "USER"

  depends_on = [
    aws_ssoadmin_application.custom_q_application,
    aws_identitystore_group_membership.q_developer_group_membership
  ]
}

resource "terraform_data" "q_managed_app_bootstrap" {
  depends_on = [
    terraform_data.identity_center_instance,
    aws_identitystore_user.q_developer_user
  ]

  provisioner "local-exec" {
    command     = <<-EOT
      set -euo pipefail
      Q_REGION="${var.region}"
      IDENTITY_CENTER_REGION="${local.identity_center_region}"
      INSTANCE_ARN="${local.sso_instance_arn}"
      PROVIDER_ARN="${var.q_application_provider_arn}"
      SHOULD_BOOTSTRAP="${var.auto_create_q_managed_app}"
      NODE_VERSION="${var.node_version}"

      COUNT=$(aws sso-admin list-applications \
        --region "$IDENTITY_CENTER_REGION" \
        --instance-arn "$INSTANCE_ARN" \
        --filter "ApplicationProvider=$PROVIDER_ARN" \
        --query 'length(Applications)' \
        --output text)

      if [ "$COUNT" != "0" ]; then
        echo "Amazon Q managed app already exists, skipping bootstrap."
        exit 0
      fi

      if [ "$SHOULD_BOOTSTRAP" != "true" ]; then
        echo "Amazon Q managed app missing and auto bootstrap is disabled."
        exit 0
      fi

      cd "${path.module}"

      if command -v node >/dev/null 2>&1; then
        NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
      else
        NODE_MAJOR=0
      fi

      if [ "$NODE_MAJOR" -lt 18 ] && [ -s "$HOME/.nvm/nvm.sh" ]; then
        # shellcheck disable=SC1090
        . "$HOME/.nvm/nvm.sh"
        nvm use "$NODE_VERSION" >/dev/null || nvm install "$NODE_VERSION" >/dev/null
      fi

      if ! command -v node >/dev/null 2>&1; then
        echo "Node.js not found; cannot run Playwright bootstrap." >&2
        exit 1
      fi

      if [ ! -d "${path.module}/node_modules/playwright" ]; then
        npm install
      fi

      npx playwright install chromium

      set +e
      node ./scripts/ensure_q_pro.mjs --region "$Q_REGION" --timeout-sec "${var.q_managed_app_create_timeout_sec}"
      ENSURE_RC=$?
      set -e

      POST_COUNT=$(aws sso-admin list-applications \
        --region "$IDENTITY_CENTER_REGION" \
        --instance-arn "$INSTANCE_ARN" \
        --filter "ApplicationProvider=$PROVIDER_ARN" \
        --query 'length(Applications)' \
        --output text)

      if [ "$POST_COUNT" != "0" ]; then
        echo "Amazon Q managed app detected after bootstrap."
        exit 0
      fi

      echo "Managed app is still missing after bootstrap attempt (exit code: $ENSURE_RC)." >&2
      exit 1
    EOT
    interpreter = ["/bin/bash", "-c"]
  }
}

data "external" "q_managed_app_status" {
  depends_on = [
    terraform_data.identity_center_instance,
    terraform_data.q_managed_app_bootstrap
  ]

  program = [
    "bash",
    "-lc",
    <<-EOT
      set -euo pipefail
      REGION="${local.identity_center_region}"
      INSTANCE_ARN="${local.sso_instance_arn}"
      PROVIDER_ARN="${var.q_application_provider_arn}"

      COUNT=$(aws sso-admin list-applications \
        --region "$REGION" \
        --instance-arn "$INSTANCE_ARN" \
        --filter "ApplicationProvider=$PROVIDER_ARN" \
        --query 'length(Applications)' \
        --output text)

      APP_ARN=$(aws sso-admin list-applications \
        --region "$REGION" \
        --instance-arn "$INSTANCE_ARN" \
        --filter "ApplicationProvider=$PROVIDER_ARN" \
        --query 'Applications[0].ApplicationArn' \
        --output text)

      APP_NAME=$(aws sso-admin list-applications \
        --region "$REGION" \
        --instance-arn "$INSTANCE_ARN" \
        --filter "ApplicationProvider=$PROVIDER_ARN" \
        --query 'Applications[0].Name' \
        --output text)

      if [ "$APP_ARN" = "None" ]; then APP_ARN=""; fi
      if [ "$APP_NAME" = "None" ]; then APP_NAME=""; fi

      printf '{"count":"%s","application_arn":"%s","application_name":"%s"}\n' "$COUNT" "$APP_ARN" "$APP_NAME"
    EOT
  ]
}

resource "terraform_data" "q_managed_app_guard" {
  input = data.external.q_managed_app_status.result

  lifecycle {
    precondition {
      condition     = var.fail_if_q_managed_app_missing ? tonumber(data.external.q_managed_app_status.result.count) > 0 : true
      error_message = "Amazon Q Developer managed app is missing. Open Amazon Q Developer console in the same region and run Get started/Create application first."
    }
  }
}

resource "aws_ssoadmin_application_assignment" "q_developer_user_assignment" {
  provider = aws.identity_center
  count    = var.manage_q_managed_app_assignment ? 1 : 0

  application_arn = data.external.q_managed_app_status.result.application_arn
  principal_id    = aws_identitystore_user.q_developer_user.user_id
  principal_type  = "USER"

  depends_on = [
    terraform_data.q_managed_app_guard,
    aws_identitystore_group_membership.q_developer_group_membership
  ]
}
