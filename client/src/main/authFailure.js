// "not in voice channel" means the token is still valid - the user is just not
// currently in the tracked VC (and might join it later) - so it must not be
// treated the same as an actually-bad token (invalid/expired), which requires
// clearing the stored token and forcing a fresh login.
export function isRetryableAuthFailure(reason) {
  return reason === 'not in voice channel';
}
