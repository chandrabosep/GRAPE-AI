import { describe, expect, it } from 'vitest';
import {
  classifyWithRules,
  detectCommercialIntent,
  detectTechnologies,
  inferPersona,
  mergeIntents,
} from './rules';

describe('technology detection', () => {
  it('reads the stack out of a Solidity question', () => {
    const found = detectTechnologies('how do i deploy a solidity contract with foundry?');
    expect(found).toEqual(expect.arrayContaining(['solidity', 'foundry']));
  });

  it('uses the open file when the prompt does not name a language', () => {
    const found = detectTechnologies('why is this reverting?', { languageId: 'solidity' });
    expect(found).toEqual(expect.arrayContaining(['solidity', 'ethereum']));
  });

  it('does not match a term inside a longer word', () => {
    // "go" must not fire on "google", "ts" must not fire on "artifacts".
    const found = detectTechnologies('check the google artifacts bucket');
    expect(found).not.toContain('go');
    expect(found).not.toContain('typescript');
  });
});

describe('persona inference', () => {
  it('reads a web3 developer from web3 tooling', () => {
    expect(inferPersona(['solidity', 'foundry', 'ethereum'])).toBe('web3_developer');
  });

  it('prefers the persona with the most evidence', () => {
    expect(inferPersona(['docker', 'kubernetes', 'terraform', 'react'])).toBe('devops_engineer');
  });

  it('returns null when there is nothing to go on', () => {
    expect(inferPersona([])).toBeNull();
  });
});

describe('commercial intent', () => {
  it('treats provider comparison as high intent', () => {
    expect(detectCommercialIntent('compare ethereum rpc providers for my dapp')).toBe('high');
    expect(detectCommercialIntent('which one is cheapest at scale?')).toBe('high');
  });

  it('treats setup work as medium intent', () => {
    expect(detectCommercialIntent('how do i configure the sdk')).toBe('medium');
  });

  it('treats a plain explanation request as low intent', () => {
    expect(detectCommercialIntent('what does this mapping do')).toBe('low');
  });
});

describe('end-to-end classification', () => {
  it('classifies the demo prompt', () => {
    const intent = classifyWithRules('How do I deploy this Solidity contract using Foundry?', {
      languageId: 'solidity',
    });

    expect(intent.intent).toBe('smart_contract_deployment');
    expect(intent.category).toBe('infrastructure');
    expect(intent.technologies).toEqual(
      expect.arrayContaining(['solidity', 'foundry', 'ethereum']),
    );
    expect(intent.persona).toBe('web3_developer');
    expect(intent.commercialIntent).toBe('medium');
    expect(intent.confidence).toBeGreaterThan(0.3);
  });

  it('classifies an infrastructure evaluation as high commercial intent', () => {
    const intent = classifyWithRules('Compare Ethereum RPC providers for my dApp.');

    expect(intent.intent).toBe('rpc_infrastructure_evaluation');
    expect(intent.commercialIntent).toBe('high');
    expect(intent.technologies).toContain('ethereum');
  });

  it('separates indexing questions from generic backend work', () => {
    const intent = classifyWithRules('How do I query onchain events with a subgraph?');
    expect(intent.intent).toBe('indexing_querying_onchain_data');
    expect(intent.category).toBe('data');
    expect(intent.technologies).toEqual(expect.arrayContaining(['subgraph', 'thegraph']));
  });

  it('recognises a debugging request', () => {
    const intent = classifyWithRules('I get an undefined is not a function error in this test');
    expect(intent.intent).toBe('bug_fixing');
    expect(intent.category).toBe('debugging');
  });

  it('stays neutral rather than guessing on an unrelated prompt', () => {
    const intent = classifyWithRules('write me a haiku about the sea');
    expect(intent.intent).toBe('general_coding');
    expect(intent.confidence).toBeLessThan(0.35);
  });

  it('carries the previous intent through a bare follow-up', () => {
    const intent = classifyWithRules('and for mainnet?', {
      previousIntent: 'smart_contract_deployment',
    });
    expect(intent.intent).toBe('smart_contract_deployment');
    expect(intent.confidence).toBeLessThan(0.4);
  });

  /**
   * The inline slot is auctioned on this pass alone — it has to be decided
   * before the first token, so it never sees the LLM classifier's answer. A
   * question that lands on `general_coding` here gives a campaign nothing to
   * target, and since the inline slot takes no remnant, it simply stays empty.
   *
   * These are the phrasings that used to do exactly that. Each one names its
   * subject plainly and a human would have no trouble placing it, but the rules
   * that covered them were written as two-term conjunctions and none of them
   * fired.
   */
  describe('phrasings that must not fall through to general_coding', () => {
    const cases: [string, string][] = [
      ['How do I run containers in production with Docker?', 'devops_deployment'],
      ['How do I deploy a Next.js app?', 'devops_deployment'],
      ['Set up CI for my repo', 'devops_deployment'],
      ['How do I host a Node app?', 'devops_deployment'],
      ['Help me write a GitHub Actions workflow', 'devops_deployment'],
      ['How do I monitor errors in production?', 'observability_monitoring'],
      ['What is the best way to scale my Postgres database?', 'database_design'],
    ];

    for (const [prompt, expected] of cases) {
      it(`classifies "${prompt}"`, () => {
        const intent = classifyWithRules(prompt.toLowerCase());
        expect(intent.intent).toBe(expected);
        // Enough to carry weight in the auction rather than merely be non-null:
        // the ranker multiplies the intent term by this.
        expect(intent.confidence).toBeGreaterThanOrEqual(0.5);
      });
    }
  });

  it('still lets a contract deployment outrank the generic deployment rule', () => {
    // `devops_deployment` now matches a bare "deploy", so the narrower web3
    // rule has to win on weight rather than on being the only match.
    const intent = classifyWithRules('how do i deploy this solidity contract using foundry?');
    expect(intent.intent).toBe('smart_contract_deployment');
  });

  it('never invents a value outside the taxonomy', () => {
    const intent = classifyWithRules('deploy my erc-721 contract to base sepolia with hardhat');
    expect(intent.technologies.every((t) => typeof t === 'string')).toBe(true);
    expect(intent.confidence).toBeLessThanOrEqual(0.7);
  });
});

describe('merging rules with the LLM stage', () => {
  const rules = classifyWithRules('deploy a solidity contract with foundry');

  it('falls back to rules when the LLM stage is unavailable', () => {
    expect(mergeIntents(rules, null)).toBe(rules);
  });

  it('lets the LLM decide the task but keeps technologies from both', () => {
    const merged = mergeIntents(rules, {
      category: 'security',
      intent: 'smart_contract_audit',
      technologies: ['openzeppelin'],
      persona: 'security_engineer',
      commercialIntent: 'low',
      confidence: 0.9,
    });

    expect(merged.intent).toBe('smart_contract_audit');
    expect(merged.technologies).toEqual(expect.arrayContaining(['openzeppelin', 'solidity']));
    expect(merged.persona).toBe('security_engineer');
    expect(merged.confidence).toBe(0.9);
  });

  it('keeps the higher commercial intent of the two stages', () => {
    const merged = mergeIntents(
      { ...rules, commercialIntent: 'high' },
      {
        category: 'development',
        intent: 'smart_contract_development',
        technologies: [],
        persona: null,
        commercialIntent: 'low',
        confidence: 0.9,
      },
    );
    expect(merged.commercialIntent).toBe('high');
  });
});
