# What the flows refer to, created per environment in that environment's own
# instance. Every address here is one refs/<profile>.tfmap.json binds; the
# districts come from the same districts.config.json the generator reads, so a
# new district gets its crew queue without an edit here.
#
# The stub Lambdas and their instance associations are in lambdas.tf. The
# prompt lands with T2 PR 7; tests/envRoots.test.ts lists the addresses still
# pending.

locals {
  districts = {
    for d in jsondecode(file("${path.module}/../../districts.config.json")).districts :
    d.slug => d
  }

  shared_queues = {
    "lantern-crew"      = "The Lantern Crew: Hostile and Chorus grades."
    "dispatch-overflow" = "Fallback when every other route errors or is full."
    "the-dead"          = "The Queue of the Dead, staffed by spectral liaisons."
  }

  days = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"]
}

# 24x7 is 12:00 AM to 12:00 AM on every day
# (https://docs.aws.amazon.com/connect/latest/adminguide/set-hours-operation.html,
# "Schedule for 24x7"). VERIFY.md: needs a sandbox create through the provider.
resource "aws_connect_hours_of_operation" "always_open" {
  instance_id = var.connect_instance_id
  name        = "${local.name_prefix}-always-open"
  description = "Open around the clock."
  time_zone   = "America/New_York"

  dynamic "config" {
    for_each = local.days
    content {
      day = config.value
      start_time {
        hours   = 0
        minutes = 0
      }
      end_time {
        hours   = 0
        minutes = 0
      }
    }
  }
}

# The living crews' night shift, 4 pm to 6 am. The admin guide documents
# midnight as an end time but not a range that crosses it, so each day carries
# two ranges instead of one that wraps: 12:00 AM to 6:00 AM and 4:00 PM to
# 12:00 AM. VERIFY.md: needs a sandbox create.
resource "aws_connect_hours_of_operation" "night_shift" {
  instance_id = var.connect_instance_id
  name        = "${local.name_prefix}-night-shift"
  description = "Living crews: 4 pm to 6 am."
  time_zone   = "America/New_York"

  dynamic "config" {
    for_each = local.days
    content {
      day = config.value
      start_time {
        hours   = 0
        minutes = 0
      }
      end_time {
        hours   = 6
        minutes = 0
      }
    }
  }

  dynamic "config" {
    for_each = local.days
    content {
      day = config.value
      start_time {
        hours   = 16
        minutes = 0
      }
      end_time {
        hours   = 0
        minutes = 0
      }
    }
  }
}

# Closed hours for scenario S4 (the after-hours callback), substituted for a
# district's hours at run time and read by no flow. Nothing else here is ever
# closed (always_open, night_shift and the dead's hours all open every day),
# and the provider's resource needs at least one config block, so this one is
# open for one minute a week, Sunday 03:00 to 03:01 America/New_York, and S4
# is never run in that minute. VERIFY.md, row HC1: needs a sandbox create,
# and a CheckHoursOfOperation reading it as closed outside that minute.
# https://docs.aws.amazon.com/connect/latest/APIReference/API_CreateHoursOfOperation.html
resource "aws_connect_hours_of_operation" "closed" {
  instance_id = var.connect_instance_id
  name        = "${local.name_prefix}-closed"
  description = "Closed, for the after-hours scenario: open one minute a week."
  time_zone   = "America/New_York"

  config {
    day = "SUNDAY"
    start_time {
      hours   = 3
      minutes = 0
    }
    end_time {
      hours   = 3
      minutes = 1
    }
  }
}

# Every queue is capped at local.queue_max_contacts (environment.tf), so
# QueueAtCapacity can fire; an uncapped queue never takes that branch.
# https://docs.aws.amazon.com/connect/latest/adminguide/set-maximum-queue-limit.html
#
# Queues use always_open: the flows gate on hours explicitly through the
# hours:* references, so a queue's own hours never decide routing here and
# prod and prod-october can share one set of queues.
resource "aws_connect_queue" "crew" {
  for_each = local.districts

  instance_id           = var.connect_instance_id
  name                  = "${local.name_prefix}-${each.key}-crew"
  description           = "${each.value.name} crew."
  hours_of_operation_id = aws_connect_hours_of_operation.always_open.hours_of_operation_id
  max_contacts          = local.queue_max_contacts
}

resource "aws_connect_queue" "shared" {
  for_each = local.shared_queues

  instance_id           = var.connect_instance_id
  name                  = "${local.name_prefix}-${each.key}"
  description           = each.value
  hours_of_operation_id = aws_connect_hours_of_operation.always_open.hours_of_operation_id
  max_contacts          = local.queue_max_contacts
}
