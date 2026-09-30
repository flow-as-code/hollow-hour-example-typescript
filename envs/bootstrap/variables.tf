# Regions are not secrets, so they have committed defaults: the ones this
# repository's own environments use, all three in us-east-1 (the
# Terraform-first repository keeps its three in us-west-2, so the two never
# share a Region). Override them with -var or TF_VAR_<name>.
# The default quota is two Connect instances per account and Region
# (VERIFY.md, H3), so these defaults need it raised to at least 3 in
# us-east-1: check `aws service-quotas get-service-quota --service-code
# connect --quota-code L-AA17A6B9` and `aws connect list-instances` there, and
# request more with `request-service-quota-increase` (envs/README.md,
# Bootstrap). Changing an environment's Region here replaces its instance;
# see envs/README.md, "Moving an environment to another Region".

variable "environments" {
  description = "Each environment and the Region its Connect instance lives in."
  type        = map(string)
  default = {
    dev  = "us-east-1"
    qa   = "us-east-1"
    prod = "us-east-1"
  }

  validation {
    condition     = alltrue([for env in keys(var.environments) : contains(["dev", "qa", "prod"], env)])
    error_message = "The environments are dev, qa and prod; each has a root under envs/."
  }
}

variable "state_region" {
  description = "The Region of the state bucket. It is the -backend-config region of every root, whatever Region that root's instance is in."
  type        = string
  default     = "us-east-1"
}
