# SwapARC

## Node version

Use an active LTS version of Node.js: **20.x or 22.x**.

Installs may fail (for example on `protobufjs` postinstall) with newer,
non‑LTS Node releases. If you hit install problems, first confirm that
your `node -v` reports either a 20.x or 22.x version.

## Circle App ID

To enable Circle email login and the "Send OTP" button, set `VITE_CIRCLE_APP_ID`
in your environment (for example in `.env.local` or `.env`).

You can find the App ID in the Circle Console:

- Wallets → User Controlled → Configurator → App ID

Copy that value into `VITE_CIRCLE_APP_ID` and restart the dev server.
