// 4001 (not in voice channel) means the token is still valid - the user is just
// not currently in the tracked VC (and might join it later) - so it must not be
// treated the same as an actually-bad token (invalid/expired: 4002/4003/4008),
// which requires clearing the stored token and forcing a fresh login. Keyed on
// the numeric close code (see gateway.js), not the close reason's exact text -
// matching on that text would silently break if the server's wording ever changed.
export function isRetryableAuthFailure(code) {
  return code === 4001;
}
