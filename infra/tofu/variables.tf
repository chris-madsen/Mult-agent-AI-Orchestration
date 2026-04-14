variable "region" {
  description = "AWS region used for IAM Identity Center and IAM setup."
  type        = string
  default     = "us-east-1"
}

variable "identity_center_region" {
  description = "IAM Identity Center home region. Leave empty to use var.region."
  type        = string
  default     = ""
}

variable "identity_center_instance_name" {
  description = "Name for IAM Identity Center instance."
  type        = string
  default     = "ConsiliumIdentityCenter"
}

variable "identity_center_user_email" {
  description = "Email for the Identity Center user."
  type        = string
}

variable "identity_center_user_name" {
  description = "Username for the Identity Center user."
  type        = string
  default     = "q-developer-user"
}

variable "identity_center_group_name" {
  description = "Identity Center group that receives account assignment."
  type        = string
  default     = "QDeveloperGroup"
}

variable "iam_user_name" {
  description = "IAM user name for Q Developer access user."
  type        = string
  default     = "q-developer-user"
}

variable "iam_role_name" {
  description = "IAM role name for Q Developer access role."
  type        = string
  default     = "QDeveloperUserRole"
}

variable "iam_q_developer_policy_arn" {
  description = "Managed policy attached to IAM user and IAM role."
  type        = string
  default     = "arn:aws:iam::aws:policy/AmazonQDeveloperAccess"
}

variable "q_application_provider_arn" {
  description = "Managed application provider for Amazon Q Developer in IAM Identity Center."
  type        = string
  default     = "arn:aws:sso::aws:applicationProvider/codewhisperer"
}

variable "manage_q_managed_app_assignment" {
  description = "Manage assignment of q-developer-user to Amazon Q managed app (requires app to exist)."
  type        = bool
  default     = false
}

variable "fail_if_q_managed_app_missing" {
  description = "Fail plan/apply when Q managed application is not yet created in Amazon Q Developer console."
  type        = bool
  default     = false
}

variable "auto_create_q_managed_app" {
  description = "Try to create Amazon Q Developer managed app during apply via Playwright automation."
  type        = bool
  default     = false
}

variable "q_managed_app_create_timeout_sec" {
  description = "Timeout for managed app bootstrap automation."
  type        = number
  default     = 1200
}

variable "node_version" {
  description = "Preferred Node.js version for Playwright bootstrap via nvm."
  type        = string
  default     = "22.3.0"
}

variable "create_custom_identity_center_application" {
  description = "Create custom IAM Identity Center application."
  type        = bool
  default     = false
}

variable "ensure_q_service_linked_roles" {
  description = "Ensure service-linked roles required by Amazon Q Developer subscriptions exist."
  type        = bool
  default     = true
}

variable "ensure_organization_for_q_subscription" {
  description = "Create AWS Organizations organization (ALL features) when missing, to satisfy Q Developer Pro subscription prerequisites."
  type        = bool
  default     = false
}

variable "fail_if_organization_missing_for_q_subscription" {
  description = "Fail apply when AWS Organizations is not enabled and automatic creation is disabled."
  type        = bool
  default     = false
}

variable "custom_identity_center_application_name" {
  description = "Display name for custom IAM Identity Center application."
  type        = string
  default     = "Consilium-QDeveloper-CustomApp"
}

variable "custom_application_provider_arn" {
  description = "Application provider ARN for custom IAM Identity Center app."
  type        = string
  default     = "arn:aws:sso::aws:applicationProvider/custom"
}
