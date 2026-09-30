# One Amazon Connect instance per environment, in that environment's Region.
# The alias is the instance's sign-in domain (<alias>.my.connect.aws), unique
# across every account, so it carries a random suffix.
# https://docs.aws.amazon.com/connect/latest/adminguide/amazon-connect-instances.html
# https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/connect_instance
#
# Nothing the Tier 1 roots create needs a user, a routing profile or a
# security profile, so none is made here; the tier that first needs one adds
# it. The provider returns only once each instance is ACTIVE.

resource "random_id" "suffix" {
  byte_length = 3
}

resource "aws_connect_instance" "env" {
  for_each = var.environments

  region                    = each.value
  instance_alias            = "hollow-hour-example-${each.key}-${random_id.suffix.hex}"
  identity_management_type  = "CONNECT_MANAGED"
  inbound_calls_enabled     = true
  outbound_calls_enabled    = true
  contact_flow_logs_enabled = true

  tags = {
    "environment" = each.key
  }
}
