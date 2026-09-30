# What the other roots are given at plan time: TF_VAR_connect_instance_id and
# TF_VAR_aws_region from the environment's entry, the -backend-config bucket
# and region from the state outputs. Read them with `tofu output`; never
# commit them.

output "instances" {
  description = "Each environment's Connect instance: id, alias and Region."
  value = {
    for env, instance in aws_connect_instance.env : env => {
      id     = instance.id
      alias  = instance.instance_alias
      region = instance.region
    }
  }
}

output "state_bucket" {
  description = "The S3 bucket every root keeps its state in."
  value       = aws_s3_bucket.state.bucket
}

output "state_region" {
  description = "The Region of that bucket, and so the -backend-config region of every root."
  value       = aws_s3_bucket.state.region
}
