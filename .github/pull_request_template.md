## What changes

## How it was shown to fail

Every guarantee lands with a test that was seen to fail: name what you broke,
the test that went red, and that it passed again once restored.

- [ ] `npm run check` passes
- [ ] `npm run generate` leaves no diff
- [ ] `npm run validate` passes (when `envs/`, `refs/` or the flows changed)
- [ ] VERIFY.md updated for any behavior newly relied on, with its AWS doc URL
- [ ] No account id, ARN, instance id or phone number outside 555-0100 to 555-0199
