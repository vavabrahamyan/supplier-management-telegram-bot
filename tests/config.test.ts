import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config/config.ts';

const valid = { BOT_TOKEN: 'test-token', ALLOWED_TELEGRAM_USERNAMES: '@Alice, BOB_123' };
test('loads valid settings and defaults', () => {
  const config = loadConfig(valid);
  assert.deepEqual([...config.allowedTelegramUsernames], ['alice', 'bob_123']);
  assert.equal(config.timezone, 'Asia/Yerevan');
  assert.equal(config.logLevel, 'info');
});
test('requires a token and an explicit valid allowlist', () => {
  assert.throws(() => loadConfig({ ...valid, BOT_TOKEN: '' }), /BOT_TOKEN/);
  for (const value of ['', 'alice,', '@', 'name.with.dot', 'a'.repeat(33)]) {
    assert.throws(() => loadConfig({ ...valid, ALLOWED_TELEGRAM_USERNAMES: value }), /ALLOWED_TELEGRAM_USERNAMES/);
  }
});
test('rejects invalid time zones and log levels without echoing values', () => {
  assert.throws(() => loadConfig({ ...valid, TIMEZONE: 'invalid' }), /TIMEZONE/);
  assert.throws(() => loadConfig({ ...valid, LOG_LEVEL: 'invalid' }), /LOG_LEVEL/);
});
