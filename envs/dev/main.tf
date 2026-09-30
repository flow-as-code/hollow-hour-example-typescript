# How this root gets its flows.
#
# `npm run emit:<profile>` runs
#
#   flow-cli emit flows/ --target flowascode \
#     --address-map refs/<profile>.tfmap.json --out build/emit/<profile>
#
# and copies the emitted flows.tf into this directory (gitignored; see
# scripts/emit.mjs). It lands here, in the root module, rather than being
# called as a module from build/, because every value in the address map is an
# address in this root: aws_connect_queue.crew["old-town"].arn and the rest
# resolve only where those resources are declared. The emitted variables.tf is
# not copied; variables.tf here already declares connect_instance_id.
#
# The emitted resources are one flowascode_contact_flow per FlowDoc in flows/,
# named after the FlowDoc (hh-hotline-main becomes
# flowascode_contact_flow.hh_hotline_main), with a refs map that binds each
# ${cdref:...} key the flow makes. Nothing here names them, so this file does
# not change when a flow is added or renamed.
#
# The reverse matters as much: with flows.tf absent a plan would read as
# "delete every deployed flow". The guard below refuses to plan in that state.

resource "terraform_data" "flow_set" {
  input = local.environment

  lifecycle {
    precondition {
      condition = length(try(regexall(
        "resource \"flowascode_contact_flow\"",
        file("${path.module}/flows.tf"),
      ), [])) > 0
      error_message = "flows.tf is missing or holds no flow. Run `npm run emit:<profile>` before planning: without it, the plan would delete every deployed flow."
    }
  }
}

output "environment" {
  description = "The environment this root deployed."
  value       = local.environment
}

output "lambda_function_names" {
  description = "The stub functions, by lambda: key name, for logs and a manual invoke."
  value       = { for name, fn in aws_lambda_function.stub : name => fn.function_name }
}
