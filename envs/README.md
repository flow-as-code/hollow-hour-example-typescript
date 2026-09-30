# envs/

One OpenTofu or Terraform root per environment, each applied to its own Amazon
Connect instance, and one bootstrap root that creates those instances and the
state bucket.

- `bootstrap/`: the three Connect instances and the S3 state bucket, applied
  once by an operator (see [Bootstrap](#bootstrap)), never by `deploy.yml`.

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
copy, and over `bootstrap`. `tests/validate.test.ts` does the same inside `npm test` whenever
OpenTofu and the registry are reachable. Each root commits its
`.terraform.lock.hcl` (`npm run lock:providers`), identical within each group.

Everything the aws provider creates is named `hh-<environment>-*` and tagged
`hollow-hour-example=true` and `environment=<environment>`; nothing is ever named
with the provider sweeper's `tfacc-` prefix.

Within each group the roots are byte-identical except `environment.tf`
(`tests/envRoots.test.ts`). The instance id, region and state location are
supplied at plan time (`TF_VAR_connect_instance_id`, `TF_VAR_aws_region`,
`TF_VAR_seasonal_state`, `-backend-config`), never committed. The state
bucket's Region is its own: every root's `-backend-config` region is the
bucket's, even where the instance is in another Region (dev).
`prod-october` is a profile, not a root: it applies to `envs/prod`.

## Bootstrap

`bootstrap/` creates what the other roots assume: one Connect instance per
environment (Connect-managed identity, inbound and outbound calls and flow
logs on, alias `hollow-hour-example-<environment>-<suffix>`) in that
environment's Region, and one S3 bucket for every root's state (versioned,
encrypted, public access blocked, `prevent_destroy`), locked by the S3
backend's lock object rather than a DynamoDB table. The Regions default to
this repository's own (dev `us-west-2`, qa and prod `us-east-1`, the bucket
`us-east-1`); override them with `-var` or `TF_VAR_environments` and
`TF_VAR_state_region`. Tier 1 needs no user, routing profile or security
profile, so the root creates none.

Check the instance quota first. The default is two per account and Region
(VERIFY.md, H3):

```sh
aws service-quotas get-service-quota --service-code connect \
  --quota-code L-AA17A6B9 --region us-west-2
aws connect list-instances --region us-west-2
# and again for each Region an environment uses
```

A new instance can also come up with a "Concurrent active calls per
instance" quota of 0, which the documentation gives as 10 by default. It is
an instance-level quota, and a contact over it is refused. On 2026-09-30 the
qa instance read 0.0 while dev and prod read 10.0 (read again at 20:30 and
20:47 UTC), and S2 on qa failed to start with "Failed to start execution of
test case due to limit reached." (VERIFY.md, S2). That the 0 quota caused it
is inferred, not observed: the quotas page's "How contacts are counted" does
not say whether a `flow-cli simulate` test case counts. Read it for each
instance, by the instance's ARN (from `aws connect describe-instance`, never
committed), in the instance's Region:

```sh
aws service-quotas get-service-quota --service-code connect \
  --quota-code L-12AB7C57 --context-id <instance arn> --region <region>
```

If it reads 0, request the default back and follow the request:

```sh
aws service-quotas request-service-quota-increase --service-code connect \
  --quota-code L-12AB7C57 --context-id <instance arn> --desired-value 10 \
  --region <region>
aws service-quotas list-requested-service-quota-change-history-by-quota \
  --service-code connect --quota-code L-12AB7C57 \
  --quota-requested-at-level RESOURCE --region <region>
```

`L-12AB7C57` is a resource-level quota, and without
`--quota-requested-at-level RESOURCE` the history comes back empty: on
2026-09-30 at 20:46 UTC it listed nothing in us-east-1 or us-west-2, and with
the flag us-east-1 listed the qa request.

