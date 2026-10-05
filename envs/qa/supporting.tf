# What the flows refer to, created per environment in that environment's own
# instance. Every address here is one refs/<profile>.tfmap.json binds; the
# districts come from the same districts.config.json the generator reads, so a
# new district gets its crew queue without an edit here.
#
# The stub Lambdas and their instance associations are in lambdas.tf; the
# recorded hold prompt, its bucket and its object are at the end of this file.

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

# The recorded hold prompt (T2, the A/B split in hh-queue-experience-<slug>):
# a private bucket for the audio, the committed prompts/salt-line-tips.wav as
# its one object, and the Connect prompt made from it through awscc, which
# every profile binds as prompt:salt-line-tips. The audio is synthesized once
# from prompts/salt-line-tips.txt, the copy source tests/copy.test.ts scans
# (tasks/README.md, tier decision 4; the command is in envs/README.md). Which
# principal reads the object at CreatePrompt (the resource type's handlers
# say the caller), what bucket policy that needs, and which audio format the
# service accepts are settled by the first dev apply (VERIFY.md, row P1);
# until then the bucket carries no policy.
#
# The object's key carries the file's MD5, so a regenerated wav changes the
# key and with it the prompt's s3_uri: the same apply replaces the object
# (the resource address is unchanged, so the old object is deleted) and
# awscc updates the prompt in place (S3Uri is not a create-only property of
# AWS::Connect::Prompt), keeping prompt_arn and every flow binding. A fixed
# key would re-put the object and leave the prompt playing the old audio.
# https://docs.aws.amazon.com/connect/latest/APIReference/API_CreatePrompt.html
# https://docs.aws.amazon.com/connect/latest/adminguide/prompts.html

# Bucket names are global across AWS, so the account id keeps
# hh-<environment>-prompts unique; it is read at plan time, never committed.
resource "aws_s3_bucket" "prompts" {
  bucket = "${local.name_prefix}-prompts-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "prompts" {
  bucket = aws_s3_bucket.prompts.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "prompts" {
  bucket = aws_s3_bucket.prompts.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "prompts" {
  bucket = aws_s3_bucket.prompts.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_object" "salt_line_tips" {
  bucket       = aws_s3_bucket.prompts.id
  key          = "salt-line-tips-${filemd5("${path.module}/../../prompts/salt-line-tips.wav")}.wav"
  source       = "${path.module}/../../prompts/salt-line-tips.wav"
  source_hash  = filemd5("${path.module}/../../prompts/salt-line-tips.wav")
  content_type = "audio/wav"

  depends_on = [
    aws_s3_bucket_public_access_block.prompts,
    aws_s3_bucket_ownership_controls.prompts,
    aws_s3_bucket_server_side_encryption_configuration.prompts,
  ]
}

# awscc has no default_tags, so the prompt carries the module's two tags
# itself, as a set of {key, value} objects rather than a map;
# tests/envRoots.test.ts holds them equal to local.tags.
resource "awscc_connect_prompt" "salt_line_tips" {
  instance_arn = data.aws_connect_instance.this.arn
  name         = "${local.name_prefix}-salt-line-tips"
  description  = "The recorded variant of the hold tips, for the A/B split in the queue flows."
  s3_uri       = "s3://${aws_s3_object.salt_line_tips.bucket}/${aws_s3_object.salt_line_tips.key}"
  tags         = [for key, value in local.tags : { key = key, value = value }]
}
