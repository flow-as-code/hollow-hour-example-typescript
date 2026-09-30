# The only file that differs between envs/dev, envs/qa and envs/prod
# (tests/envRoots.test.ts holds that). Everything else an environment needs is
# supplied at plan time: the instance through TF_VAR_connect_instance_id, the
# region through TF_VAR_aws_region, the state location through
# -backend-config. None of them is ever committed.

locals {
  environment = "qa"

  # The most contacts any one queue holds before a transfer takes its
  # QueueAtCapacity branch (the crew-full overflow and the lines-busy copy).
  # dev and qa keep it small, so an operator can fill a queue with two test
  # contacts and exercise those paths live.
  queue_max_contacts = 2
}
