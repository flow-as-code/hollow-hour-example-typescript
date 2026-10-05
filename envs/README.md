# envs/

One OpenTofu or Terraform root per environment, each applied to its own Amazon
Connect instance, and one bootstrap root that creates those instances and the
state bucket.

- `bootstrap/`: the three Connect instances and the S3 state bucket, applied
  once by an operator (see [Bootstrap](#bootstrap)), never by `deploy.yml`.

- `dev/`, `qa/`, `prod/`: the flows (an emitted `flows.tf`, copied in by
  `npm run emit:<profile>` and gitignored; `main.tf` says why it lands in the
  root and refuses to plan without it) and the resources they refer to:
  queues, hours and the recorded hold prompt with its bucket and object
  (`supporting.tf`; see [The recorded prompt](#the-recorded-prompt)), and
  the six stub Lambdas with their roles, log groups, invoke permission and
  instance association (`lambdas.tf`, zipping `lambdas/<name>/` into the
  gitignored `build/`).
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
with the provider sweeper's `tfacc-` prefix. The one awscc resource, the
prompt, carries the same two tags itself (awscc has no `default_tags`).

The flow roots declare three providers from the registry beside flowascode:
`hashicorp/aws`, `hashicorp/archive` and, since task T2, `hashicorp/awscc`
for the prompt (Cloud Control; `hashicorp/aws` has no prompt resource). The
awscc package is hundreds of megabytes per platform: `npm run validate` and
`tests/validate.test.ts` download it once into `.tofu-cache/`,
`npm run lock:providers` downloads it for four platforms per root, and CI's
validate job keeps `.tofu-cache/` between runs (`actions/cache`, keyed on the
lock files). Allow for that the first time.

## The recorded prompt

`prompts/salt-line-tips.wav` is the audio behind `prompt:salt-line-tips`,
the recorded variant of the hold tips in the queue flows' A/B split
(`tasks/README.md`, tier decision 4). It was synthesized once with Amazon
Polly from `prompts/salt-line-tips.txt`, the copy `tests/copy.test.ts`
scans, and is committed; each flow root uploads it as the one object of a
private SSE-S3 bucket (`hh-<environment>-prompts-<account id>`, the account
id read at plan time because bucket names are global) and creates the
prompt from it through `awscc_connect_prompt` (VERIFY.md, row P1).
Regenerate the audio only when the text changes, with the voice the flows
use (Matthew, neural) at the 8 kHz Connect recommends, wrapped as 16-bit
mono wav:

```sh
aws polly synthesize-speech --engine neural --voice-id Matthew \
  --output-format pcm --sample-rate 8000 \
  --text "$(cat prompts/salt-line-tips.txt)" /tmp/salt-line-tips.pcm
python3 -c 'import wave; w = wave.open("prompts/salt-line-tips.wav", "wb"); \
  w.setnchannels(1); w.setsampwidth(2); w.setframerate(8000); \
  w.writeframes(open("/tmp/salt-line-tips.pcm", "rb").read()); w.close()'
```

The object's key carries the file's MD5 (`salt-line-tips-<md5>.wav`;
`source_hash` is the same MD5), so a regenerated wav is a changed object
key and an updated prompt on the next apply: `s3_uri` changes with the
audio, awscc issues UpdatePrompt in place (`S3Uri` is not a create-only
property of `AWS::Connect::Prompt`), `prompt_arn` and every flow binding
stay, and the same apply deletes the old object. With a fixed key the apply
would re-put the object and leave the prompt playing the old audio.

Within each group the roots are byte-identical except `environment.tf`
(`tests/envRoots.test.ts`). The instance id, region and state location are
supplied at plan time (`TF_VAR_connect_instance_id`, `TF_VAR_aws_region`,
`TF_VAR_seasonal_state`, `-backend-config`), never committed. The state
bucket's Region is its own: every root's `-backend-config` region is the
bucket's, whatever Region the instance is in.
`prod-october` is a profile, not a root: it applies to `envs/prod`.

## Bootstrap

`bootstrap/` creates what the other roots assume: one Connect instance per
environment (Connect-managed identity, inbound and outbound calls and flow
logs on, alias `hollow-hour-example-<environment>-<suffix>`) in that
environment's Region, and one S3 bucket for every root's state (versioned,
encrypted, public access blocked, `prevent_destroy`), locked by the S3
backend's lock object rather than a DynamoDB table. Since task T2 it also
creates one call recording bucket per instance (private, SSE-S3, no customer
managed key, recordings expired after 30 days) and the instance's
CALL_RECORDINGS storage config (`recordings.tf`): on 2026-10-05 (17:25 UTC)
no instance had one, so nothing the flows' recording blocks captured was
stored (tasks/README.md, tier decision 5; VERIFY.md, RS1). The buckets are
named `amazon-connect-hollow-hour-example-<environment>-recordings-<suffix>`,
because `amazon-connect-*` is the only S3 resource the instance's
service-linked role is granted and the root adds no bucket policy. The apply
creates 18 resources with no standing charge: a recording is billed at S3
standard storage once one exists, none will until a call reaches an agent
(no claimed number and no agent user in this tier), and the 30-day expiry
caps the exposure. The credentials that apply the root need, on those three
buckets, `s3:CreateBucket`, `s3:ListBucket`, `s3:PutBucketTagging`,
`s3:PutEncryptionConfiguration`, `s3:PutBucketPublicAccessBlock`,
`s3:PutBucketOwnershipControls`, `s3:PutLifecycleConfiguration` and `s3:Get*`
(the `aws_s3_bucket` refresh reads every bucket configuration, the others
their own), `s3:DeleteBucket` only if the same credentials are to destroy
them, and `connect:AssociateInstanceStorageConfig`,
`DescribeInstanceStorageConfig`, `UpdateInstanceStorageConfig`,
`DisassociateInstanceStorageConfig` on the instances. The Regions default to
this repository's own (dev, qa, prod and the bucket all `us-east-1`; the
Terraform-first repository keeps its three in `us-west-2`, so the two never
share a Region); override them with `-var` or `TF_VAR_environments` and
`TF_VAR_state_region`. Tier 1 needs no user, routing profile or security
profile, so the root creates none.

Check the instance quota first. The default is two per account and Region
(VERIFY.md, H3), and the defaults put three instances in `us-east-1`, so
this repository alone needs a quota of at least 3 there, plus any instances
the account already has in that Region. Read both, and if the quota is
short, request more (a larger increase "can take up to 3 weeks"):

```sh
aws service-quotas get-service-quota --service-code connect \
  --quota-code L-AA17A6B9 --region us-east-1
aws connect list-instances --region us-east-1 \
  --query 'length(InstanceSummaryList)'
aws service-quotas request-service-quota-increase --service-code connect \
  --quota-code L-AA17A6B9 --desired-value <existing + 3> --region us-east-1
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

Replacing an instance under the same alias can be refused for a few minutes
after the old one is deleted. On 2026-09-30, moving dev to `us-east-1`, the
bootstrap apply replaced `aws_connect_instance.env["dev"]` (destroy, then
create, with the alias unchanged), and the create was refused with
`InvalidRequestException: Invalid Input. Instance alias is already used.`
straight after the old instance was deleted. A few minutes later, once
`aws connect list-instances` no longer listed the old instance, planning and
applying again created it (1 added, in 1m8s). Wait, plan again and apply
again; nothing else is needed.

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
reads the state the bucket holds. Keep it in the GitHub secret
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
roots (the GitHub environments' `CONNECT_INSTANCE_ID` secret and
`AWS_REGION` variable). `state_bucket` and `state_region` are every root's
`-backend-config` bucket and region (the `TF_STATE_BUCKET` secret and the
`TF_STATE_REGION` variable). None of them is committed.

## Moving an environment to another Region

Changing an environment's Region in `environments` replaces its instance
(a new id, ARN and flow ids), and every resource the flow and seasonal
roots created on the old instance would be left behind. Move it in this
order, one step finishing before the next:

1. With the old instance id and Region still exported, destroy the flow
   root and then the seasonal root, as in [Teardown](#teardown), step 1.
2. Change the environment's Region in `bootstrap/variables.tf` (or
   `TF_VAR_environments`), check the new Region's instance quota (above),
   and plan and apply the bootstrap root. The plan replaces that
   environment's instance; if the create is refused with "Instance alias is
   already used", wait a few minutes and plan and apply again (above).
3. Set retention on the new `/aws/connect/<alias>` log group, and delete the
   old one in the old Region, which no root manages.
4. Export the new instance id and Region (and update the GitHub
   environment's `CONNECT_INSTANCE_ID` secret and `AWS_REGION` variable),
   then apply the seasonal root and then the flow root, each from a saved
   plan.
5. Rebuild the resource map, `node scenarios/resource-map.mjs <environment>`,
   before `npm run drift` or a scenario run. A map built from the old
   instance names its ARNs, so drift reports differences that are not there
   (see [Checking drift](#checking-drift)).

Observed on 2026-09-30, moving dev from `us-west-2` to `us-east-1`: the
flow root destroyed 55 resources and the seasonal root 6; the bootstrap
replacement was refused once with "Instance alias is already used" and
succeeded on a re-plan and re-apply minutes later; the seasonal root added
6 and the flow root 55. Afterwards `npm run drift` reported "No drift." on
dev, qa and prod, and S2 passed on the new dev in about 103 s
(VERIFY.md, R1).

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

## Deploying from GitHub

`.github/workflows/deploy.yml`, dispatched by hand for one environment (and,
for prod, a season), runs two jobs. `plan` runs the checks, emits the
profile, plans the seasonal root and then the flow root, and writes both
plans to the run's summary; it has no approval gate, so the plans are there
before anyone approves anything. `apply` runs only when the dispatch checks
`apply`: it waits for the environment's required reviewer (prod), downloads
the exact saved plans and emitted files the `plan` job wrote, and applies
the seasonal plan and then the flow plan. One deploy runs at a time across
all three environments (one concurrency group, never cancelled): dev, qa
and prod share us-east-1's Connect API throttle.

Set it up once:

1. **Environments.** Create six GitHub environments: `dev`, `qa` and `prod`
   for the apply job, and `dev-plan`, `qa-plan` and `prod-plan` for the plan
   job. On every one, limit deployment branches to `main`. On `prod`, add a
   required reviewer (and "Prevent self-review" when more than one person
   can approve). The `-plan` environments get no reviewer; they exist so
   the plan job can read its own secrets, which GitHub scopes to an
   environment.
2. **Roles.** Create IAM roles that trust GitHub's OIDC provider
   ([GitHub's guide](https://docs.github.com/en/actions/security-for-github-actions/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services)),
   each for the subjects of its environments,
   `repo:<owner>/<repository>:environment:<name>`: a read-only **plan role**
   for the three `-plan` environments (reading what the roots manage, which
   the AWS managed policy `ReadOnlyAccess` covers, the state objects under
   `hollow-hour-example/` in the bucket, and writing and deleting their
   `.tflock` lock objects, which a plan takes), and the **deploy role**
   below for `dev`, `qa` and `prod`.
3. **Secrets and variables.**

   | Where                | Kind     | Name                  | Value                                                                                  |
   | -------------------- | -------- | --------------------- | -------------------------------------------------------------------------------------- |
   | repository           | secret   | `PLAN_ARTIFACT_KEY`   | a random passphrase (`openssl rand -base64 32`); encrypts the saved plans between jobs |
   | each `<env>-plan`    | secret   | `AWS_PLAN_ROLE_ARN`   | the plan role's ARN                                                                    |
   | each `<env>`         | secret   | `AWS_DEPLOY_ROLE_ARN` | the deploy role's ARN                                                                  |
   | all six environments | secret   | `CONNECT_INSTANCE_ID` | that environment's instance id (`tofu -chdir=envs/bootstrap output instances`)         |
   | all six environments | secret   | `TF_STATE_BUCKET`     | the state bucket                                                                       |
   | all six environments | variable | `AWS_REGION`          | that environment's instance Region                                                     |
   | all six environments | variable | `TF_STATE_REGION`     | the bucket's Region                                                                    |

   The role ARNs, the instance id and the bucket are secrets, not
   variables: GitHub prints each step's `with:` and `env:` values in the log
   before any `add-mask` can run, and masks only secrets there. The Regions
   are not sensitive.

The saved plans hold state values (ids, ARNs, the account id), and anyone
can download a public repository's artifacts, so they travel between the
jobs encrypted with `PLAN_ARTIFACT_KEY`, kept for one day, together with
the emitted `flows.tf` of both roots and the Lambda zips in
`envs/<environment>/build/` that the flow plan records. The summary redacts
every UUID and the account id.

The flow plan is made from the seasonal root's current state. When the
seasonal root has never been applied, or its plan changes an output the
flow root reads, the flow root is not planned in that run: a plan-only run
fails with the reason, and an apply run applies the seasonal plan and then
fails with the same reason, so the next dispatch plans the flow root
against the new outputs ([First apply](#first-apply)).

## The deploy role

What `deploy.yml`'s deploy role (or your own credentials) needs, by what the
roots manage. Scope each statement to the environment's instance, the
`hh-<environment>-*` names and the state bucket; no account id, ARN or bucket
name is written here, because none is ever committed.

| For                                            | Actions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| State (S3 backend)                             | `s3:ListBucket` on the bucket; `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject` on `hollow-hour-example/<environment>/*`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| The instance                                   | `connect:DescribeInstance`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Queues and hours (`supporting.tf`)             | `connect:CreateQueue`, `connect:DescribeQueue`, `connect:UpdateQueue*`, `connect:DeleteQueue`, `connect:CreateHoursOfOperation`, `connect:DescribeHoursOfOperation`, `connect:UpdateHoursOfOperation`, `connect:DeleteHoursOfOperation`, `connect:TagResource`, `connect:UntagResource`, `connect:ListTagsForResource`                                                                                                                                                                                                                                                                                                                                 |
| Flows, modules, versions and aliases           | `connect:CreateContactFlow`, `connect:DescribeContactFlow`, `connect:UpdateContactFlow*`, `connect:DeleteContactFlow`, `connect:CreateContactFlowModule`, `connect:DescribeContactFlowModule`, `connect:UpdateContactFlowModule*`, `connect:DeleteContactFlowModule`, `connect:CreateContactFlowModuleVersion`, `connect:DeleteContactFlowModuleVersion`, `connect:ListContactFlowModuleVersions`, `connect:CreateContactFlowModuleAlias`, `connect:DescribeContactFlowModuleAlias`, `connect:UpdateContactFlowModuleAlias`, `connect:DeleteContactFlowModuleAlias`                                                                                    |
| Lambda association                             | `connect:AssociateLambdaFunction`, `connect:DisassociateLambdaFunction`, `connect:ListLambdaFunctions`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| The prompt bucket and object (`supporting.tf`) | on `hh-<environment>-prompts-*`: `s3:CreateBucket`, `s3:DeleteBucket`, `s3:ListBucket`, `s3:Get*`, `s3:PutBucketPublicAccessBlock`, `s3:PutBucketOwnershipControls`, `s3:PutEncryptionConfiguration`, `s3:PutBucketTagging`, `s3:PutObject`, `s3:PutObjectTagging`, `s3:DeleteObject`                                                                                                                                                                                                                                                                                                                                                                  |
| The prompt (`awscc_connect_prompt`)            | `connect:CreatePrompt`, `connect:DescribePrompt`, `connect:UpdatePrompt`, `connect:DeletePrompt`, `connect:TagResource`, `connect:UntagResource`, `connect:ListTagsForResource`; and, because awscc works through Cloud Control, `cloudformation:CreateResource`, `cloudformation:GetResource`, `cloudformation:UpdateResource`, `cloudformation:DeleteResource`, `cloudformation:GetResourceRequestStatus`, `cloudformation:ListResources`. The Cloud Control create and update handlers read the object as the caller (`s3:GetObject` and `s3:GetObjectAcl`, covered by the `s3:Get*` above), so the bucket needs no policy for a Connect principal. |
| Stub Lambdas (`lambdas.tf`)                    | `lambda:CreateFunction`, `lambda:GetFunction*`, `lambda:UpdateFunction*`, `lambda:DeleteFunction`, `lambda:AddPermission`, `lambda:RemovePermission`, `lambda:GetPolicy`, `lambda:ListVersionsByFunction`, `lambda:TagResource`, `lambda:ListTags`                                                                                                                                                                                                                                                                                                                                                                                                     |
| Their roles                                    | `iam:CreateRole`, `iam:GetRole`, `iam:DeleteRole`, `iam:TagRole`, `iam:PutRolePolicy`, `iam:GetRolePolicy`, `iam:DeleteRolePolicy`, `iam:ListRolePolicies`, `iam:ListAttachedRolePolicies`, `iam:ListInstanceProfilesForRole`, `iam:PassRole` (to `lambda.amazonaws.com`)                                                                                                                                                                                                                                                                                                                                                                              |
| Their log groups                               | `logs:CreateLogGroup`, `logs:DeleteLogGroup`, `logs:PutRetentionPolicy`, `logs:DescribeLogGroups`, `logs:TagResource`, `logs:ListTagsForResource`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Plan-time reads                                | `sts:GetCallerIdentity`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

The flowascode provider's own Connect calls are the flow and module rows; its
documentation is the authority when it adds one. This list comes from the
resources the roots declare and has not yet been exercised by a live apply
(T1 criterion 10): the first apply of dev records any refusal in
[`VERIFY.md`](../VERIFY.md) and here.

## Deploying by hand

The sequence `deploy.yml` runs, for one environment: plan to a file, read
the plan, then apply that saved plan, so what is applied is exactly what was
reviewed. Never `apply -auto-approve`. By hand, the flow root is planned
after the seasonal apply, so it always reads the new outputs.

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
compared. The map must come from the instance being checked: after dev's
instance was replaced on 2026-09-30, a map left from the old instance made
drift report 8 flows as different, and rebuilding it with
`node scenarios/resource-map.mjs dev` gave "No drift.". An error message is printed with ARNs, ids and account ids redacted.
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
can even be planned. `deploy.yml`'s plan job checks for that state after the
seasonal plan and refuses to plan the flow root without it. A first deploy
is two dispatches with `apply` checked: the first applies the seasonal root
and then fails on purpose, naming the flow root it could not plan; the
second plans the flow root against the seasonal outputs and applies both
(the seasonal plan is then empty).
