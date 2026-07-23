# Desktop release updates

`pi-agent-desktop` updates the installed macOS app as one signed, atomic bundle. The bundle records the exact versions of all three components in `src-tauri/resources/component-versions.json`:

1. `abcwyc/pi-agent-desktop`
2. `earendil-works/pi`
3. `agegr/pi-web`

The settings screen checks the three repositories' latest stable GitHub Releases once a week. If any bundled version is older, its single **Upgrade** button downloads the newest signed `pi-agent-desktop` release, installs the complete app, and restarts it. It never replaces JavaScript or dependencies inside an already installed signed app.

## Automatic component sync

`.github/workflows/component-updates.yml` runs every day and can also be started manually. It applies updates in dependency order:

1. update all `@earendil-works/pi-*` packages to the released `pi` version;
2. merge the released `pi-web` tag;
3. bump `pi-agent-desktop`, regenerate the component manifest, and run tests, typecheck, and lint;
4. commit and push the verified result directly to `main`;
5. explicitly dispatch the signed macOS release workflow.

The repository intentionally keeps only `main`; the automation does not create a component-update branch or pull request. Pushes use no force option. If an upstream merge conflicts or any validation fails, the workflow stops before updating `main` or publishing a Release, and the failed Actions run must be resolved manually.

## One-time signing setup

Tauri updater signatures are mandatory. Generate the updater signing key once on a trusted machine:

```bash
npm exec tauri signer generate -- -w ~/.tauri/pi-agent-desktop.key
```

Store these repository Actions secrets:

- `TAURI_SIGNING_PRIVATE_KEY`: contents of the private key file;
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: password chosen during generation;
- `TAURI_UPDATER_PUBLIC_KEY`: the exact Base64 contents of the `.pub` file generated next to the private key.

The release workflow validates this public key before installing dependencies and
injects it into Tauri's updater configuration for both bundle signing and runtime
verification. The key is never printed by the workflow.

Never commit the private key or its password. The public key is embedded at compile time only in release builds. Local builds deliberately do not register the updater plugin.

## Publishing

After a successful component sync updates `main`, it explicitly starts **Publish signed macOS release**. The release workflow can also be started manually. It verifies that the bundled `pi` and `pi-web` versions exactly match their latest stable Releases, then creates the signed Apple Silicon (`aarch64`) app artifacts and `latest.json`. Intel (`x86_64`) artifacts are not built. The Release stays in draft until the signed updater archive and component manifest are present; only then is `v<pi-agent-desktop version>` published as the latest Release.

The workflow currently uses ad-hoc macOS application signing. Before distributing outside a controlled environment, configure an Apple Developer ID certificate and notarization in the release workflow as well.
