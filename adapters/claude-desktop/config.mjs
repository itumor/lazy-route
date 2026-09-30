// adapters/claude-desktop/config.mjs — env block for ~/.claude/settings.json (terminal
// claude only) + the Desktop 3P gateway values that route the Code tab.
// Desktop's 1P spawn env pins ANTHROPIC_BASE_URL; 3P gateway mode sets it to
// inferenceGatewayBaseUrl instead (docs/CLAUDE-REAL-BINARY-NOTES.md "Claude Desktop").

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

// Values for Desktop → Configure Third-Party Inference… (flat keys as Desktop names them).
// The API key is deliberately absent: the user types it into Desktop's panel.
export function desktopGateway(config) {
  const aliases = (config && config.router && config.router.aliasModels) || ['jev-router']
  return {
    inferenceProvider: 'gateway',
    inferenceGatewayBaseUrl: desktopEnv(config).ANTHROPIC_BASE_URL, // loopback http is accepted
    inferenceGatewayAuthScheme: 'x-api-key', // api.anthropic.com rejects API keys sent as Bearer
    inferenceModels: ['jev-router', ...aliases.filter((m) => m !== 'jev-router')],
  }
}

export function desktopEnvInstructions(config) {
  const { ANTHROPIC_BASE_URL } = desktopEnv(config)
  const gw = desktopGateway(config)
  return [
    '1. Start the routing sidecar once:  node daemon/jev-routerd.mjs',
    '   (or install it as a login service: launchd/systemd unit pointing at the repo)',
    `2. Terminal \`claude\` sessions now use ANTHROPIC_BASE_URL=${ANTHROPIC_BASE_URL}`,
    '',
    'Claude Desktop Code tab ignores settings.json in claude.ai (1P) mode. To route it,',
    'switch Desktop to 3P gateway mode (API-key billing, not your claude.ai plan):',
    '  a. Menu: Enable Developer Mode…  then  Configure Third-Party Inference…',
    `  b. Inference provider: Gateway      Gateway base URL: ${gw.inferenceGatewayBaseUrl}`,
    `  c. Gateway auth scheme: ${gw.inferenceGatewayAuthScheme}   Gateway API key: your Anthropic Console key (type it yourself)`,
    `  d. Model list: ${gw.inferenceModels.join(', ')}  (first = default)`,
    '  e. Apply + relaunch → Code tab picker shows jev-router. Every listed id is aliased, so all get routed.',
  ]
}

// Keys this adapter owns — install --uninstall removes exactly these.
export const DESKTOP_KEYS = Object.freeze([
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_CUSTOM_MODEL_OPTION',
  'ANTHROPIC_CUSTOM_MODEL_OPTION_NAME',
  'ANTHROPIC_CUSTOM_MODEL_OPTION_DESCRIPTION',
])
