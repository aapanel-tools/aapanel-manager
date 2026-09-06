/**
 * The app's own GitHub repository — where it publishes its releases. Baked in so
 * the panel checks for its OWN updates out of the box, with zero configuration.
 *
 * This is the project's identity, not a setting: a stock install always knows
 * where to look. An admin only fills in owner/repo (in Settings) when running a
 * fork or a private mirror, and that stored value then overrides this default.
 */
export const HOME_REPO = {owner: 'aapanel-tools', repo: 'aapanel-manager'} as const;
