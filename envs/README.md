# envs/

One OpenTofu or Terraform root per environment, each applied to its own Amazon
Connect instance.

- `dev/`, `qa/`, `prod/`: the flows (an emitted `flows.tf`, copied in by
  `npm run emit:<profile>` and gitignored; `main.tf` says why it lands in the
  root and refuses to plan without it) and the resources they refer to:
  queues and hours (`supporting.tf`), and the six stub Lambdas with their
  roles, log groups, invoke permission and instance association
  (`lambdas.tf`, zipping `lambdas/<name>/` into the gitignored `build/`).
- `seasonal-dev/`, `seasonal-qa/`, `seasonal-prod/`: the greeting modules
  (their emitted `flows.tf`) and a hand-written version and `live` alias for
  each (`greetings.tf`), applied first; the flow root reads the two alias ARNs
  through `terraform_remote_state`. The season is chosen by the deploy
  profile's address map, not here.

Every root needs its emitted `flows.tf` to plan: run
`npm run emit:<profile>` first. `npm run validate` needs nothing emitted: it
runs `tofu init -backend=false` and `tofu validate` over all six roots, plus
`prod` with the October emit, each with its profile emitted into a temporary
copy. `tests/validate.test.ts` does the same inside `npm test` whenever
OpenTofu and the registry are reachable. Each root commits its
`.terraform.lock.hcl` (`npm run lock:providers`), identical within each group.

Everything the aws provider creates is named `hh-<environment>-*` and tagged
`hollow-hour=true` and `environment=<environment>`; nothing is ever named
with the provider sweeper's `tfacc-` prefix.

Within each group the roots are byte-identical except `environment.tf`
(`tests/envRoots.test.ts`). The instance id, region and state location are
supplied at plan time (`TF_VAR_connect_instance_id`, `TF_VAR_aws_region`,
`TF_VAR_seasonal_state`, `-backend-config`), never committed.
`prod-october` is a profile, not a root: it applies to `envs/prod`.

## The deploy role

What `deploy.yml`'s role (or your own credentials) needs, by what the roots
manage. Scope each statement to the environment's instance, the
`hh-<environment>-*` names and the state bucket; no account id, ARN or bucket
name is written here, because none is ever committed.

| For                                  | Actions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| State (S3 backend)                   | `s3:ListBucket` on the bucket; `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` on `hollow-hour/<environment>/*`                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| The instance                         | `connect:DescribeInstance`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Queues and hours (`supporting.tf`)   | `connect:CreateQueue`, `connect:DescribeQueue`, `connect:UpdateQueue*`, `connect:DeleteQueue`, `connect:CreateHoursOfOperation`, `connect:DescribeHoursOfOperation`, `connect:UpdateHoursOfOperation`, `connect:DeleteHoursOfOperation`, `connect:TagResource`, `connect:UntagResource`, `connect:ListTagsForResource`                                                                                                                                                                                                                                              |
| Flows, modules, versions and aliases | `connect:CreateContactFlow`, `connect:DescribeContactFlow`, `connect:UpdateContactFlow*`, `connect:DeleteContactFlow`, `connect:CreateContactFlowModule`, `connect:DescribeContactFlowModule`, `connect:UpdateContactFlowModule*`, `connect:DeleteContactFlowModule`, `connect:CreateContactFlowModuleVersion`, `connect:DeleteContactFlowModuleVersion`, `connect:ListContactFlowModuleVersions`, `connect:CreateContactFlowModuleAlias`, `connect:DescribeContactFlowModuleAlias`, `connect:UpdateContactFlowModuleAlias`, `connect:DeleteContactFlowModuleAlias` |
| Lambda association                   | `connect:AssociateLambdaFunction`, `connect:DisassociateLambdaFunction`, `connect:ListLambdaFunctions`                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Stub Lambdas (`lambdas.tf`)          | `lambda:CreateFunction`, `lambda:GetFunction*`, `lambda:UpdateFunction*`, `lambda:DeleteFunction`, `lambda:AddPermission`, `lambda:RemovePermission`, `lambda:GetPolicy`, `lambda:ListVersionsByFunction`, `lambda:TagResource`, `lambda:ListTags`                                                                                                                                                                                                                                                                                                                  |
| Their roles                          | `iam:CreateRole`, `iam:GetRole`, `iam:DeleteRole`, `iam:TagRole`, `iam:PutRolePolicy`, `iam:GetRolePolicy`, `iam:DeleteRolePolicy`, `iam:ListRolePolicies`, `iam:ListAttachedRolePolicies`, `iam:ListInstanceProfilesForRole`, `iam:PassRole` (to `lambda.amazonaws.com`)                                                                                                                                                                                                                                                                                           |
| Their log groups                     | `logs:CreateLogGroup`, `logs:DeleteLogGroup`, `logs:PutRetentionPolicy`, `logs:DescribeLogGroups`, `logs:TagResource`, `logs:ListTagsForResource`                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Plan-time reads                      | `sts:GetCallerIdentity`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |

The flowascode provider's own Connect calls are the flow and module rows; its
documentation is the authority when it adds one. This list comes from the
resources the roots declare and has not yet been exercised by a live apply
(T1 criterion 10): the first apply of dev records any refusal in
[`VERIFY.md`](../VERIFY.md) and here.

## First apply

The flow root reads the greeting alias ARNs from the seasonal root's state
(`seasonal.tf`), so the seasonal root must be applied before the flow root
can even be planned. `deploy.yml` checks for that state after the seasonal
step and refuses to plan the flow root without it; a first dispatch should
have `apply` checked, which applies the seasonal root and then plans and
applies the flow root in the same run.
