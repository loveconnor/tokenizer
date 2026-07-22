# Security policy

## Supported version

Until Connor's Tokenizer publishes versioned releases, security fixes target the latest commit on `main`. Older commits and local modifications are not supported versions.

## Report a vulnerability privately

Do not open a public issue with vulnerability details, credentials, personal data, or an exploit.

When this repository is public, use **Security → Report a vulnerability** on GitHub to start a private advisory. If private vulnerability reporting is unavailable, contact the repository owner privately through the GitHub profile that owns the repository and include only enough information to establish a secure channel.

Include:

- the affected commit or version;
- the vulnerable component and required preconditions;
- reproducible steps or a minimal proof of concept;
- the likely impact;
- any known workaround;
- whether the report contains sensitive data that needs special handling.

The maintainer will assess scope and coordinate validation, remediation, and disclosure. No response or remediation deadline is promised before the report has been reviewed.

## Scope notes

The browser comparison is designed to process entered text locally. Reports that show text or credentials leaving the browser unexpectedly are security-sensitive. Dependency, artifact-provenance, corpus privacy, unsafe file handling, and malicious-input findings are also in scope.
