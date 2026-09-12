/**
 * The closed vocabulary that connects AI intent to advertiser targeting.
 *
 * Everything the ad engine sees about a user is expressed in these values.
 * Raw prompts never leave the AI gateway, so this file is the entire surface
 * area an advertiser can target on. Keep it small, readable and stable:
 * campaigns store these strings, so removing a value breaks live targeting.
 */

export const INTENT_CATEGORIES = [
  'development',
  'debugging',
  'infrastructure',
  'learning',
  'data',
  'security',
  'other',
] as const;
export type IntentCategory = (typeof INTENT_CATEGORIES)[number];

/**
 * What the developer is trying to accomplish. Ordered by domain so the
 * advertiser UI can group them without a second mapping table.
 */
export const AI_INTENTS = [
  // web3 build
  'smart_contract_development',
  'smart_contract_deployment',
  'smart_contract_testing',
  'smart_contract_audit',
  'frontend_dapp_development',
  'wallet_integration',
  'defi_integration',
  'nft_development',
  'onchain_agent_development',
  // web3 infrastructure
  'rpc_infrastructure_evaluation',
  'indexing_querying_onchain_data',
  'node_operations',
  // general build
  'backend_api_development',
  'frontend_development',
  'database_design',
  'ai_ml_integration',
  'payments_integration',
  'auth_integration',
  // operate
  'devops_deployment',
  'cloud_infrastructure',
  'observability_monitoring',
  'performance_optimization',
  'security_hardening',
  // maintain
  'bug_fixing',
  'code_explanation',
  'refactoring',
  'testing',
  'general_coding',
] as const;
export type AIIntentKind = (typeof AI_INTENTS)[number];

/** Coarse grouping used when the classifier is confident about the area but not the task. */
export const INTENT_TO_CATEGORY: Record<AIIntentKind, IntentCategory> = {
  smart_contract_development: 'development',
  smart_contract_deployment: 'infrastructure',
  smart_contract_testing: 'development',
  smart_contract_audit: 'security',
  frontend_dapp_development: 'development',
  wallet_integration: 'development',
  defi_integration: 'development',
  nft_development: 'development',
  onchain_agent_development: 'development',
  rpc_infrastructure_evaluation: 'infrastructure',
  indexing_querying_onchain_data: 'data',
  node_operations: 'infrastructure',
  backend_api_development: 'development',
  frontend_development: 'development',
  database_design: 'data',
  ai_ml_integration: 'development',
  payments_integration: 'development',
  auth_integration: 'development',
  devops_deployment: 'infrastructure',
  cloud_infrastructure: 'infrastructure',
  observability_monitoring: 'infrastructure',
  performance_optimization: 'development',
  security_hardening: 'security',
  bug_fixing: 'debugging',
  code_explanation: 'learning',
  refactoring: 'development',
  testing: 'development',
  general_coding: 'other',
};

export const TECHNOLOGIES = [
  // chains & protocols
  'ethereum',
  'hedera',
  'base',
  'arbitrum',
  'optimism',
  'polygon',
  'solana',
  // smart contracts
  'solidity',
  'vyper',
  'foundry',
  'hardhat',
  'openzeppelin',
  // web3 clients & data
  'viem',
  'ethers',
  'wagmi',
  'thegraph',
  'subgraph',
  'substreams',
  'ipfs',
  'x402',
  'walletconnect',
  'privy',
  // languages
  'typescript',
  'javascript',
  'python',
  'rust',
  'go',
  'java',
  // frameworks
  'react',
  'nextjs',
  'vue',
  'svelte',
  'node',
  'express',
  'fastify',
  'nestjs',
  // data & infra
  'postgres',
  'mysql',
  'mongodb',
  'redis',
  'prisma',
  'supabase',
  'docker',
  'kubernetes',
  'terraform',
  'aws',
  'gcp',
  'azure',
  'vercel',
  'cloudflare',
  // ai
  'bedrock',
  'openai',
  'anthropic',
  'langchain',
] as const;
export type Technology = (typeof TECHNOLOGIES)[number];

/**
 * The domain groups `AI_INTENTS` and `TECHNOLOGIES` are already ordered by,
 * promoted out of comments and into data.
 *
 * The ordering above was written so "the advertiser UI can group them without a
 * second mapping table" — but a comment is not something a component can read,
 * so the UI rendered all 28 intents and all 54 technologies as one flat wall
 * each. These are that same grouping, in a form the UI can actually use.
 *
 * Not to be confused with `INTENT_TO_CATEGORY`. That one is the classifier's
 * coarse fallback when it knows the area but not the task, and it splits things
 * the advertiser thinks of together — `smart_contract_deployment` lands under
 * `infrastructure`, away from the other contract work. These groups are for
 * choosing; that map is for classifying.
 *
 * The two `Assert` lines below are the reason this stays honest: adding a value
 * to `AI_INTENTS` or `TECHNOLOGIES` without putting it in a group is a type
 * error, not a value that quietly disappears from the picker.
 */
