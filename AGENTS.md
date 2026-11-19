# Project rules

This project is a single-user Telegram bot for managing auto-parts suppliers. Keep work within the requested scope and do not reuse code from other bot projects.

- Organize by feature; keep Telegram handlers thin and business logic independent of Telegram. Put shared or substantial types in dedicated `.types.ts` files when practical.
- Put database queries in repositories and isolate external APIs in integrations. Future multi-step data changes must use transactions and preserve consistency on failure.
- Extract utilities only when they reduce real duplication. Prefer explicit code and Node.js built-ins; avoid unnecessary dependencies, frameworks, and unrelated refactoring.
- Use the centralized logger with fixed, safe messages. Never log tokens, credentials, private environment values, or untrusted errors that may contain secrets.
- All user-facing bot text must be Armenian. Document product decisions and relevant setup or behavior changes in the README or product specification.
- Validate authorization before handling updates. Treat callback data and session state as untrusted: validate ownership, shape, freshness, and state transitions before applying changes.
- Add meaningful automated tests for behavior and failure cases; avoid live Telegram or external services in unit tests. Run relevant checks and report results honestly.
- Keep secrets in environment variables, out of source control and logs. Validate configuration at startup and use least-privilege access for future integrations.
