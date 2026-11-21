import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { credentialsError } = require('../scripts/google-drive-auth-config.cjs') as { credentialsError(env: Record<string, string>): string | null };
test('authorization explains missing credentials without exposing values', () => {
  const error = credentialsError({ GOOGLE_CLIENT_ID: 'private-value', GOOGLE_CLIENT_SECRET: ' ' });
  assert.match(error!, /set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the project \.env file/);
  assert.doesNotMatch(error!, /private-value/);
  assert.equal(credentialsError({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' }), null);
});

test('authorization diagnostics reveal only safe, actionable error categories', () => {
  const { authorizationError } = require('../scripts/google-drive-auth-config.cjs') as { authorizationError(stage: string, error: unknown): string };
  assert.match(authorizationError('exchange', { response: { data: { error: 'invalid_client' } } }), /client ID and secret/);
  assert.match(authorizationError('exchange', { response: { data: { error: 'invalid_grant' } } }), /new link/);
  assert.match(authorizationError('refresh', {}), /refresh token/);
  assert.match(authorizationError('save', { code: 'EEXIST' }), /already exists/);
  assert.match(authorizationError('save', { code: 'EACCES' }), /permissions/);
  assert.doesNotMatch(authorizationError('exchange', { message: 'secret-token', response: { data: { error: 'secret-token' } } }), /secret-token/);
});
