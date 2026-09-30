# The greeting modules are out of the flow set on purpose: they live in
# envs/seasonal-<environment>, applied first, and the flows reach them through
# module:greeting@live, which each profile's address map binds to one of this
# data source's outputs. Switching the season is changing that binding.

data "terraform_remote_state" "seasonal" {
  backend = "s3"

  config = {
    bucket = var.seasonal_state.bucket
    key    = var.seasonal_state.key
    region = var.seasonal_state.region
  }
}