export const AI_INTENT_GROUPS = [
  {
    label: 'Onchain build',
    items: [
      'smart_contract_development',
      'smart_contract_deployment',
      'smart_contract_testing',
      'smart_contract_audit',
      'frontend_dapp_development',
      'wallet_integration',
      'defi_integration',
      'nft_development',
      'onchain_agent_development',
    ],
  },
  {
    label: 'Onchain infrastructure',
    items: ['rpc_infrastructure_evaluation', 'indexing_querying_onchain_data', 'node_operations'],
  },
  {
    label: 'General build',
    items: [
      'backend_api_development',
      'frontend_development',
      'database_design',
      'ai_ml_integration',
      'payments_integration',
      'auth_integration',
    ],
  },
  {
    label: 'Ship and operate',
    items: [
      'devops_deployment',
      'cloud_infrastructure',
      'observability_monitoring',
      'performance_optimization',
      'security_hardening',
    ],
  },
  {
    label: 'Maintain and fix',
    items: ['bug_fixing', 'code_explanation', 'refactoring', 'testing', 'general_coding'],
  },
] as const satisfies readonly { label: string; items: readonly AIIntentKind[] }[];

export const TECHNOLOGY_GROUPS = [
  {
    label: 'Chains and protocols',
    items: ['ethereum', 'hedera', 'base', 'arbitrum', 'optimism', 'polygon', 'solana'],
  },
  {
    label: 'Smart contracts',
    items: ['solidity', 'vyper', 'foundry', 'hardhat', 'openzeppelin'],
  },
  {
    label: 'Onchain clients and data',
    items: [
      'viem',
      'ethers',
      'wagmi',
      'thegraph',
      'subgraph',
      'substreams',
      'ipfs',
      'x402',
      'walletconnect',
      'privy',
    ],
  },
  {
    label: 'Languages',
    items: ['typescript', 'javascript', 'python', 'rust', 'go', 'java'],
  },
  {
    label: 'Frameworks',
    items: ['react', 'nextjs', 'vue', 'svelte', 'node', 'express', 'fastify', 'nestjs'],
  },
  {
    label: 'Data and infrastructure',
    items: [
      'postgres',
      'mysql',
      'mongodb',
      'redis',
      'prisma',
      'supabase',
      'docker',
      'kubernetes',
      'terraform',
      'aws',
      'gcp',
      'azure',
      'vercel',
      'cloudflare',
    ],
  },
  {
    label: 'AI',
    items: ['bedrock', 'openai', 'anthropic', 'langchain'],
  },
] as const satisfies readonly { label: string; items: readonly Technology[] }[];

/** Resolves to `never` only when every value is covered; anything left over
    becomes the error message. */
type Assert<T extends never> = T;
type _EveryIntentIsGrouped = Assert<
  Exclude<AIIntentKind, (typeof AI_INTENT_GROUPS)[number]['items'][number]>
>;
type _EveryTechnologyIsGrouped = Assert<
  Exclude<Technology, (typeof TECHNOLOGY_GROUPS)[number]['items'][number]>
>;

export const PERSONAS = [
  'web3_developer',
  'fullstack_developer',
  'backend_developer',
  'frontend_developer',
  'devops_engineer',
  'data_engineer',
  'security_engineer',
  'student',
  'founder',
] as const;
export type Persona = (typeof PERSONAS)[number];

/**
 * How close the request is to a buying decision. `high` means the developer is
 * evaluating, comparing or choosing a paid product right now, which is the
 * inventory advertisers actually want.
 */
export const COMMERCIAL_INTENTS = ['low', 'medium', 'high'] as const;
export type CommercialIntent = (typeof COMMERCIAL_INTENTS)[number];

export const COMMERCIAL_INTENT_RANK: Record<CommercialIntent, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

/** Broad interest buckets an advertiser can target without naming a technology. */
export const INTERESTS = [
  'web3',
  'defi',
  'nfts',
  'daos',
  'infrastructure',
  'devtools',
  'ai',
  'data',
  'security',
  'payments',
  'gaming',
  'startups',
] as const;
export type Interest = (typeof INTERESTS)[number];

export function isTechnology(value: string): value is Technology {
  return (TECHNOLOGIES as readonly string[]).includes(value);
}

export function isAIIntentKind(value: string): value is AIIntentKind {
  return (AI_INTENTS as readonly string[]).includes(value);
}
