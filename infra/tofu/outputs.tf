output "account_id" {
  description = "Current AWS account ID."
  value       = data.aws_caller_identity.current.account_id
}

output "sso_instance_arn" {
  description = "IAM Identity Center instance ARN."
  value       = local.sso_instance_arn
}

output "identity_store_id" {
  description = "IAM Identity Center identity store ID."
  value       = local.identity_store_id
}

output "identity_center_start_url" {
  description = "IAM Identity Center start URL."
  value       = local.identity_start_url
}

output "iam_user_arn" {
  description = "IAM user ARN for q-developer-user."
  value       = aws_iam_user.q_developer_user.arn
}

output "iam_role_arn" {
  description = "IAM role ARN for QDeveloperUserRole."
  value       = aws_iam_role.q_developer_user_role.arn
}

output "identity_center_user_id" {
  description = "Identity Center user ID."
  value       = aws_identitystore_user.q_developer_user.user_id
}

output "identity_center_group_id" {
  description = "Identity Center group ID."
  value       = aws_identitystore_group.q_developer_group.group_id
}

output "q_managed_app_present" {
  description = "Whether the Amazon Q Developer managed app exists in this account instance."
  value       = tonumber(data.external.q_managed_app_status.result.count) > 0
}

output "q_managed_app_arn" {
  description = "Amazon Q Developer managed app ARN if present."
  value       = data.external.q_managed_app_status.result.application_arn
}

output "q_managed_app_name" {
  description = "Amazon Q Developer managed app name if present."
  value       = data.external.q_managed_app_status.result.application_name
}

output "q_developer_user_application_assignment_id" {
  description = "Application assignment ID for q-developer-user."
  value       = try(aws_ssoadmin_application_assignment.q_developer_user_assignment[0].id, "")
}

output "custom_identity_center_application_arn" {
  description = "Custom IAM Identity Center application ARN."
  value       = try(aws_ssoadmin_application.custom_q_application[0].application_arn, "")
}

output "custom_identity_center_application_name" {
  description = "Custom IAM Identity Center application name."
  value       = try(aws_ssoadmin_application.custom_q_application[0].name, "")
}

output "custom_identity_center_application_assignment_id" {
  description = "Assignment ID of q-developer-user to custom application."
  value       = try(aws_ssoadmin_application_assignment.custom_q_application_user_assignment[0].id, "")
}
