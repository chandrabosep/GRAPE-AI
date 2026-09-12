import { createApp } from './app';
import { env } from './config';
import { toHbar, tiers } from './pricing';

const app = createApp();

app.listen(env().X402_API_PORT, () => {
  console.log(`x402 inference API on http://localhost:${env().X402_API_PORT}`);
  console.log(`  network     ${env().X402_NETWORK}`);
  console.log(`  payTo       ${env().HEDERA_SERVICE_ACCOUNT_ID}`);
  console.log(`  facilitator ${env().X402_FACILITATOR_URL}`);
  for (const tier of tiers()) {
    console.log(
      `  ${tier.path.padEnd(22)} ${toHbar(tier.tinybars)} HBAR  ≤${tier.maxOutputTokens} output tokens`,
    );
  }
});
