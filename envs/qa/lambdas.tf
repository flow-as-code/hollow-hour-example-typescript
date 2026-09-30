# The six stub Lambdas the flows invoke, one per lambda: key in
# refs/manifest.json, each zipped straight from lambdas/<name>/ (a single
# dependency-free index.mjs; tests/lambdas.test.ts holds that shape).
#
# The address maps bind lambda:<name> to the instance association's
# function_arn, not to the function's arn. The value is the same ARN, but the
# reference makes every flow that invokes a function wait for its
# association: Connect runs only the functions associated with the instance
# (https://docs.aws.amazon.com/connect/latest/adminguide/connect-lambda-functions.html).

locals {
  stubs = toset([
    "caller-lookup",
    "classify-apparition",
    "crew-eta",
    "district-for-address",
    "plane-check",
    "prank-score",
  ])

  # What district-for-address and crew-eta read as HH_DISTRICTS: the same
  # districts.config.json the generator and the crew queues use.
  districts_env = jsonencode([for d in values(local.districts) : { slug = d.slug, name = d.name }])
}

data "aws_caller_identity" "current" {}

data "aws_connect_instance" "this" {
  instance_id = var.connect_instance_id
}

data "archive_file" "stub" {
  for_each = local.stubs

  type        = "zip"
  source_dir  = "${path.module}/../../lambdas/${each.key}"
  output_path = "${path.module}/build/lambda-${each.key}.zip"
}

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

# IAM names are global to the account, so the environment is in each name:
# two environments in one account never collide.
resource "aws_iam_role" "stub" {
  for_each = local.stubs

  name               = "${local.name_prefix}-${each.key}"
  description        = "Hollow Hour ${local.environment} stub Lambda ${each.key}."
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

# Created here rather than by the first invocation, so retention is set and
# `tofu destroy` removes it.
resource "aws_cloudwatch_log_group" "stub" {
  for_each = local.stubs

  name              = "/aws/lambda/${local.name_prefix}-${each.key}"
  retention_in_days = 14
}

# Logging to its own log group is the only permission a stub needs.
data "aws_iam_policy_document" "stub_logs" {
  for_each = local.stubs

  statement {
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.stub[each.key].arn}:*"]
  }
}

resource "aws_iam_role_policy" "stub_logs" {
  for_each = local.stubs

  name   = "logs"
  role   = aws_iam_role.stub[each.key].id
  policy = data.aws_iam_policy_document.stub_logs[each.key].json
}

resource "aws_lambda_function" "stub" {
  for_each = local.stubs

  function_name    = "${local.name_prefix}-${each.key}"
  description      = "Hollow Hour deterministic stub: ${each.key}."
  role             = aws_iam_role.stub[each.key].arn
  runtime          = "nodejs22.x"
  handler          = "index.handler"
  architectures    = ["arm64"]
  memory_size      = 128
  timeout          = 3
  filename         = data.archive_file.stub[each.key].output_path
  source_code_hash = data.archive_file.stub[each.key].output_base64sha256

  environment {
    variables = {
      HH_ENVIRONMENT = local.environment
      HH_DISTRICTS   = local.districts_env
    }
  }

  depends_on = [aws_cloudwatch_log_group.stub, aws_iam_role_policy.stub_logs]
}

# Connect may invoke the function from this instance only. Associating a
# function through the console adds an equivalent statement; whether the
# AssociateLambdaFunction API does is not documented, so the root states it
# (VERIFY.md, L2).
resource "aws_lambda_permission" "connect" {
  for_each = local.stubs

  statement_id   = "hollow-hour-connect"
  action         = "lambda:InvokeFunction"
  function_name  = aws_lambda_function.stub[each.key].function_name
  principal      = "connect.amazonaws.com"
  source_account = data.aws_caller_identity.current.account_id
  source_arn     = data.aws_connect_instance.this.arn
}

resource "aws_connect_lambda_function_association" "stub" {
  for_each = local.stubs

  instance_id  = var.connect_instance_id
  function_arn = aws_lambda_function.stub[each.key].arn

  depends_on = [aws_lambda_permission.connect]
}
