import type { AIIntentKind, Persona, Technology } from '@aam/shared';

/**
 * Keyword dictionaries for the rules-based intent classifier.
 *
 * This stage exists for two reasons beyond speed. It gives ad selection a usable
 * answer in under a millisecond so the sponsored card can appear while the model
 * is still streaming, and it is pure string matching with no network call, which
 * is what makes an on-device "local intent" mode viable later. Keep every rule
 * here dependency-free.
 */

/** Aliases are matched on word boundaries, so short entries are safe. */
export const TECHNOLOGY_ALIASES: Partial<Record<Technology, string[]>> = {
  ethereum: ['ethereum', 'eth', 'evm', 'mainnet', 'erc20', 'erc-20', 'erc721', 'erc-721'],
  hedera: ['hedera', 'hbar', 'hashgraph', 'hts', 'hcs'],
  base: ['base sepolia', 'basescan'],
  arbitrum: ['arbitrum', 'arbiscan'],
  optimism: ['optimism'],
  polygon: ['polygon', 'matic'],
  solana: ['solana', 'anchor lang'],

  solidity: ['solidity', 'smart contract', 'smart contracts', '.sol'],
  vyper: ['vyper'],
  foundry: ['foundry', 'forge', 'anvil', 'cast call'],
  hardhat: ['hardhat'],
  openzeppelin: ['openzeppelin', 'ozerc'],

  viem: ['viem'],
  ethers: ['ethers', 'ethers.js', 'ethersjs'],
  wagmi: ['wagmi'],
  thegraph: ['the graph', 'thegraph', 'graph protocol', 'graphql subgraph'],
  subgraph: ['subgraph', 'subgraphs'],
  substreams: ['substreams'],
  ipfs: ['ipfs', 'pinata'],
  x402: ['x402', '402 payment'],
  walletconnect: ['walletconnect'],
  privy: ['privy'],

  typescript: ['typescript', 'ts', 'tsx'],
  javascript: ['javascript', 'js', 'node.js'],
  python: ['python', 'py', 'pip'],
  rust: ['rust', 'cargo'],
  go: ['golang'],
  java: ['java', 'maven', 'gradle'],

  react: ['react', 'jsx', 'usestate', 'useeffect'],
  nextjs: ['next.js', 'nextjs', 'app router'],
  vue: ['vue', 'nuxt'],
  svelte: ['svelte', 'sveltekit'],
  node: ['node', 'npm', 'pnpm'],
  express: ['express'],
  fastify: ['fastify'],
  nestjs: ['nestjs', 'nest.js'],

  postgres: ['postgres', 'postgresql', 'psql'],
  mysql: ['mysql'],
  mongodb: ['mongodb', 'mongo'],
  redis: ['redis'],
  prisma: ['prisma'],
  supabase: ['supabase'],
  docker: ['docker', 'dockerfile', 'docker-compose'],
  kubernetes: ['kubernetes', 'k8s', 'kubectl', 'helm'],
  terraform: ['terraform'],
  aws: ['aws', 'amazon web services', 's3', 'lambda', 'ec2', 'bedrock'],
  gcp: ['gcp', 'google cloud'],
  azure: ['azure'],
  vercel: ['vercel'],
  cloudflare: ['cloudflare', 'workers'],

  bedrock: ['bedrock', 'converse api'],
  openai: ['openai', 'gpt-4', 'gpt4'],
  anthropic: ['anthropic', 'claude'],
  langchain: ['langchain'],
};

/**
 * Technologies that necessarily imply another one. A developer writing a
 * subgraph is using The Graph whether or not they name it, and targeting should
 * see that.
 */
export const TECHNOLOGY_IMPLIES: Partial<Record<Technology, Technology[]>> = {
  subgraph: ['thegraph'],
  substreams: ['thegraph'],
  solidity: ['ethereum'],
  vyper: ['ethereum'],
  foundry: ['solidity', 'ethereum'],
  hardhat: ['solidity', 'ethereum'],
  wagmi: ['viem', 'react'],
  nextjs: ['react'],
  openzeppelin: ['solidity'],
};

