# Fixture tools

Not part of the app. These rebuild and check the `explorer` demo
account over the HTTP API (direct `psql` to the Render database is
blocked from the network it was built on — DNS resolves, port 5432
times out).

```sh
# dry run against a local server, under a throwaway username
BASE=http://localhost:3000/api USER_NAME=dryrun-fixture \
  npx tsx resources/tools/build-explorer-fixture.ts

# for real, against production as `explorer`
npx tsx resources/tools/build-explorer-fixture.ts

# check the states came out right (same env vars)
npx tsx resources/tools/verify-explorer-fixture.ts
```

`build` fails on a duplicate repo name and there is no delete-repo
endpoint, so a partial failure leaves junk behind — always dry-run
first. `verify` reports, per branch: commit count, whether working
state equals the tip, and what the merge view would show.

Both scripts import the engine by relative path, so run them from the
repo root.
