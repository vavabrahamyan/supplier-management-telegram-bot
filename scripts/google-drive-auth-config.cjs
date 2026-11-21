function credentialsError(env) {
  return !env.GOOGLE_CLIENT_ID?.trim() || !env.GOOGLE_CLIENT_SECRET?.trim()
    ? 'Google Drive authorization failed: set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in the project .env file.'
    : null;
}
module.exports = { credentialsError };

// Only known codes are shown; raw errors can contain authorization codes or tokens.
function authorizationError(stage, error) {
  const oauth = error?.response?.data?.error;
  if (stage === 'exchange') {
    if (oauth === 'invalid_client') return 'Google rejected the OAuth client. Check that the client ID and secret belong to the same Desktop app client.';
    if (oauth === 'invalid_grant') return 'Google rejected the authorization code. Start again with a new link and check the computer clock.';
    if (oauth === 'access_denied') return 'Google denied authorization. Check the consent screen and test-user access.';
    return 'Could not exchange the authorization code with Google. Check the network and OAuth client settings.';
  }
  if (stage === 'refresh') return 'Google did not provide a refresh token. Start again and grant consent.';
  if (stage === 'save') {
    if (error?.code === 'EEXIST') return 'The token file already exists; it was not overwritten. Check GOOGLE_TOKEN_PATH.';
    if (error?.code === 'EACCES' || error?.code === 'EPERM' || error?.code === 'EROFS') return 'Cannot save the token file. Check directory permissions and GOOGLE_TOKEN_PATH.';
    return 'Could not save the token file. Check GOOGLE_TOKEN_PATH and available disk space.';
  }
  if (stage === 'callback') return 'Authorization was denied or timed out. Start again with a new link.';
  return 'Could not start the local authorization listener. Check the local network configuration.';
}
module.exports.authorizationError = authorizationError;