/** VS Code language ids that imply a technology without the prompt saying so. */
export const LANGUAGE_ID_TECHNOLOGIES: Record<string, Technology[]> = {
  solidity: ['solidity', 'ethereum'],
  typescript: ['typescript'],
  typescriptreact: ['typescript', 'react'],
  javascript: ['javascript'],
  javascriptreact: ['javascript', 'react'],
  python: ['python'],
  rust: ['rust'],
  go: ['go'],
  java: ['java'],
  sql: ['postgres'],
  dockerfile: ['docker'],
  yaml: ['kubernetes'],
  hcl: ['terraform'],
  prisma: ['prisma'],
  vue: ['vue'],
  svelte: ['svelte'],
};

export interface IntentRule {
  intent: AIIntentKind;
  /** Any match counts. Ordered by specificity; the most specific rules come first. */
  patterns: RegExp[];
  /** Only applies when at least one of these technologies is present. */
  requiresAnyTechnology?: Technology[];
  weight: number;
}

/**
 * Ordered most-specific first. A rule that also matches its required technology
 * outranks a generic verb match, which is what stops "how do I fix this" from
 * swallowing "how do I fix this failing deployment".
 */
export const INTENT_RULES: IntentRule[] = [
  {
    intent: 'smart_contract_deployment',
    patterns: [
      /\b(deploy|deploying|deployment|publish)\b[^.?!]{0,40}\b(contract|contracts|token|dapp)\b/,
      /\bforge\s+(create|script)\b/,
      /\b(deploy|deploying)\b[^.?!]{0,30}\b(mainnet|testnet|sepolia|anvil)\b/,
      /\bverify\b[^.?!]{0,30}\b(etherscan|hashscan|basescan)\b/,
    ],
    weight: 3,
  },
  {
    intent: 'smart_contract_audit',
    patterns: [
      /\b(audit|reentrancy|vulnerab\w*|exploit|attack vector)\b/,
      /\b(secure|security)\b[^.?!]{0,30}\b(contract|contracts)\b/,
    ],
    requiresAnyTechnology: ['solidity', 'ethereum', 'vyper'],
    weight: 3,
  },
  {
    intent: 'smart_contract_testing',
    patterns: [
      /\b(test|tests|testing|fuzz|invariant)\b[^.?!]{0,30}\b(contract|contracts)\b/,
      /\bforge\s+test\b/,
    ],
    weight: 3,
  },
  {
    intent: 'smart_contract_development',
    patterns: [
      /\b(write|writing|implement|create|build)\b[^.?!]{0,40}\b(contract|contracts|erc-?20|erc-?721|nft)\b/,
      /\b(modifier|mapping|payable|msg\.sender|require\()/,
    ],
    weight: 2,
  },
  {
    intent: 'indexing_querying_onchain_data',
    patterns: [
      /\b(index|indexing|query|querying)\b[^.?!]{0,40}\b(onchain|on-chain|blockchain|events|logs)\b/,
      /\bsubgraph\b/,
      /\bsubstreams\b/,
    ],
    weight: 3,
  },
  {
    intent: 'rpc_infrastructure_evaluation',
    patterns: [
      /\b(rpc|node provider|endpoint)\b[^.?!]{0,40}\b(provider|providers|compare|comparison|best|fastest|cheapest|pricing)\b/,
      /\b(compare|comparison|versus|vs\.?|which)\b[^.?!]{0,40}\b(rpc|infura|alchemy|quicknode)\b/,
    ],
    weight: 3,
  },
  {
    intent: 'wallet_integration',
    patterns: [
      /\b(connect|connecting|integrate|integrating)\b[^.?!]{0,30}\bwallet\b/,
      /\bwalletconnect\b/,
      /\bembedded wallet\b/,
    ],
    weight: 3,
  },
  {
    intent: 'defi_integration',
    patterns: [
      /\b(swap|liquidity|lending|borrow|yield|amm|pool)\b/,
      /\b(uniswap|aave|compound|curve|morpho)\b/,
    ],
    weight: 2,
  },
  {
    intent: 'nft_development',
    patterns: [/\b(nft|erc-?721|erc-?1155|mint|metadata uri)\b/],
    weight: 2,
  },
  {
    intent: 'onchain_agent_development',
    patterns: [/\b(ai agent|autonomous agent|agentic)\b/, /\bx402\b/],
    weight: 3,
  },
  {
    intent: 'frontend_dapp_development',
    patterns: [
      /\b(dapp|web3 app)\b/,
      /\b(wagmi|viem|ethers)\b[^.?!]{0,40}\b(react|component|hook)\b/,
    ],
    weight: 2,
  },
  {
    intent: 'payments_integration',
    patterns: [/\b(payment|payments|checkout|stripe|billing|invoice|subscription)\b/],
    weight: 2,
  },
  {
    intent: 'auth_integration',
    patterns: [/\b(auth|authentication|oauth|login|jwt|session|sso)\b/],
    weight: 2,
  },
  {
    intent: 'cloud_infrastructure',
    patterns: [
      /\b(s3|lambda|ec2|cloudfront|iam role|bucket)\b/,
      /\b(aws|gcp|azure|cloudflare|digitalocean|terraform|pulumi|cloudformation)\b/,
    ],
    weight: 2,
  },
  {
    /**
     * Deployment vocabulary on its own is enough.
     *
     * This rule used to require two terms within thirty characters of each
     * other — a deployment verb *and* a piece of infrastructure. Almost no real
     * question is phrased that way: "how do I run containers in production with
     * Docker" names the tool and the environment but never the verb, and fell
     * through to `general_coding`. That mattered more than it looks, because the
     * inline slot is auctioned on this pass alone and an unclassified question
     * has nothing for a campaign to target, so the slot stayed empty on exactly
     * the questions infrastructure advertisers are bidding for.
     *
     * The conjunctions are gone, but the weight is not raised: a bare "deploy"
     * still loses to `smart_contract_deployment`, which matches the same verb
     * alongside a contract and outranks this at weight 3.
     */
    intent: 'devops_deployment',
    patterns: [
      /\b(deploy|deploys|deploying|deployment|deployments|redeploy|rollback|roll out)\b/,
      /\b(docker|dockerfile|docker-compose|kubernetes|k8s|kubectl|helm|container|containers|containeri[sz]ed?|orchestration)\b/,
      /\b(ci\/cd|ci cd|continuous (?:integration|delivery|deployment)|github actions|gitlab ci|circleci|jenkins|build pipeline)\b/,
      /\bci\b[^.?!]{0,30}\b(pipeline|build|builds|set ?up|workflow|repo|repository|server|runner)\b/,
      /\b(self-hosted?|self-hosting|hosting|vps|bare metal|reverse proxy|nginx|load balancer)\b/,
      /\bhost\b[^.?!]{0,30}\b(app|application|api|server|site|website|service|bot|project)\b/,
    ],
    weight: 2,
  },
  {
    intent: 'observability_monitoring',
    patterns: [
      /\b(logging|logs|metrics|tracing|observability|monitor|monitors|monitoring|alerting|alerts)\b/,
      /\b(error tracking|crash report|instrumentation|apm|uptime|sentry|datadog|grafana|prometheus)\b/,
    ],
    weight: 2,
  },
  {
    intent: 'database_design',
    patterns: [
      /\b(schema|migration|index|foreign key|normali[sz]e)\b/,
      /\b(prisma|postgres|sql)\b[^.?!]{0,30}\b(design|model|relation)\b/,
      /\b(database|db)\b[^.?!]{0,40}\b(scale|scaling|design|model|size|sizing|shard|sharding|replica|replication)\b/,
      /\b(scale|scaling|shard|sharding|replicate|replication|size|sizing)\b[^.?!]{0,40}\b(database|db|postgres|mysql|sqlite|sql)\b/,
      /\b(connection pool|read replica|sharding)\b/,
    ],
    weight: 2,
  },
  {
    intent: 'performance_optimization',
    patterns: [/\b(slow|performance|optimi[sz]e|latency|memory leak|n\+1|bottleneck)\b/],
    weight: 2,
  },
  {
    intent: 'security_hardening',
    patterns: [/\b(csrf|xss|sql injection|rate limit|harden|secret management|cors)\b/],
    weight: 2,
  },
  {
    intent: 'ai_ml_integration',
    patterns: [/\b(llm|prompt|embedding|rag|inference|fine-?tune|streaming response)\b/],
    weight: 2,
  },
  {
    intent: 'backend_api_development',
    patterns: [/\b(api|endpoint|route handler|rest|graphql server|webhook)\b/],
    weight: 1,
  },
  {
    intent: 'frontend_development',
    patterns: [/\b(component|css|layout|responsive|state management|render)\b/],
    weight: 1,
  },
  {
    intent: 'testing',
    patterns: [/\b(unit test|integration test|mock|vitest|jest|pytest|coverage)\b/],
    weight: 2,
  },
  {
    intent: 'refactoring',
    patterns: [/\b(refactor|clean up|restructure|extract|rename|simplify)\b/],
    weight: 2,
  },
  {
    intent: 'bug_fixing',
    patterns: [
      /\b(error|exception|stack trace|traceback|failing|broken|crash|bug|not working|undefined is not)\b/,
      /\b(fix|debug|why does|why is)\b/,
    ],
    weight: 2,
  },
  {
    intent: 'code_explanation',
    patterns: [/\b(explain|what does|how does|walk me through|understand|meaning of)\b/],
    weight: 1,
  },
];

/** Commercial intent: phrases that mean the developer is choosing what to buy or adopt. */
export const HIGH_COMMERCIAL_PATTERNS: RegExp[] = [
  /\b(compare|comparison|versus|vs\.?|alternative|alternatives)\b/,
  /\b(best|fastest|cheapest|recommended|should i use|which (one|provider|service|tool))\b/,
  /\b(pricing|price|cost|free tier|quota|rate limit|plan)\b/,
  /\b(production|scale|scaling|enterprise|migrate to|switch from)\b/,
  /\b(provider|providers|managed|hosted|saas)\b/,
];

export const MEDIUM_COMMERCIAL_PATTERNS: RegExp[] = [
  /\b(deploy|deployment|set ?up|configure|integrate|integration|install)\b/,
  /\b(how do i (use|add|connect))\b/,
];

/** Persona inference from the technologies actually mentioned. */
export const PERSONA_TECHNOLOGIES: { persona: Persona; technologies: Technology[] }[] = [
  {
    persona: 'web3_developer',
    technologies: [
      'solidity',
      'vyper',
      'foundry',
      'hardhat',
      'ethereum',
      'hedera',
      'viem',
      'ethers',
      'wagmi',
      'thegraph',
      'subgraph',
      'openzeppelin',
      'x402',
      'ipfs',
    ],
  },
  {
    persona: 'devops_engineer',
    technologies: ['docker', 'kubernetes', 'terraform', 'aws', 'gcp', 'azure'],
  },
  {
    persona: 'data_engineer',
    technologies: ['postgres', 'mysql', 'mongodb', 'redis', 'substreams'],
  },
  { persona: 'frontend_developer', technologies: ['react', 'nextjs', 'vue', 'svelte'] },
  {
    persona: 'backend_developer',
    technologies: ['node', 'express', 'fastify', 'nestjs', 'python', 'go', 'java', 'rust'],
  },
];
