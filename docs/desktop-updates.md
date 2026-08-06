# Desktop release updates

`pi-agent-desktop` updates the installed macOS or Windows app as one updater-signed, atomic bundle. The bundle records the exact versions of all three components in `src-tauri/resources/component-versions.json`:

1. `abcwyc/pi-agent-desktop`
2. `earendil-works/pi`
3. `agegr/pi-web`

The settings screen checks only the latest stable `abcwyc/pi-agent-desktop` GitHub Release, at most once a week. If the installed desktop app version is older, its single **Upgrade** button downloads that signed release, installs the complete app, and restarts it. It never replaces JavaScript or dependencies inside an already installed signed app.

## Automatic component sync

`.github/workflows/component-updates.yml` runs every day and can also be started manually. It applies updates in dependency order:

1. update all `@earendil-works/pi-*` packages to the released `pi` version;
2. merge the released `pi-web` tag;
3. bump `pi-agent-desktop`, regenerate the component manifest, and run tests, typecheck, and lint;
4. commit and push the verified result directly to `main`;
5. explicitly dispatch the signed desktop release workflow.

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

After a successful component sync updates `main`, it explicitly starts **Publish signed desktop release**. The release workflow can also be started manually. It verifies that the bundled `pi` and `pi-web` versions exactly match their latest stable Releases, then sequentially creates Apple Silicon (`aarch64`) DMG/updater artifacts and a Windows x64 NSIS `-setup.exe`/updater archive. Intel Mac (`x86_64-apple-darwin`) artifacts are not built. The Release stays in draft until both platforms and the component manifest are present; only then is `v<pi-agent-desktop version>` published as the latest Release.

The workflow currently uses ad-hoc macOS application signing and Tauri updater signatures on both platforms. Before distributing outside a controlled environment, configure an Apple Developer ID certificate/notarization and a Windows Authenticode certificate. Without Authenticode, Windows may show a SmartScreen warning even though updater verification remains cryptographically signed.
