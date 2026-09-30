# The two greetings and the `live` alias each one runs as.
#
# `npm run emit:<profile>` copies the flows.tf it emits from seasonal/ in
# beside this file (gitignored): flowascode_contact_flow_module.hh_greeting_standard
# and flowascode_contact_flow_module.hh_greeting_halloween, one per FlowDoc
# there. The emitter writes no version or alias for them, because no flow in
# seasonal/ invokes them (VERIFY.md, rows 7 and 7b), so this file does, in the
# shape of the flow-as-code cookbook's module-release.tf.
#
# The season is not chosen here. Both aliases always exist, and each deploy
# profile's address map binds module:greeting@live to one of the two outputs
# below: prod binds the standard greeting, prod-october the Halloween one
# (refs/manifest.json). deploy.yml's `season` input picks the profile, so
# turning the season on or off is a change of one binding in the flow root,
# visible in a refs diff, and rolling back is the same change reversed.

locals {
  greetings = {
    standard  = flowascode_contact_flow_module.hh_greeting_standard
    halloween = flowascode_contact_flow_module.hh_greeting_halloween
  }
}

# A version is a snapshot of the module's current content, replaced whenever
# that content changes. create_before_destroy makes the new version exist
# before the old one goes, and the alias moves to it in place in between:
# Connect refuses to delete a version an alias still points at.
resource "flowascode_contact_flow_module_version" "greeting" {
  for_each = local.greetings

  instance_id            = var.connect_instance_id
  contact_flow_module_id = each.value.contact_flow_module_id
  content_hash           = each.value.content_hash
  description            = "hh-greeting-${each.key} as reviewed (${local.environment})"

  lifecycle {
    create_before_destroy = true
  }
}

# The alias is what flows bind: its arn is the module ARN qualified by the
# alias id, the only form Connect runs as the alias.
resource "flowascode_contact_flow_module_alias" "greeting_live" {
  for_each = local.greetings

  instance_id                 = var.connect_instance_id
  contact_flow_module_id      = each.value.contact_flow_module_id
  name                        = "live"
  contact_flow_module_version = flowascode_contact_flow_module_version.greeting[each.key].version
  description                 = "The ${each.key} greeting callers hear when the profile binds it"
}

output "greeting_standard_live_arn" {
  description = "module:greeting@live for the standard season (dev, qa, prod)."
  value       = flowascode_contact_flow_module_alias.greeting_live["standard"].arn
}

output "greeting_halloween_live_arn" {
  description = "module:greeting@live for October (prod-october)."
  value       = flowascode_contact_flow_module_alias.greeting_live["halloween"].arn
}
