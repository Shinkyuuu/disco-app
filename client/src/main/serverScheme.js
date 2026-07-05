// Bare host:port (local dev) → plaintext; hostname without a port (hosted,
// behind TLS) → secure. Shared by openLogin (index.js), wsClient.js, and
// profileClient.js so the rule exists in exactly one place.
export function schemeFor(serverAddress, { secure, insecure }) {
  return serverAddress.includes('localhost') || /:\d+$/.test(serverAddress) ? insecure : secure;
}
