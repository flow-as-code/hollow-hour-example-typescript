# Partial configuration: the bucket, key and region are given at init with
# -backend-config (deploy.yml passes them from the GitHub environment), so no
# account's bucket name is written here. `tofu init -backend=false` is enough
# for `npm run validate`.

terraform {
  backend "s3" {}
}
