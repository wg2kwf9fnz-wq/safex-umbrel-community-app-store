# Telegrapho Test App

This is a separate test listing for the modified Telegrapho build.

## Published image

- Image: `ghcr.io/wg2kwf9fnz-wq/telegrapho:welcome-test-1`
- Digest: `sha256:8691bf60b1adc78a7b1a7e30ae36cdaaea9a2043d00e9da40579d29fcd7d37ea`
- Build: [GitHub Actions run 42804605856](https://github.com/wg2kwf9fnz-wq/telegrapho/actions/runs/42804605856)

The package is shown as public in GitHub's package settings. The first install on Umbrel will confirm that anonymous pulls work.

The test app uses a separate app ID, port, and persistent data directory so it can be installed alongside the official Telegrapho app.

## Validation checklist

- The first client on one Umbrel installation receives the welcome modal.
- A second browser/device does not receive it.
- Restarting the app does not show the modal again.
- The persistent welcome flag survives an app update.
- Confirm the app installs and opens on the target Umbrel device.
