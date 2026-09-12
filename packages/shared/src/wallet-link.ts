/**
 * The message a user signs to link a wallet as their targeting signal source.
 *
 * It lives in `shared` because the browser builds this string and the server
 * rebuilds it to compare byte for byte. Two copies of the format would drift,
 * and the only symptom would be every link attempt failing verification for no
 * visible reason.
 *
 * The nonce is issued by the server and burned on use, so a signature captured
 * anywhere cannot be replayed to claim someone else's address — which is the
 * whole point of the signature, since onchain signals follow the address.
 */

export const WALLET_LINK_STATEMENT = 'Link this wallet to your AI Attention Marketplace account.';

export function linkMessage(address: string, nonce: string): string {
  return [
    WALLET_LINK_STATEMENT,
    '',
    `Address: ${address}`,
    `Nonce: ${nonce}`,
    '',
    'This proves you control the wallet. It grants no spending permission.',
  ].join('\n');
}

/** Reads the nonce back out of a signed message so the server can burn it. */
export function parseLinkNonce(message: string): string | null {
  return /^Nonce: (\S+)$/m.exec(message)?.[1] ?? null;
}
