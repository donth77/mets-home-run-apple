# Security Policy

This project controls moving low-voltage hardware. Treat motion authorization, firmware updates and credentials as security-sensitive even when the device is used only at home.

## Reporting

Do not open a public issue for a vulnerability that could expose Wi-Fi credentials, bypass local motion controls, enable arbitrary proxying or permit an unsafe firmware update. Contact the repository owner privately through the security-reporting method configured on the Git hosting service. A dedicated address will be added before the first public release.

## Baseline requirements

- no internet-exposed device dashboard or port forwarding;
- authenticated administrative requests plus physical confirmation for motion/update commands;
- TLS certificate validation for upstream HTTPS;
- no secrets in firmware source, fixtures, browser bundles or logs;
- bounded request size, parse depth, timeouts and retry rates;
- signed or otherwise verified update path before over-the-air updates are enabled;
- a physical safe-off and software motion timeout independent of network state;
- strict Worker URL allowlist so the edge service cannot become an open proxy.

The project is pre-release. No version currently receives a production security-support guarantee.
