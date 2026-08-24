/**
 * MVP ONLY: replace before any public deployment.
 *
 * The single hardcoded operator account. The server seeds it on boot, the client
 * prefills the login form with it, and the live e2e suite signs in with it, so it
 * lives here rather than being copied into three packages.
 */
export const MVP_DEV_CREDENTIALS = {
  username: 'Nikos',
  password: 'Nikos',
} as const;
