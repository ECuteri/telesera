# Security

Telesera stores a Telegram account session on the television. Protect root access to the TV as you would access to that account. The engine listens on IPv4 loopback only and uses a random local bearer token. Neither the engine nor its files should be exposed on a public network.

Keep `private/`, API credentials, session files, tokens, message content and unredacted screenshots out of issues and Git commits. Rooted-TV deployments rely on the TV owner's trusted system environment; they do not provide isolation from another root process.

Telegram Mini Apps are third-party websites. Their signed URLs authorize access to the bot's own app, independently of Telesera's local API. Telesera restricts iframe permissions and does not provide those sites with its local bearer token.

Report vulnerabilities through the repository's private vulnerability reporting feature. Do not publish account sessions or exploit data in public issues. Third-party protocol libraries retain their own security characteristics and are not claimed to have been audited by this project.
