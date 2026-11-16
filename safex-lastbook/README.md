# Lastbook on Umbrel

This directory packages the browser-based Lastbook library server for the Safex Umbrel Community App Store.

## How it works

- The container runs Lastbook's upstream `server.py` browser interface.
- Umbrel's `app_proxy` is the only network entry point; the app service does not publish a host port.
- First launch opens Lastbook's own setup screen. Choose an available library pack and let Lastbook download, verify and unpack it.
- Library files, search indexes, caches and setup state persist below `${APP_DATA_DIR}/data` on the Umbrel host.
- The local desktop AI runner is intentionally not offered in this first server image. Browsing and keyword search work without it; the optional Ask service needs a separately configured model endpoint.
- The image pins the upstream Lastbook source to commit `83f2ca99609f3d420c2bf25bfdae2cedbdaaafae`.

## Publishing

The GitHub Actions workflow at `.github/workflows/lastbook-image.yml` builds and pushes:

- `ghcr.io/wg2kwf9fnz-wq/safex-lastbook:latest`
- an immutable `sha-<commit>` tag

After the first successful workflow run, set the `safex-lastbook` GitHub Container Registry package visibility to **Public** so Umbrel can pull it without registry credentials. The Umbrel app definition uses the `latest` tag; publish a new image after updating the source or app adapter.

## First install

Install `safex-lastbook` from the Safex Umbrel Community App Store. Open it and choose a Lastbook library pack in the setup screen. Pack downloads can be large; check free disk space before starting. The pack is downloaded from Lastbook's official distribution host and verified against its published SHA-256 before it is activated.

## Upstream

- Project: https://github.com/Immortal-Protocols/lastbook
- Server notes: https://github.com/Immortal-Protocols/lastbook/blob/main/docs/LIBRARY-SERVER.md
- License: MIT for Lastbook's original code; library packs and bundled third-party components retain their own terms.
