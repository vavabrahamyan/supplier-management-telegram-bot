# Supplier management Telegram bot

A foundation for a single-user Telegram bot for an auto-parts business. Its planned behavior is described in [the product specification](docs/PRODUCT_SPEC.md). It is not a Telegram Mini App.

## Stack

Node.js 24 LTS, strict TypeScript, Telegraf, dotenv and npm. SQLite and Google Drive integrations will be added with their features.

## Setup

1. Install and select Node.js 24 LTS, then run `npm install`. If you use [nvm](https://github.com/nvm-sh/nvm), run `nvm install` and `nvm use` in this directory; `.nvmrc` selects Node 24. Verify with `node --version`. Node 22.12 cannot run the TypeScript development entry point directly.
2. Copy `.env.example` to `.env` and fill in `BOT_TOKEN` from BotFather and `ALLOWED_TELEGRAM_USERNAMES` with your Telegram username, with or without `@`. Multiple usernames can be comma-separated, though the product is intended for one user.
3. Set `TIMEZONE` to a valid IANA zone and `LOG_LEVEL` to `debug`, `info`, `warn`, or `error` if the defaults do not suit you. `DATABASE_PATH` is reserved for future SQLite work and is not accessed yet.
4. Run `npm run dev` and send `/start` from an allowed account. Stop with Ctrl+C.

Never commit `.env` or share your bot token. Only explicitly allowed usernames can interact with the bot; matching is case-insensitive and users without a username are denied. Unauthorized updates are ignored. Telegram usernames can change and be reassigned: if you change or lose an allowed username, update the configuration immediately, because another account could acquire it and gain access. Numeric user IDs are more stable for authorization. Existing installations must replace `ALLOWED_TELEGRAM_IDS` with `ALLOWED_TELEGRAM_USERNAMES` in `.env`.

## Commands

- `npm run dev` — run TypeScript directly with automatic restart.
- `npm run typecheck` — check TypeScript without emitting files.
- `npm run build` — compile to `dist/`.
- `npm start` — run the compiled application (build first; dotenv loads `.env`).
- `npm test` — run isolated tests without Telegram network access.

## Status

The bot currently validates configuration, starts polling, and responds to `/start` in Armenian for allowed users. Supplier management, persistence, Drive, reminders, and business workflows are not implemented.
