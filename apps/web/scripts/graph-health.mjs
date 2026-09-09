#!/usr/bin/env node
/**
 * Probes every configured subgraph before a demo.
 *
 * Graph Explorer showing a subgraph as published and un-deprecated does NOT mean
 * indexers are serving it at a current block. This is the only way to tell, and
 * the Messari deployments we rely on were last published in 2024, so it is worth
 * running before trusting them.
 */
import { readFileSync } from 'node:fs';

const key = process.env.GRAPH_GATEWAY_API_KEY;
if (!key) {
  console.error('GRAPH_GATEWAY_API_KEY is not set. Get one from https://thegraph.com/studio/');
  process.exit(1);
}

const sourcesFile = readFileSync(
  new URL('../src/server/modules/graph/sources.ts', import.meta.url),
  'utf8',
);
const entries = [
  ...sourcesFile.matchAll(/key:\s*'([^']+)',[\s\S]*?subgraphId:\s*'([^']+)'/g),
].map(([, name, id]) => ({ name, id }));

const ensId = sourcesFile.match(/ENS_SUBGRAPH_ID = '([^']+)'/)?.[1];
if (ensId) entries.push({ name: 'ens', id: ensId });

const QUERY = '{ _meta { block { number } hasIndexingErrors } }';
let unhealthy = 0;

for (const { name, id } of entries) {
  let body = null;
  try {
    const response = await fetch(`https://gateway.thegraph.com/api/subgraphs/id/${id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ query: QUERY }),
    });
    body = await response.json();
  } catch {
    body = null;
  }

  // The gateway answers 200 with a GraphQL error envelope for auth failures and
  // unknown ids alike, so the body has to be inspected either way.
  if (!body || body.errors) {
    console.log(`FAIL  ${name.padEnd(24)} ${body?.errors?.[0]?.message ?? 'unreachable'}`);
    unhealthy += 1;
    continue;
  }

  const meta = body.data?._meta;
  const flag = meta?.hasIndexingErrors ? '  (indexing errors)' : '';
  console.log(`ok    ${name.padEnd(24)} block ${meta?.block?.number}${flag}`);
  if (meta?.hasIndexingErrors) unhealthy += 1;
}

console.log(`\n${entries.length - unhealthy}/${entries.length} healthy`);
process.exit(unhealthy > 0 ? 1 : 0);
