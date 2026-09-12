#!/usr/bin/env tsx
import { readFileSync } from 'node:fs';

for (const line of readFileSync('.env', 'utf8').split('\n')) {
  const match = line.match(/^([A-Z_][A-Z0-9_]*)="(.+)"$/);
  if (match) process.env[match[1]!] = match[2]!;
}

const { BedrockProvider } = await import('../packages/ai-provider/src/bedrock.ts');

const provider = new BedrockProvider({
  region: process.env.AWS_REGION ?? 'us-east-1',
  apiKey: process.env.BEDROCK_API_KEY,
  chatModel: 'us.anthropic.claude-sonnet-4-6',
  premiumModel: 'us.anthropic.claude-sonnet-4-6',
  classifierModel: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
});

const models = [
  'us.anthropic.claude-opus-4-20250514-v1:0',
  'us.anthropic.claude-opus-4-5-20251101-v1:0',
];

for (const model of models) {
  try {
    const result = await provider.complete({
      model,
      messages: [{ role: 'user', content: 'Say hi in 3 words.' }],
      maxTokens: 20,
      temperature: 0,
    });
    console.log(`OK  ${model}: "${result.text}"`);
  } catch (e: any) {
    const msg = e.cause?.message?.slice(0, 120) ?? e.message?.slice(0, 120);
    console.log(`ERR ${model}: ${msg}`);
  }
}
