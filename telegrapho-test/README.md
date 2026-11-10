# Telegrapho Test App

This is a separate test listing for the modified Telegrapho build.

**Do not install until the image in docker-compose.yml has been successfully published and pinned to its immutable digest.**

The test app uses a separate app ID and port from the official Telegrapho app so it can be installed alongside it.

Before testing, confirm the image supports linux/amd64 and linux/arm64 and verify:
- The first client on one Umbrel installation receives the welcome modal.
- A second browser/device does not receive it.
- Restarting the app does not show the modal again.
- The persistent welcome flag survives an app update.
