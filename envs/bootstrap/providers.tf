# The bootstrap root: what every other root under envs/ assumes already
# exists. Applied by an operator with their own credentials, never by
# deploy.yml. envs/README.md, "Bootstrap", has the order of commands.
#
# The S3 backend's use_lockfile (a lock object beside the state, no DynamoDB
# table) needs OpenTofu 1.10 or Terraform 1.10.
# https://opentofu.org/docs/language/settings/backends/s3/

terraform {
  required_version = ">= 1.10.0"

  required_providers {
    # 6.0 added the per-resource region argument that lets one provider
    # create an instance in each environment's Region.
    # https://registry.terraform.io/providers/hashicorp/aws/latest/docs/guides/enhanced-region-support
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.7"
    }
  }
}

# The provider's own Region is the state bucket's; each instance names its
# own with the resource-level region argument.
provider "aws" {
  region = var.state_region

  default_tags {
    tags = {
      "hollow-hour-example" = "true"
    }
  }
}
