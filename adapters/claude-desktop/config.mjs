// adapters/claude-desktop/config.mjs — env block + instructions for Claude Code Desktop.
// Desktop local sessions share the CLI's env config; the env editor (Developer settings)
// is the supported no-terminal way to apply this.

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
    '2. Claude Desktop → Settings → Developer → Environment variables (local sessions)',
    `3. Add the printed env block (ANTHROPIC_BASE_URL=${ANTHROPIC_BASE_URL} + the custom model option vars)`,
    '4. Open the Code tab → model picker → select "JEV Router"',
    '5. Type normally — every fresh turn is routed to the cheapest sufficient tier+effort',
    'Note: the custom model option row in the Desktop picker is documented CLI parity',
    'behavior; verify it renders in your Desktop version (fallback: use the CLI launcher).',
  ]
}

// Keys this adapter owns — install --uninstall removes exactly these.
export const DESKTOP_KEYS = Object.freeze([
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_CUSTOM_MODEL_OPTION',
  'ANTHROPIC_CUSTOM_MODEL_OPTION_NAME',
  'ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION',
])
