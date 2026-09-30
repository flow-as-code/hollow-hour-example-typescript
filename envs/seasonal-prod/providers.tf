# The seasonal root holds the greeting modules (seasonal/, out of the flow
# set) and their hand-written versions and `live` aliases. It is applied
# before envs/<environment>, which reads its outputs through
# terraform_remote_state.
#
# Why hand-written: flowascode emits a version and alias only for a module
# some flow in the same emitted set references, and nothing in seasonal/
# references the greetings (VERIFY.md, row 7).

terraform {
  required_version = ">= 1.8.0"

  required_providers {
    flowascode = {
      source  = "flow-as-code/flowascode"
      version = "~> 0.1.1"
    }
  }
}

provider "flowascode" {
  region = var.aws_region
}
