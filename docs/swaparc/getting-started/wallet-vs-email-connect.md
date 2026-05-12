# Wallet vs Email Connect

SwapArc offers two ways to sign: a **standard wallet** (browser extension or WalletConnect-compatible app) or a **Circle email wallet** (Gmail or email sign-in with Circle-hosted signing). You are not locked in forever as you can switch approaches later, but picking the right path up front reduces friction for how you already work (self-custody keys vs email-first onboarding).

If you only need the connection steps, see [Connect a wallet](connect-a-wallet.md). This page explains **when each path fits** and how they differ in practice.

## At a glance

### Ease of use

**Standard wallet** suits people who already use MetaMask, Rabby, Rainbow or a mobile wallet over WalletConnect. Once the extension or session is connected, approvals feel familiar: every swap, pool action or PrivPay step ends in a wallet popup on **Arc testnet**.

**Circle email wallet** suits people who do not want to install or maintain an extension. You verify email and OTP (and sometimes Circle security challenges), then the app drives contract calls through Circle’s flow. The tradeoff is a few extra verification steps instead of local key management.

### Security & control

**Standard wallet** keeps signing authority in software or hardware you control. You choose when to approve, you see raw calldata in the wallet preview, and you manage seed phrase or hardware backup yourself; SwapArc never holds your keys.

**Circle email wallet** uses Circle’s user-controlled wallet model for your account. You still approve actions, but through Circle’s UI and policies rather than a classic extension. Treat your email and 2FA like critical credentials because they gate access to that signing path.

### Setup steps

**Standard wallet:** 
- Install or open a wallet (Extension or Mobile App works) 
- Add **Arc testnet** if needed
- Click on **Connect via Wallet** 
- Approve the site connection
- Confirm the address shown in SwapArc matches what you expect.

**Circle email wallet:** 
- Choose **Connect via Gmail** 
- Enter Gmail and wait for OTP
- CLick Verify and enter your OTP on the white Screen
- Wait until the app shows the wallet as ready before starting trades or PrivPay.

### Best for

**Standard wallet** is best for power users, teams already on Web3 tooling, hardware-wallet users and anyone who wants maximum transparency from the wallet’s transaction preview.

**Circle email wallet** is best for onboarding users who are comfortable with email login, demos where you want fewer local dependencies or environments where extension installs are restricted.

### Limitations

**Standard wallet** depends on a working injected provider or WalletConnect session, correct chain selection and enough **USDC gas** on Arc testnet. Wrong network or a locked wallet shows up as connection or signing errors.

**Circle email wallet** depends on Circle configuration for your deployment, email deliverability and completing challenges without rushing. The app also serializes heavy contract actions so overlapping prompts do not stack—wait for one step to finish before starting another.

## Standard wallet (browser extension / WalletConnect)

With a standard wallet, SwapArc talks to your provider the same way most dApps do. After you connect, every meaningful transaction is proposed to that wallet. You read the summary, confirm or reject and the chain executes what you approved.

![Select a wallet to connect — pick an installed extension such as MetaMask, Rabby, Phantom, or another listed wallet](/docs-images/wallet-vs-email-select-wallet.png)

WalletConnect extends that pattern to mobile wallets: you scan a QR code or deep-link into the wallet app, approve on the phone and return to the desktop tab. The mental model is unchanged as you are still the signing authority, just on a different device.

Keep **Arc testnet** selected in the wallet so balances, gas estimates and contract addresses line up with what SwapArc expects. If something fails, the first checks are network, gas balance and whether the site connection is still active.

## Circle email wallet (Gmail / Email)

Circle email mode is built for users who prefer not to juggle seed phrases in a browser extension. You authenticate with email (and often Gmail), complete OTP and any Circle security step, then use SwapArc while Circle provisions signing for your session.

![Connect via Email — after the OTP email arrives, use Verify in Circle’s window to continue; you can reset the flow if needed](/docs-images/wallet-vs-email-circle-verify-modal.png)

Because signing can include extra verification, plan slightly more time for the first transaction after login. The app is designed so contract-heavy flows do not overlap; if a challenge is in progress, wait for it to clear before clicking the next action.

![Enter verification code — Circle prompts for the one-time passcode sent to your email; resend if the message does not arrive](/docs-images/wallet-vs-email-circle-otp.png)

This path is not “less secure by default”—it shifts trust boundaries to email, device, and Circle’s controls rather than to a local mnemonic in an extension. Use strong email passwords and 2FA and only connect from devices you trust.

## Which should I pick?

Choose a **standard wallet** if you already live in Web3, want hardware-wallet support or need the clearest on-wallet calldata review for compliance habits.

Choose **Circle email wallet** if your audience is newer to wallets, you want faster onboarding without “install MetaMask first,” or your environment blocks extensions.

If you are unsure, start with the path your users already use elsewhere; you can document both in internal runbooks and link them here.

## Troubleshooting (quick)

**Standard wallet:** confirm the extension is unlocked, the site is allowed, and the active network is **Arc testnet**. If WalletConnect drops, disconnect and reconnect from the wallet app. If gas errors appear, use **Get Faucet** or your usual testnet faucet.

**Circle email wallet:** confirm deployment Circle settings, complete OTP in the same browser session and finish any challenge window without refreshing mid-flow. If a transaction hangs, wait for the prior action to finish; parallel clicks often cause confusing states.

For deeper issues, see [FAQ](../support/faq.md) and [Troubleshooting](../support/troubleshooting.md).
