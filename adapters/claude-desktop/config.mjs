// adapters/claude-desktop/config.mjs — env block + instructions for ~/.claude/settings.json.
// Only terminal claude sessions honor it: Desktop's spawn env pins ANTHROPIC_BASE_URL
// (docs/CLAUDE-REAL-BINARY-NOTES.md "Claude Desktop").

export function desktopEnv(config) {
  const host = (config && config.daemon && config.daemon.host) || '127.0.0.1'
  const port = (config && config.daemon && config.daemon.port) || 38471
  return {
    ANTHROPIC_BASE_URL: `http://${host}:${port}`,
    ANTHROPIC_CUSTOM_MODEL_OPTION: 'jev-router',
    ANTHROPIC_CUSTOM_MODEL_OPTION_NAME: 'JEV Router',
    ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION: 'Automatically choose model and effort per turn via JEV',
  }
}

export function desktopEnvInstructions(config) {
  const { ANTHROPIC_BASE_URL } = desktopEnv(config)
  return [
    '1. Start the routing sidecar once:  node daemon/jev-routerd.mjs',
    '   (or install it as a login service: launchd/systemd unit pointing at the repo)',
    `2. Terminal \`claude\` sessions now use ANTHROPIC_BASE_URL=${ANTHROPIC_BASE_URL}`,
    '3. Type normally — every fresh turn is routed to the cheapest sufficient tier+effort',
    'WARNING: Claude Desktop (Code tab) ignores this. Desktop spawns sessions with',
    'ANTHROPIC_BASE_URL=https://api.anthropic.com and host-spawn env beats settings.json',
    '(verified Desktop 2.16120.0 / claude 2.1.284). Use the CLI launcher instead.',
  ]
}

// Keys this adapter owns — install --uninstall removes exactly these.
export const DESKTOP_KEYS = Object.freeze([
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_CUSTOM_MODEL_OPTION',
  'ANTHROPIC_CUSTOM_MODEL_OPTION_NAME',
  'ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION',
])
