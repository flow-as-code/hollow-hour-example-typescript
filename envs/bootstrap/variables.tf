# Regions are not secrets, so they have committed defaults: the ones this
# repository's own environments use. Override them with -var or TF_VAR_<name>.
# The default quota is two Connect instances per account and Region
# (VERIFY.md, H3): check `aws service-quotas get-service-quota --service-code
# connect --quota-code L-AA17A6B9` and `aws connect list-instances` in each
# Region before putting more than one environment there.

variable "environments" {
  description = "Each environment and the Region its Connect instance lives in."
  type        = map(string)
  default = {
    dev  = "us-west-2"
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
