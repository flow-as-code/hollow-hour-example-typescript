# Call recording storage, one bucket and one storage config per instance.
# On 2026-10-05 (17:25 UTC) `aws connect list-instance-storage-configs
# --resource-type CALL_RECORDINGS` returned no configuration on any of the
# three instances, so the recording blocks the flows set (hh-hotline-main's
# start-recording, hh-dead-line's record-agent-only) stored nothing. This is
# tier decision 5 (tasks/README.md): SSE-S3 on the bucket and no customer
# managed KMS key (the storage config's encryption block is optional, and a
# customer key is a monthly charge), public access blocked, ACLs disabled,
# and a lifecycle rule that expires recordings after 30 days. The bucket is
# in the instance's own Region.
# https://docs.aws.amazon.com/connect/latest/APIReference/API_AssociateInstanceStorageConfig.html
# https://docs.aws.amazon.com/connect/latest/adminguide/update-instance-settings.html
# https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/connect_instance_storage_config

resource "aws_s3_bucket" "recordings" {
  for_each = var.environments

  region = each.value
  bucket = "hollow-hour-example-${each.key}-recordings-${random_id.suffix.hex}"

  tags = {
    "environment" = each.key
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "recordings" {
  for_each = var.environments

  region = each.value
  bucket = aws_s3_bucket.recordings[each.key].id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "recordings" {
  for_each = var.environments

  region = each.value
  bucket = aws_s3_bucket.recordings[each.key].id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "recordings" {
  for_each = var.environments

  region = each.value
  bucket = aws_s3_bucket.recordings[each.key].id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "recordings" {
  for_each = var.environments

  region = each.value
  bucket = aws_s3_bucket.recordings[each.key].id

  rule {
    id     = "expire-recordings"
    status = "Enabled"

    filter {}

    expiration {
      days = 30
    }
  }
}

resource "aws_connect_instance_storage_config" "call_recordings" {
  for_each = var.environments

  region        = each.value
  instance_id   = aws_connect_instance.env[each.key].id
  resource_type = "CALL_RECORDINGS"

  storage_config {
    storage_type = "S3"

    s3_config {
      bucket_name   = aws_s3_bucket.recordings[each.key].id
      bucket_prefix = "connect/${aws_connect_instance.env[each.key].instance_alias}/CallRecordings"
    }
  }

  depends_on = [aws_s3_bucket_public_access_block.recordings]
}
