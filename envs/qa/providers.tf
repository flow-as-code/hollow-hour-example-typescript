# Provider requirements for this environment root. The emitted flows.tf
# (npm run emit:<profile>, gitignored) is copied in beside these files; the
# emitter writes no provider, credential or backend configuration of its own.
# flowascode takes hashicorp/aws's configuration vocabulary, so one region and
# one set of credentials serve both.
#
# The provider moves state across resource types, which needs Terraform 1.8
# or OpenTofu 1.10.

terraform {
  required_version = ">= 1.8.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    # The published provider: 0.1.1 on both registries on 2026-09-30. A 0.x
    # minor may change the schema, so the constraint stays within 0.1.
    flowascode = {
      source  = "flow-as-code/flowascode"
      version = "~> 0.1.1"
    }
    # Zips lambdas/<name>/ at plan time; nothing is built or committed.
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.7"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = local.tags
  }
}

provider "flowascode" {
  region = var.aws_region
}

locals {
  # Never a tfacc- prefix: the provider's acceptance sweeper deletes those.
  name_prefix = "hh-${local.environment}"

  tags = {
    "hollow-hour-example" = "true"
    "environment" = local.environment
  }
}
