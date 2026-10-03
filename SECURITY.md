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

## Known dependency migration

The current Telegram adapter is based on legacy aiogram 2.x. A full dependency audit may report vulnerable transitive aiohttp versions because that legacy adapter constrains aiohttp below current secure releases. This is tracked as a migration item rather than being hidden with vulnerability suppressions. The direct dependency audit remains blocking, while the full transitive audit remains visible as a CI warning until the aiogram migration is completed.
