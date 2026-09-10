/**
 * Stand-in for AppKit's optional x402 payment modules.
 *
 * AppKit imports these dynamically and works fine without them, but Turbopack
 * resolves every import statically and fails the build when they are absent.
 * Aliasing them here is cheaper than installing payment packages the wallet
 * modal never uses. See next.config.ts.
 */
export default {};
