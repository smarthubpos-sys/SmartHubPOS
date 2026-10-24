# QZ Tray direct printing — SmartHubPOS

SmartHubPOS uses the installed `qz-tray` package (2.3.0) for configured receipt/invoice direct-print actions. QZ Tray desktop software must be installed and running on every client computer that prints through an operating-system printer. The selected printer name must match the printer QZ Tray discovers on that computer.

## Secure signing is required

The frontend deliberately does **not** use empty certificate/signature callbacks, embed a private key, or silently fall back to `window.print()` for invoice, bill, waiter-order, and QZ test-print actions.

Configure these public Vite settings for each deployment:

- `VITE_QZ_CERTIFICATE_URL`: HTTPS endpoint returning the public X.509 certificate as `text/plain`.
- `VITE_QZ_SIGNATURE_URL`: HTTPS endpoint accepting `POST application/x-www-form-urlencoded` with `request=<QZ string to sign>` and returning the RSA/SHA-512 signature as base64 `text/plain`.

The signature endpoint must run server-side, keep the private key in server-only secret storage, authenticate/authorize requests for the application, validate the request origin, and apply rate limits. **Do not** put the private key in any `VITE_*` variable, browser source, this repository, or a public static file. The certificate is public; the private key is not.

This repository does not currently contain a configured server-side signing endpoint or the owner's QZ signing certificate/private key. Therefore direct QZ jobs will fail with an actionable configuration error until the owner supplies the trusted certificate and a protected signing endpoint. This is intentional; browser printing is not an implicit fallback.

## Verification limits

A successful `qz.print()` promise means QZ Tray accepted/completed the software print request according to its API. It cannot independently prove that paper physically emerged, that the printer had paper/ink, or that the output was legible. Complete the manual real-printer acceptance checks before production use.
