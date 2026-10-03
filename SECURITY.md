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


## Compromise recovery

If a bot token, AI provider key, GitHub credential, session artifact, database copy, or runtime log is suspected to have been exposed:

1. Stop the affected runtime before investigating or restoring it.
2. Revoke/rotate the exposed credential at its issuing provider; do not attempt to make the old secret safe by deleting it from the working tree alone.
3. Treat every runtime data copy, log, SQLite WAL/SHM file, exported report, and backup made before rotation as potentially exposed.
4. Verify the replacement secret is present only in the runtime secret store/environment and is absent from Git history and generated artifacts.
5. For Telegram, invalidate the compromised bot token and issue a replacement through BotFather; update only the intended TEST or PROD runtime.
6. For GitHub access, revoke the compromised credential and prefer a narrowly scoped deploy key/token. Never commit replacement credentials.
7. Revoke or quarantine affected sessions and runtime leases; require a fresh active lease before restarting HA runtimes.
8. Restore application code only from a known-good Git commit. Restore user data only from a separately trusted backup; never copy TEST databases into PROD.
9. Run the full runtime/security regression suite and healthcheck before returning the service to active state.
10. Record the incident without copying the exposed secret into tickets, reports, diagnostics, chat messages, or commits.

### Backup rule

Backups must be encrypted at rest, access-controlled, and stored outside the Git working tree. A backup containing credentials or runtime logs must be treated as a secret-bearing artifact and rotated/quarantined with the same urgency as the original exposure.

### Rollback rule

A code rollback does not revoke credentials and does not erase data already copied by an attacker. Credential rotation and data/backup containment are separate incident steps.
