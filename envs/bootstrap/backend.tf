# Partial configuration, as in every other root: the bucket, key and region
# are given at init with -backend-config, so no bucket name is committed.
#
# The very first apply has no bucket to keep its state in yet. It runs with a
# gitignored local_override.tf that switches this root to the local backend;
# once the bucket exists, removing that file and running
# `tofu init -migrate-state` moves the state into the bucket it created.
# envs/README.md, "Bootstrap", has the exact commands.

terraform {
  backend "s3" {}
}
