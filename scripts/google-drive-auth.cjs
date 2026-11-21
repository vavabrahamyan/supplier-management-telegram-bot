require('dotenv').config({ quiet: true });
const { google } = require('googleapis');
const { createServer } = require('node:http');
const { randomBytes, createHash, timingSafeEqual } = require('node:crypto');
const { mkdirSync, writeFileSync } = require('node:fs');
const { dirname } = require('node:path');
const { credentialsError, authorizationError } = require('./google-drive-auth-config.cjs');

async function main() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const configError = credentialsError(process.env);
  if (configError) {
    console.error(configError);
    process.exitCode = 1;
    return;
  }
  const path = process.env.GOOGLE_TOKEN_PATH || './data/google-drive-token.json';
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(48).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const server = createServer();
  let stage = 'listener';
  let browserResponse;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const redirect = `http://127.0.0.1:${server.address().port}/oauth2callback`;
  const auth = new google.auth.OAuth2(clientId, clientSecret, redirect);
  const url = auth.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: ['https://www.googleapis.com/auth/drive.file'], state, code_challenge: challenge, code_challenge_method: 'S256' });
  console.log('Open this URL in your browser to authorize Google Drive:');
  console.log(url);
  try {
    stage = 'callback';
    const code = await new Promise((resolve, reject) => {
      let claimed = false;
      const timeout = setTimeout(() => reject(new Error('Authorization timed out')), 300000);
      server.on('request', (request, response) => {
        const callback = new URL(request.url || '/', redirect);
        if (callback.pathname !== '/oauth2callback') { response.writeHead(404).end(); return; }
        const returnedState = callback.searchParams.get('state') || '';
        if (Buffer.byteLength(returnedState) !== Buffer.byteLength(state) || !timingSafeEqual(Buffer.from(returnedState), Buffer.from(state))) { response.writeHead(400).end('Invalid request'); return; }
        if (claimed) { response.writeHead(409).end('Authorization is already being processed.'); return; }
        claimed = true;
        clearTimeout(timeout);
        const value = callback.searchParams.get('code');
        if (!value) { response.writeHead(400).end('Authorization failed'); reject(new Error('Authorization failed')); return; }
        browserResponse = response;
        resolve(value);
      });
    });
    stage = 'exchange';
    const { tokens } = await auth.getToken({ code, codeVerifier: verifier });
    stage = 'refresh';
    if (!tokens.refresh_token) throw new Error('No refresh token returned; retry and grant consent');
    stage = 'save';
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, JSON.stringify({ refresh_token: tokens.refresh_token }), { mode: 0o600, flag: 'wx' });
    browserResponse.end('Authorization completed and saved. You may close this window.');
    console.log('Google Drive authorization saved.');
  } catch (error) {
    const message = authorizationError(stage, error);
    if (browserResponse && !browserResponse.writableEnded) browserResponse.writeHead(500).end('Authorization could not be saved. Check the terminal for details.');
    console.error(`Google Drive authorization failed: ${message}`);
    process.exitCode = 1;
  } finally { server.close(); }
}
main().catch(() => { console.error('Google Drive authorization failed. Check your configuration and try again.'); process.exitCode = 1; });
