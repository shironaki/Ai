# Security policy

## Secrets

Never commit Telegram bot tokens, AI provider keys, GitHub tokens, cookies, session files, databases, or runtime logs. Keep secrets in the runtime environment or the platform secret store.

If a credential may have been exposed, revoke/rotate it immediately at the issuing provider before investigating further.

## Reporting

For a suspected vulnerability, do not publish the secret or exploit details in a public issue. Use a private security report/channel available to repository maintainers.

## Runtime principles

- TEST and PROD use different Telegram bot tokens.
- Administrative actions are re-authorized at execution time.
- Sensitive diagnostics redact common credential formats.
- AI prompts are credential-redacted before leaving the bot process.
- Runtime data and logs are excluded from Git.
