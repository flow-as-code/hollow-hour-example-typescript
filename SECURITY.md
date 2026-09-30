# Security policy

## Reporting a vulnerability

Report suspected vulnerabilities privately through GitHub's security advisory
form on this repository, under the Security tab, rather than opening a public
issue. Include what you observed and the smallest change or configuration that
reproduces it.

Expect an acknowledgement within a few working days. This is a small project
and there is no paid bounty.

## What is in scope

- An account id, ARN, instance id, credential or real phone number committed
  to the repository, or printed unmasked by a workflow.
- A workflow that can reach an AWS account from a pull request, or that uses a
  third-party action not pinned to a commit.
- A flow or configuration in this repository that deploys content its FlowDocs
  do not contain.

## Not a real hotline

Hollow Hour Removal Co. is fictional. Nothing here is an emergency service,
and there is no public phone number. If anyone is hurt or in danger, call your
local emergency number (911 in the US).

Out of scope: vulnerabilities in flow-as-code, the flowascode provider,
OpenTofu, Terraform, the AWS SDK or Amazon Connect themselves; report those to
their own projects.
