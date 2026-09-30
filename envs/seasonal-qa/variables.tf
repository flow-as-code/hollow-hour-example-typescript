variable "connect_instance_id" {
  description = "The Amazon Connect instance this environment deploys to. Supply it as TF_VAR_connect_instance_id; never commit it."
  type        = string
}

variable "aws_region" {
  description = "The region of that instance."
  type        = string
}
