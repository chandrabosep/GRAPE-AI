#!/usr/bin/env node
/**
 * Probes every configured subgraph before a demo.
 *
 * Graph Explorer showing a subgraph as published and un-deprecated does NOT mean
 * indexers are serving it at a current block. This is the only way to tell, and
 * the Messari deployments we rely on were last published in 2024, so it is worth
 * running before trusting them.
 *
 * It probes a real data query, not only `_meta`. A deployment whose indexers
 * return `no attestation: indexing_error` still answers `_meta` with a block
 * height, so a `_meta`-only check reports it healthy while every query the app
 * actually makes fails. balancer-v2 sat in the registry that way.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

// The workspace keeps a single .env at the repo root, the same arrangement
// next.config.ts loads. Without this the script reports a missing key that is
// sitting in the file the app itself reads.
const here = dirname(fileURLToPath(import.meta.url));
for (const candidate of [join(here, '..', '..', '..', '.env'), join(here, '..', '.env')]) {
  if (existsSync(candidate)) loadEnv({ path: candidate, override: false });
}

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
  ...sourcesFile.matchAll(
    /key:\s*'([^']+)',[\s\S]*?type:\s*'([^']+)',[\s\S]*?subgraphId:\s*'([^']+)'/g,
  ),
].map(([, name, type, id]) => ({ name, type, id }));

const ensId = sourcesFile.match(/^export const ENS_SUBGRAPH_ID = '([^']+)'/m)?.[1];
if (ensId) entries.push({ name: 'ens', type: 'ens', id: ensId });

const META_QUERY = '{ _meta { block { number } hasIndexingErrors } }';
const DATA_QUERY = {
  lending: '{ lendingProtocols(first: 1) { id name } }',
  dex: '{ dexAmmProtocols(first: 1) { id name } }',
  ens: '{ domains(first: 1) { id } }',
};

async function query(id, gql) {
  try {
    const response = await fetch(`https://gateway.thegraph.com/api/subgraphs/id/${id}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ query: gql }),
    });
    return await response.json();
  } catch {
    return null;
  }
}

let unhealthy = 0;

for (const { name, type, id } of entries) {
  const meta = await query(id, META_QUERY);

  // The gateway answers 200 with a GraphQL error envelope for auth failures and
  // unknown ids alike, so the body has to be inspected either way.
  if (!meta || meta.errors) {
    console.log(`FAIL  ${name.padEnd(24)} ${meta?.errors?.[0]?.message ?? 'unreachable'}`);
    unhealthy += 1;
    continue;
  }

  const block = meta.data?._meta?.block?.number;
  const hasIndexingErrors = meta.data?._meta?.hasIndexingErrors;

  // The part `_meta` cannot tell us: whether a real query is actually served.
  const data = await query(id, DATA_QUERY[type] ?? DATA_QUERY.dex);
  if (!data || data.errors) {
    console.log(
      `FAIL  ${name.padEnd(24)} block ${block} but data query failed: ` +
        `${data?.errors?.[0]?.message?.slice(0, 80) ?? 'unreachable'}`,
    );
    unhealthy += 1;
    continue;
  }

  const flag = hasIndexingErrors ? '  (indexing errors)' : '';
  console.log(`ok    ${name.padEnd(24)} block ${block}${flag}`);
  if (hasIndexingErrors) unhealthy += 1;
}

console.log(`\n${entries.length - unhealthy}/${entries.length} healthy`);
process.exit(unhealthy > 0 ? 1 : 0);
