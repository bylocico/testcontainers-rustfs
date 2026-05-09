# @bylocico/testcontainers-rustfs

A small [Testcontainers](https://testcontainers.com) wrapper for [RustFS](https://rustfs.com), an S3-compatible object store written in Rust.

The package is intentionally dependency-light and shaped like the official Testcontainers modules so it can be upstreamed to [`testcontainers/testcontainers-node`](https://github.com/testcontainers/testcontainers-node) later.

## Versioning

The npm package version tracks the RustFS Docker image version it targets.

For example, `@bylocico/testcontainers-rustfs@1.0.0-beta.2` defaults to:

```text
rustfs/rustfs:1.0.0-beta.2
```

Wrapper-only changes should be kept small and released with the next RustFS target version where practical. If an urgent wrapper fix is needed before RustFS moves, publish a patch version and document the exception in the release notes.

CI runs automatically on pull requests and pushes. The update workflow also queries Docker Hub on a schedule, finds every new semver RustFS image tag, tests each one in ascending order, and opens an auto-merge PR that retargets the package to the newest passing tag. Variant image tags such as `-glibc` are ignored for package versioning because they are image flavors, not RustFS release versions.

Consumers can still pull any valid RustFS image version without waiting for this package to retarget:

```ts
await new RustfsContainer('rustfs/rustfs:1.0.0-beta.2').start()
await new RustfsContainer('rustfs/rustfs:latest').start()
```

## Install

```bash
npm install --save-dev @bylocico/testcontainers-rustfs @aws-sdk/client-s3
```

`@aws-sdk/client-s3` is a peer dependency because most consumers already own their SDK version.

## Usage

```ts
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { RustfsContainer } from '@bylocico/testcontainers-rustfs'

const rustfs = await new RustfsContainer().start()

try {
  await rustfs.ensureBucket('my-bucket')

  const s3 = new S3Client({
    endpoint: rustfs.getEndpoint(),
    region: 'us-east-1',
    credentials: {
      accessKeyId: rustfs.accessKey,
      secretAccessKey: rustfs.secretKey,
    },
    forcePathStyle: true,
  })

  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: 'my-bucket',
        Key: 'hello.txt',
        Body: 'world',
      }),
    )
  } finally {
    s3.destroy()
  }
} finally {
  await rustfs.stop()
}
```

## API

### `new RustfsContainer(image?: string)`

Creates an unstarted RustFS container. By default it uses the RustFS image version that matches the package version.

Pass an explicit image to test a different RustFS release:

```ts
new RustfsContainer('rustfs/rustfs:latest')
new RustfsContainer('rustfs/rustfs:1.0.0-beta.2')
```

### `.withCredentials(user, password)`

Overrides the default root user/password.

Defaults:

```text
rustfsadmin / rustfsadmin
```

Example:

```ts
const rustfs = await new RustfsContainer()
  .withCredentials('test-user', 'test-password')
  .start()
```

All normal `GenericContainer` builder methods remain available through inheritance, including `withEnvironment`, `withCommand`, and `withNetwork`.

### `StartedRustfsContainer`

The started container exposes:

- `getEndpoint(): string` - `http://<host>:<port>` for the S3 API
- `getHost(): string`
- `getPort(): number`
- `accessKey: string`
- `secretKey: string`
- `ensureBucket(name): Promise<void>`
- `stop(): Promise<void>`

`ensureBucket()` is idempotent and tolerates `BucketAlreadyOwnedByYou` and `BucketAlreadyExists`.

## S3 Client Notes

Use `getEndpoint()` rather than hardcoding ports. Testcontainers maps container port `9000` to a random host port.

Use path-style addressing with the AWS SDK:

```ts
forcePathStyle: true
```

Virtual-hosted-style addressing requires DNS entries that the test container does not provide.

## Development

Requirements:

- Node.js 18+
- npm
- Docker

Install dependencies:

```bash
npm install
```

Run checks:

```bash
npm run typecheck
npm run build
npm test
```

Run tests against a specific RustFS image:

```bash
RUSTFS_IMAGE=rustfs/rustfs:latest npm test
```

List RustFS release image tags newer than the package target:

```bash
node scripts/update-rustfs-version.mjs --list-newer
```

Retarget the package to a specific RustFS version:

```bash
node scripts/update-rustfs-version.mjs --version 1.0.0-beta.2
npm install --package-lock-only
```

Inspect the package contents before publishing:

```bash
npm pack --dry-run
```

## Publishing

Publishing is handled by [`.github/workflows/publish.yml`](.github/workflows/publish.yml). It runs on **published GitHub Releases** and on **manual workflow dispatch**.

### Trusted publishing (OIDC)

Releases are published with [npm trusted publishing](https://docs.npmjs.com/trusted-publishers): GitHub Actions exchanges a short-lived OIDC token with the registry, so you do **not** need a long-lived `NPM_TOKEN` secret for `npm publish`.

**One-time npm setup**

1. In the package settings on [npmjs.com](https://www.npmjs.com/), open **Trusted publishing** and add **GitHub Actions** with:
   - the correct **organization or user** and **repository**
   - workflow filename **`publish.yml`** (exact name, including `.yml`)
   - an **environment** only if you configured one on npm to match a GitHub Environment
2. Ensure `package.json` **`repository.url`** matches this GitHub repository exactly (npm validates this for GitHub publishes).

The workflow sets `permissions: id-token: write` so Actions can mint the OIDC token. It uses **Node 24.x** and the bundled **npm 11.x** on the runner, because trusted publishing requires **npm ≥ 11.5.1** and **Node ≥ 22.14.0** per npm’s docs. (Local development may still use the `packageManager` / `npm10` tooling in this repo for an older npm; that does not apply to CI publish.)

**Provenance:** when publishing from a **public** repo via trusted publishing, npm attaches [provenance](https://docs.npmjs.com/generating-provenance-statements) automatically; the workflow does not pass `--provenance` explicitly.

**Prereleases:** versions like `1.0.0-beta.2` are published with an explicit **dist-tag** (for example `beta`), not only `latest`. Consumers install them with:

```bash
npm install --save-dev @bylocico/testcontainers-rustfs@beta
```

### Release checklist

1. Confirm the target RustFS Docker tag exists:

   ```bash
   docker manifest inspect rustfs/rustfs:1.0.0-beta.2
   ```

2. Update `package.json` and `DEFAULT_RUSTFS_VERSION` to the same version.
3. Run `npm install` so `package-lock.json` records the new package version.
4. Run `npm run typecheck && npm run build && npm test && npm pack --dry-run`.
5. Push to `main`.
6. Create a GitHub **Release** (publish event) for that version, for example tag `v1.0.0-beta.2`, or run the workflow manually from the Actions tab.

### Manual publish (maintainers)

Publishing from your local environment still uses normal npm login (and 2FA if enabled). For the same npm 10 toolchain as this repo:

```bash
npm run npm10 -- publish --access public --tag beta
```

Adjust `--tag` if the prerelease channel name differs. After trusted publishing is verified, you can restrict token-based publishing on the package in npm **Settings → Publishing access** if you want CI-only releases.

## Upstreaming

Keep the public API close to the official Testcontainers module style:

- one container class extending `GenericContainer`
- one started container class extending `AbstractStartedContainer`
- no application-specific dependencies
- no specific runtime behavior

That keeps a future upstream contribution to `testcontainers/testcontainers-node` small and reviewable.