The qa request, made at 2026-09-30T20:12:35Z, went to AWS Support as a case
rather than being applied on the spot: at 20:46 UTC it read `CASE_OPENED`,
last updated at 20:15:43 UTC, so allow for a wait
([quotas](https://docs.aws.amazon.com/connect/latest/adminguide/amazon-connect-service-limits.html)).

The first apply has no bucket to hold its state, so it runs on local state
through a gitignored override, then moves that state into the bucket it has
just created. It needs OpenTofu 1.10 or later (`use_lockfile`) installed as
`tofu` on PATH (the commands here and `npm run validate` call it by that
name; see [Installing OpenTofu](https://opentofu.org/docs/intro/install/),
and check with `tofu version`), and credentials that can create Connect
instances (with the directory and service-linked role they bring) and S3
buckets.

```sh
cd envs/bootstrap
printf 'terraform {\n  backend "local" {}\n}\n' > local_override.tf
tofu init
tofu plan -out=bootstrap.tfplan
tofu apply bootstrap.tfplan   # waits until each instance is ACTIVE

bucket=$(tofu output -raw state_bucket)
state_region=$(tofu output -raw state_region)
rm local_override.tf
tofu init -migrate-state -force-copy \
  -backend-config="bucket=$bucket" \
  -backend-config="key=hollow-hour-example/bootstrap.tfstate" \
  -backend-config="region=$state_region" \
  -backend-config="use_lockfile=true"
tofu state list   # reads from the bucket now
```

Creating several instances in one apply can be refused for one of them
while the others are still being created. On 2026-09-30 the first bootstrap
apply created dev (us-west-2) and prod (us-east-1), and refused qa
(us-east-1) with `ServiceQuotaExceededException: Currently pending instance
creation requests, if successfully executed, will reach instance count quota
for account: <account> Please retry once pending requests have completed and
quota limit is not reached.` (status 402), although us-east-1 had no
instance before the apply. Once the others were ACTIVE, planning and
applying again created qa. The other resources in the apply are unaffected,
so run the migration below after the retry, not before.

Confirm the state object is in the bucket too:

```sh
aws s3api head-object --bucket "$bucket" \
  --key hollow-hour-example/bootstrap.tfstate --region "$state_region"
```

Once both read it back, delete any `terraform.tfstate` and
`terraform.tfstate.backup` left in the directory (both gitignored). Until
then that local file is the only record of three instances and a bucket, so
run the migration straight after the apply. From then on, and from any fresh
clone, run the same `tofu init` with those four `-backend-config` values and
no override.

A fresh clone cannot read the bucket name from `tofu output`, because that
reads the state the bucket holds. Keep it in the GitHub variable
`TF_STATE_BUCKET`, or find it again with:

```sh
aws s3api list-buckets \
  --query "Buckets[?starts_with(Name,'hollow-hour-example-tfstate-')].Name" \
  --output text
```

Each instance's flow logs go to a CloudWatch log group that Connect creates
with the instance, `/aws/connect/<alias>`, which no root manages and which
keeps its logs indefinitely by default (VERIFY.md, H4). Give each one the
retention the stub Lambda groups have:

```sh
tofu output -json instances   # each environment's alias and Region
aws logs put-retention-policy --log-group-name /aws/connect/<alias> \
  --retention-in-days 14 --region <that environment's Region>
```

`tofu output instances` gives each environment's instance id and Region:
`TF_VAR_connect_instance_id` and `TF_VAR_aws_region` for that environment's
roots (the GitHub environment's `CONNECT_INSTANCE_ID` and `AWS_REGION`).
`state_bucket` and `state_region` are every root's `-backend-config` bucket
and region (`TF_STATE_BUCKET` and `TF_STATE_REGION`). None of them is
committed.

## Teardown

In this order; each step needs the one before it to have finished.

1. For each environment, destroy the flow root and then its seasonal root
   (the flow root reads the seasonal root's state, and its flows refer to the
   greeting aliases). Export the same `TF_VAR_connect_instance_id`,
   `TF_VAR_aws_region` and `TF_VAR_seasonal_state` as for the apply, emit the
   same profile (`npm run emit:<profile>`, since every root needs its
   `flows.tf` to plan), and init with the same four `-backend-config` values:

   ```sh
   tofu -chdir=envs/<environment> init -backend-config=...   # as for the apply
   tofu -chdir=envs/<environment> destroy
   tofu -chdir=envs/seasonal-<environment> init -backend-config=...
   tofu -chdir=envs/seasonal-<environment> destroy
   ```

2. Move the bootstrap state out of the bucket it is about to delete, back to
   local state:

   ```sh
   cd envs/bootstrap
   printf 'terraform {\n  backend "local" {}\n}\n' > local_override.tf
   tofu init -migrate-state -force-copy
   tofu state list   # reads from the local file now
   bucket=$(tofu output -raw state_bucket)
   state_region=$(tofu output -raw state_region)
   ```

   Steps 3 to 6 run in this same shell, from `envs/bootstrap`; step 4 needs
   `bucket` and `state_region`.

3. Destroy the instances alone. `prevent_destroy` on the bucket fails any plan
   that would delete it, so a plain `tofu destroy` refuses here:

   ```sh
   tofu destroy -target=aws_connect_instance.env
   ```

   Then delete each instance's flow log group, `/aws/connect/<alias>`, if it
   is still there (VERIFY.md, H4):

   ```sh
   aws logs delete-log-group --log-group-name /aws/connect/<alias> \
     --region <that environment's Region>
   ```

4. Empty the bucket. It is versioned and has no `force_destroy`, so deleting
   it while any object version or delete marker remains fails with
   `BucketNotEmpty`. Delete every version and every delete marker (the
   console's "Empty" action does both), then check that nothing is left:

   ```sh
   aws s3api list-object-versions --bucket "$bucket" --region "$state_region" \
     --query '{v: length(Versions || `[]`), m: length(DeleteMarkers || `[]`)}'
   ```

5. Remove the `lifecycle { prevent_destroy = true }` block from
   `state.tf` on purpose, as a local edit you do not commit, and destroy the
   rest:

   ```sh
   tofu destroy
   ```

6. Delete `local_override.tf` and the local `terraform.tfstate*`, and restore
   `state.tf` (`git checkout envs/bootstrap/state.tf`). That discards the
   uncommitted edit from step 5, so the guard is back for the next bootstrap.

`tests/envBootstrap.test.ts` holds this order.

## The deploy role

What `deploy.yml`'s role (or your own credentials) needs, by what the roots
manage. Scope each statement to the environment's instance, the
`hh-<environment>-*` names and the state bucket; no account id, ARN or bucket
name is written here, because none is ever committed.

| For                                  | Actions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| State (S3 backend)                   | `s3:ListBucket` on the bucket; `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` on `hollow-hour-example/<environment>/*`                                                                                                                                                                                                                                                                                                                                                                                                                                           |
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

## Deploying by hand

The same sequence `deploy.yml` runs, for one environment: plan to a file,
read the plan, then apply that saved plan, so what is applied is exactly
what was reviewed. Never `apply -auto-approve`.

```sh
npm run emit:<profile>
tofu -chdir=envs/seasonal-<environment> init -backend-config=...   # the four values
tofu -chdir=envs/seasonal-<environment> plan -out=seasonal.tfplan
tofu -chdir=envs/seasonal-<environment> apply seasonal.tfplan
tofu -chdir=envs/<environment> init -backend-config=...
tofu -chdir=envs/<environment> plan -out=flows.tfplan
tofu -chdir=envs/<environment> apply flows.tfplan
```

The `.tfplan` files are gitignored. A plan is refused at apply time once
the state has changed since it was made; plan again.

A `.terraform/` directory made before the repository was moved to another
path can still point at the old location. Delete them all and init again
with the same `-backend-config` values: `rm -rf envs/*/.terraform`.

## Checking drift

`npm run drift -- <profile>` compares every FlowDoc in `flows/` and
`seasonal/` with the flow or module of the same name on that profile's
instance, action by action, and exits 1 on any difference. It reads the
instance from `TF_VAR_connect_instance_id` and `TF_VAR_aws_region`, or else
from the gitignored `.live/instances.json` (`{ "<environment>": { "id",
"region" } }`), and only lists and describes flows and modules. With
`scenarios/<profile>.resources.json` present (`node scenarios/resource-map.mjs
<profile>`), each reference is compared through the keys that bind it, so a
reference moved to another resource is drift. A reference the map does not
bind keeps its own identity (the token's key, or a short hash of the ARN), so
two unmapped references never compare equal. Without the map, only its type is
compared. An error message is printed with ARNs, ids and account ids redacted.
`tests/drift.test.ts` holds the normalizer.

Connect throttles these calls per account and Region, shared by every
instance and caller there: 2 requests per second, burst 5
([API throttling quotas](https://docs.aws.amazon.com/connect/latest/adminguide/amazon-connect-service-limits.html#connect-api-quotas)).
On 2026-09-30 a dev run failed with "Too Many Requests". The check now
spaces its calls 500 ms apart and retries a throttling refusal
(`TooManyRequestsException`, `ThrottlingException`, HTTP 429, or a message
containing "too many requests" in any case) up to six times, with
exponential backoff from 1 s capped at 20 s and full jitter, printing each
retry; `tests/drift.test.ts` holds that against a stubbed
client. At 20:29 UTC the same day the paced check ran on dev in 7 s and
reported "No drift.".

Use it instead of `flow-cli diff flows/ --instance <ARN>` for now. The
0.2.0 CLI turns each live ARN into a token named after the physical
resource (`queue:hh-dev-old-town-crew`) while the FlowDocs use the logical
key (`queue:old-town-crew`), and it has no option to map one to the other,
so it reports every flow that carries a reference as changed. On 2026-09-30
(UTC) it reported 8 of the 10 dev flows as changed, with no difference but
those names, and exited 1; at 19:57 UTC `npm run drift -- dev` and
`npm run drift -- qa` each reported all 12 FlowDocs unchanged and exited 0. `flow-cli diff seasonal/` has no references to rename
and exits 0.

Both need `@aws-sdk/client-connect`. It is an optional peer dependency of
`@flow-as-code/cli`, loaded only by the commands that talk to an instance
(`diff --instance`, `simulate`, `export`), so npm does not install it with
the CLI. This repository pins it as an exact devDependency (3.1144.0), which
`flow-cli diff`, `flow-cli simulate` and `npm run drift` all use.

## First apply

The flow root reads the greeting alias ARNs from the seasonal root's state
(`seasonal.tf`), so the seasonal root must be applied before the flow root
can even be planned. `deploy.yml` checks for that state after the seasonal
step and refuses to plan the flow root without it; a first dispatch should
have `apply` checked, which applies the seasonal root and then plans and
applies the flow root in the same run.
