'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ChipSelect } from '@/components/app/chip-select';
import { Eyebrow, Shell, Stamp } from '@/components/app/section';
import {
  InlineSponsoredPreview,
  SponsoredPreview,
} from '@/components/app/sponsored-preview';
import { api } from '@/lib/api';
import { usePublicConfig } from '@/hooks/use-public-config';
import { useMe } from '@/hooks/use-session';

const COUNTRIES = ['IN', 'US', 'GB', 'DE', 'SG', 'BR', 'NG', 'JP'];
const PROTOCOL_TYPES = ['lending', 'dex'];

interface AudienceEstimate {
  eligibleUsers: number;
  byPersona: Record<string, number>;
  byOnchainSignal: Record<string, number>;
  suppressed: boolean;
}

const USD = (dollars: number) => String(Math.round(dollars * 1_000_000));

/**
 * The steps, in the order the decisions actually depend on each other.
 *
 * One card at a time rather than eight stacked forms. The old page asked for
 * budget, targeting, onchain rules and two creatives on a single screen, which
 * made a first campaign look like a configuration exercise; a step only ever
 * asks one question, and `blocking` is what that step will not let through, so
 * a mistake surfaces beside the field that caused it rather than as a failed
 * request after the last button.
 */
const STEPS = [
  { id: 'basics', title: 'Campaign', hint: 'Name it and set what you will spend' },
  { id: 'audience', title: 'Audience', hint: 'What they are doing, and who they are' },
  { id: 'onchain', title: 'Onchain', hint: 'Optional: match on real wallet history' },
  { id: 'creative', title: 'Creative', hint: 'The card shown under a finished answer' },
  { id: 'inline', title: 'Inline ad', hint: 'The line shown while the answer is thinking' },
  { id: 'review', title: 'Review', hint: 'Check it, then create it as a draft' },
] as const;

/** A link is the one field where a typo silently wastes the whole budget. */
function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export default function NewCampaignPage() {
  const router = useRouter();
  const { data: me } = useMe();
  const { data: config } = usePublicConfig();

  const [step, setStep] = useState(0);
  /** How far the advertiser has been. Lets them jump back, never forward. */
  const [furthest, setFurthest] = useState(0);

  const [name, setName] = useState('Ethereum Developer Launch');
  const [budget, setBudget] = useState(100);
  const [bid, setBid] = useState(0.01);
  const [days, setDays] = useState(30);

  const [countries, setCountries] = useState<string[]>([]);
  const [personas, setPersonas] = useState<string[]>(['web3_developer']);
  const [interests, setInterests] = useState<string[]>([]);
  const [technologies, setTechnologies] = useState<string[]>(['solidity', 'ethereum']);
  const [aiIntents, setAiIntents] = useState<string[]>(['smart_contract_deployment']);
  const [minCommercialIntent, setMinCommercialIntent] = useState('low');

  const [onchainMode, setOnchainMode] = useState<'off' | 'boost' | 'require'>('boost');
  const [protocolTypes, setProtocolTypes] = useState<string[]>([]);
  const [requireWalletActivity, setRequireWalletActivity] = useState(true);

  const [headline, setHeadline] = useState('Ship your contract without babysitting a node');
  const [body, setBody] = useState(
    'Managed Ethereum RPC with archive access and no rate-limit surprises.',
  );
  const [ctaText, setCtaText] = useState('See the free tier');
  const [ctaUrl, setCtaUrl] = useState('https://example.com/northwind');
  // A path is accepted as well as a full URL; it is resolved against this origin
  // on submit, because the extension loads the artwork from a different one.
  const [imageUrl, setImageUrl] = useState('/creatives/northwind-rpc.svg');

  // The inline slot gets its own copy. Defaulted to something that reads like a
  // one-liner rather than a truncated banner, because that is the point of it.
  const [runInline, setRunInline] = useState(true);
  const [inlineHeadline, setInlineHeadline] = useState(
    'Managed Ethereum RPC, archive access included',
  );
  const [inlineCta, setInlineCta] = useState('Free tier');

  const targeting = useMemo(
    () => ({
      countries,
      personas,
      interests,
      technologies,
      intentCategories: [],
      aiIntents,
      models: [],
      minCommercialIntent,
      onchainMode,
      onchainCriteria: {
        requireWalletActivity,
        protocolTypes,
        protocols: [],
        activityWindowDays: 30,
        requireEnsHolder: false,
        requireStablecoinHolder: false,
        requireNftHolder: false,
        chains: ['mainnet'],
      },
    }),
    [
      countries,
      personas,
      interests,
      technologies,
      aiIntents,
      minCommercialIntent,
      onchainMode,
      protocolTypes,
      requireWalletActivity,
    ],
  );

  // Debounced so dragging through options does not hammer the API.
  const [debounced, setDebounced] = useState(targeting);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(targeting), 400);
    return () => clearTimeout(timer);
  }, [targeting]);

  const { data: estimate } = useQuery<AudienceEstimate>({
    queryKey: ['audience', debounced],
    queryFn: () =>
      api<AudienceEstimate>('/campaigns/estimate-audience', {
        method: 'POST',
        body: JSON.stringify(debounced),
      }),
    enabled: Boolean(me?.user.roles.includes('advertiser')),
  });

  const create = useMutation({
    mutationFn: async () => {
      const campaign = await api<{ id: string }>('/campaigns', {
        method: 'POST',
        body: JSON.stringify({
          name,
          budgetMicro: USD(budget),
          bidMicro: USD(bid),
          clickMultiplier: 3,
          startsAt: new Date().toISOString(),
          endsAt: new Date(Date.now() + days * 86_400_000).toISOString(),
          // Loose enough that a demo can ask the same question twice.
          frequencyCap: { perUserPerHour: 5, perUserPerDay: 25 },
        }),
      });

      await api(`/campaigns/${campaign.id}/targeting`, {
        method: 'PUT',
        body: JSON.stringify(targeting),
      });

      await api(`/campaigns/${campaign.id}/creative`, {
        method: 'PUT',
        body: JSON.stringify({
          format: 'banner',
          headline,
          body,
          ctaText,
          ctaUrl,
          imageUrl: imageUrl.trim() ? new URL(imageUrl, window.location.origin).toString() : null,
        }),
      });

      if (runInline && inlineHeadline.trim()) {
        await api(`/campaigns/${campaign.id}/creative`, {
          method: 'PUT',
          body: JSON.stringify({
            format: 'inline',
            headline: inlineHeadline,
            ctaText: inlineCta,
            // Same destination as the card: one campaign, one place to land.
            ctaUrl,
          }),
        });
      }

      return campaign;
    },
    onSuccess: (campaign) => {
      toast.success('Campaign created as a draft');
      router.push(`/advertise/campaigns/${campaign.id}`);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  /** What each step refuses to let through, in the order it should be fixed. */
  const blocking = useMemo(() => {
    const problems: Record<string, string[]> = {
      basics: [],
      audience: [],
      onchain: [],
      creative: [],
      inline: [],
      review: [],
    };

    if (!name.trim()) problems.basics.push('Give the campaign a name.');
    if (!(budget > 0)) problems.basics.push('Budget has to be more than zero.');
    if (!(bid > 0)) problems.basics.push('Bid has to be more than zero.');
    if (bid > budget) problems.basics.push('Bid cannot be larger than the whole budget.');
    if (!(days >= 1)) problems.basics.push('A campaign has to run for at least one day.');

    if (!headline.trim()) problems.creative.push('The card needs a headline.');
    if (!ctaText.trim()) problems.creative.push('The card needs call-to-action text.');
    if (!isHttpUrl(ctaUrl)) {
      problems.creative.push('The link has to be a full http:// or https:// URL.');
    }

    if (runInline && !inlineHeadline.trim()) {
      problems.inline.push('Write the inline message, or turn the inline slot off.');
    }
    if (runInline && !inlineCta.trim()) {
      problems.inline.push('The inline line needs link text.');
    }

    return problems;
  }, [name, budget, bid, days, headline, ctaText, ctaUrl, runInline, inlineHeadline, inlineCta]);

  if (!me?.user.roles.includes('advertiser')) {
    return (
      <Shell className="py-28 md:py-36">
        <Eyebrow>Not available</Eyebrow>
        <h1 className="display-serif text-almost-white mt-8 text-[clamp(2rem,5vw,3.5rem)] text-balance">
          Sign in as an advertiser to create a campaign
        </h1>
      </Shell>
    );
  }

  const current = STEPS[step]!;
  const problems = blocking[current.id] ?? [];
  const isLast = step === STEPS.length - 1;
  // The review step can only be honest if every earlier step is clean.
  const allProblems = STEPS.flatMap((s) => (blocking[s.id] ?? []).map((p) => ({ step: s, p })));

  const goTo = (next: number) => {
    setStep(next);
    setFurthest((seen) => Math.max(seen, next));
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const impressions = bid > 0 ? Math.floor(budget / bid) : 0;
  const rewardShare = config ? bid * config.allocation.reward : 0;

  return (
    <Shell className="grid gap-12 py-16 md:py-20 lg:grid-cols-[1fr_340px] lg:gap-16">
      <div>
        <Stamp
          as="h1"
          sub="Six short steps. You are charged per qualified impression, meaning attention the developer's client confirmed was on screen."
        >
          New campaign
        </Stamp>

        <div className="mt-12">
          <Stepper current={step} furthest={furthest} onJump={goTo} />
        </div>

        {/* The step itself is not a card. It is the page — one question at a
            time, framed by the hairline above it and the actions below. */}
        <div className="border-hairline mt-12 border-t pt-10">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="text-almost-white text-2xl font-light tracking-[-0.02em]">
              {current.title}
            </h2>
            <span className="stamp-sm shrink-0">
              {String(step + 1).padStart(2, '0')} / {String(STEPS.length).padStart(2, '0')}
            </span>
          </div>
          <p className="text-steel mt-3 text-sm">{current.hint}</p>

          <div className="mt-10 space-y-8">
            {current.id === 'basics' && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Label htmlFor="name">Campaign name</Label>
                  <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-2.5">
                  <Label htmlFor="budget">Budget (USD)</Label>
                  <Input
                    id="budget"
                    type="number"
                    min={1}
                    step={1}
                    value={budget}
                    onChange={(e) => setBudget(Number(e.target.value))}
                  />
                </div>
                <div className="space-y-2.5">
                  <Label htmlFor="bid">Bid per impression (USD)</Label>
                  <Input
                    id="bid"
                    type="number"
                    min={0.001}
                    step={0.001}
                    value={bid}
                    onChange={(e) => setBid(Number(e.target.value))}
                  />
                  <p className="text-graphite mt-2 text-xs">
                    Buys about {impressions.toLocaleString()} qualified impressions.
                  </p>
                </div>
                <div className="space-y-2.5">
                  <Label htmlFor="days">Runs for (days)</Label>
                  <Input
                    id="days"
                    type="number"
                    min={1}
                    value={days}
                    onChange={(e) => setDays(Number(e.target.value))}
                  />
                </div>
                <div className="space-y-2.5">
                  <Label>Minimum commercial intent</Label>
                  <Select
                    value={minCommercialIntent}
                    onValueChange={(value) => setMinCommercialIntent(value ?? 'low')}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low — any question</SelectItem>
                      <SelectItem value="medium">Medium — integrating or deploying</SelectItem>
                      <SelectItem value="high">High — comparing or choosing a tool</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {current.id === 'audience' && (
              <>
                <Field
                  label="AI intent"
                  hint="What the developer is trying to do when your ad is considered."
                >
                  <ChipSelect
                    options={config?.taxonomy.intents ?? []}
                    selected={aiIntents}
                    onChange={setAiIntents}
                    emptyLabel="any task"
                  />
                </Field>
                <Field label="Technologies" hint="Derived from the question, not from a profile.">
                  <ChipSelect
                    options={config?.taxonomy.technologies ?? []}
                    selected={technologies}
                    onChange={setTechnologies}
                    emptyLabel="any stack"
                  />
                </Field>
                <Field label="Persona">
                  <ChipSelect
                    options={config?.taxonomy.personas ?? []}
                    selected={personas}
                    onChange={setPersonas}
                  />
                </Field>
                <Field label="Interests">
                  <ChipSelect
                    options={config?.taxonomy.interests ?? []}
                    selected={interests}
                    onChange={setInterests}
                  />
                </Field>
                <Field label="Countries">
                  <ChipSelect options={COUNTRIES} selected={countries} onChange={setCountries} />
                </Field>
              </>
            )}

            {current.id === 'onchain' && (
              <>
                <p className="text-steel text-sm leading-relaxed">
                  Derived from The Graph using one query shape across Aave, Compound and Uniswap.
                  Developers are matched on protocol interaction, never on balances or addresses.
                </p>

                <div className="space-y-2.5">
                  <Label>How to use it</Label>
                  <Select
                    value={onchainMode}
                    onValueChange={(value) =>
                      setOnchainMode((value ?? 'off') as typeof onchainMode)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="off">Ignore onchain history</SelectItem>
                      <SelectItem value="boost">Prefer matching developers</SelectItem>
                      <SelectItem value="require">Only matching developers</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {onchainMode !== 'off' && (
                  <>
                    <Field label="Protocol types used in the last 30 days">
                      <ChipSelect
                        options={PROTOCOL_TYPES}
                        selected={protocolTypes}
                        onChange={setProtocolTypes}
                        emptyLabel="any protocol"
                      />
                    </Field>
                    <label className="text-almost-white flex items-center gap-2.5 text-sm">
                      <input
                        type="checkbox"
                        className="accent-signal-violet size-4"
                        checked={requireWalletActivity}
                        onChange={(e) => setRequireWalletActivity(e.target.checked)}
                      />
                      Has any recent onchain activity
                    </label>
                    {onchainMode === 'require' && (
                      <p className="text-graphite text-xs leading-relaxed">
                        In require mode a developer with no linked wallet is ineligible, so reach
                        will be smaller and much more qualified.
                      </p>
                    )}
                  </>
                )}
              </>
            )}

            {current.id === 'creative' && (
              <div className="grid gap-4">
                <div className="space-y-2.5">
                  <Label htmlFor="headline">Headline</Label>
                  <Input
                    id="headline"
                    value={headline}
                    maxLength={90}
                    onChange={(e) => setHeadline(e.target.value)}
                  />
                  <Counter value={headline.length} max={90} />
                </div>
                <div className="space-y-2.5">
                  <Label htmlFor="body">Body</Label>
                  <Textarea
                    id="body"
                    value={body}
                    maxLength={240}
                    onChange={(e) => setBody(e.target.value)}
                  />
                  <Counter value={body.length} max={240} />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2.5">
                    <Label htmlFor="cta">Call to action</Label>
                    <Input id="cta" value={ctaText} onChange={(e) => setCtaText(e.target.value)} />
                  </div>
                  <div className="space-y-2.5">
                    <Label htmlFor="url">Link</Label>
                    <Input id="url" value={ctaUrl} onChange={(e) => setCtaUrl(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-2.5">
                  <Label htmlFor="image">Image</Label>
                  <Input
                    id="image"
                    value={imageUrl}
                    placeholder="https://… or /creatives/your-art.svg"
                    onChange={(e) => setImageUrl(e.target.value)}
                  />
                  <p className="text-graphite mt-2 text-xs">
                    Square artwork reads best: it is shown as a 76px thumbnail beside the copy.
                    Leave empty and the card falls back to your initials.
                  </p>
                </div>
              </div>
            )}

            {current.id === 'inline' && (
              <div className="grid gap-4">
                <p className="text-steel text-sm leading-relaxed">
                  One line shown while the answer is still being written — the moment the developer
                  is waiting. It is a separate auction from the card, billed at 30% of your bid.
                  The two never appear at once: the line is retired the moment the answer is
                  finished, and the card takes its place.
                </p>

                <label className="text-almost-white flex items-center gap-2.5 text-sm">
                  <input
                    type="checkbox"
                    className="accent-signal-violet size-4"
                    checked={runInline}
                    onChange={(e) => setRunInline(e.target.checked)}
                  />
                  Also run this campaign in the inline slot
                </label>

                {runInline && (
                  <>
                    <div className="space-y-2.5">
                      <Label htmlFor="inline-headline">Message</Label>
                      <Input
                        id="inline-headline"
                        value={inlineHeadline}
                        maxLength={70}
                        onChange={(e) => setInlineHeadline(e.target.value)}
                      />
                      <p className="text-graphite mt-2 text-xs">
                        {inlineHeadline.length}/70. Write it as a useful aside, not a pitch — it
                        sits next to an answer the developer asked for, and is truncated rather
                        than wrapped.
                      </p>
                    </div>
                    <div className="space-y-2.5">
                      <Label htmlFor="inline-cta">Link text</Label>
                      <Input
                        id="inline-cta"
                        value={inlineCta}
                        maxLength={24}
                        onChange={(e) => setInlineCta(e.target.value)}
                      />
                      <p className="text-graphite mt-2 text-xs">
                        Points at the same destination as your card.
                      </p>
                    </div>
                  </>
                )}
              </div>
            )}

            {current.id === 'review' && (
              <div className="space-y-5">
                <Summary label="Campaign" onEdit={() => goTo(0)}>
                  <SummaryRow label="Name" value={name} />
                  <SummaryRow label="Budget" value={`$${budget.toFixed(2)}`} />
                  <SummaryRow
                    label="Bid"
                    value={`$${bid.toFixed(4)} per qualified impression`}
                  />
                  <SummaryRow label="Runs for" value={`${days} days`} />
                  <SummaryRow label="Minimum commercial intent" value={minCommercialIntent} />
                </Summary>

                <Summary label="Audience" onEdit={() => goTo(1)}>
                  <SummaryChips label="AI intent" values={aiIntents} />
                  <SummaryChips label="Technologies" values={technologies} />
                  <SummaryChips label="Persona" values={personas} />
                  <SummaryChips label="Interests" values={interests} />
                  <SummaryChips label="Countries" values={countries} />
                </Summary>

                <Summary label="Onchain" onEdit={() => goTo(2)}>
                  <SummaryRow
                    label="Mode"
                    value={
                      onchainMode === 'off'
                        ? 'Not used'
                        : onchainMode === 'boost'
                          ? 'Prefer matching developers'
                          : 'Only matching developers'
                    }
                  />
                  {onchainMode !== 'off' && (
                    <>
                      <SummaryChips label="Protocol types" values={protocolTypes} />
                      <SummaryRow
                        label="Recent activity"
                        value={requireWalletActivity ? 'Required' : 'Not required'}
                      />
                    </>
                  )}
                </Summary>

                <Summary label="Creative" onEdit={() => goTo(3)}>
                  <SummaryRow label="Headline" value={headline} />
                  <SummaryRow label="Link" value={ctaUrl} />
                  <SummaryRow label="Inline slot" value={runInline ? inlineHeadline : 'Not run'} />
                </Summary>

                {allProblems.length > 0 ? (
                  <div className="border-destructive/45 rounded-[10.8px] border p-5">
                    <p className="text-destructive text-[13px] font-medium">
                      Fix these before creating the campaign
                    </p>
                    <ul className="mt-3 space-y-1.5">
                      {allProblems.map(({ step: s, p }) => (
                        <li key={`${s.id}-${p}`} className="text-[13px]">
                          <button
                            className="text-almost-white underline underline-offset-4"
                            onClick={() => goTo(STEPS.indexOf(s))}
                          >
                            {s.title}
                          </button>
                          <span className="text-steel"> — {p}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="text-steel text-sm leading-relaxed">
                    This is created as a draft. Nothing is served and nothing is charged until you
                    fund it and launch it from the campaign page.
                  </p>
                )}
              </div>
            )}

            {/* The step's own problems, shown under its fields rather than
                saved up for a failed submit at the end. */}
            {problems.length > 0 && current.id !== 'review' && (
              <ul className="space-y-1">
                {problems.map((problem) => (
                  <li key={problem} className="text-destructive text-[13px]">
                    {problem}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="border-hairline mt-12 flex flex-wrap items-center gap-3 border-t pt-8">
          {step > 0 ? (
            <Button variant="outline" size="lg" onClick={() => goTo(step - 1)}>
              Back
            </Button>
          ) : (
            <Button variant="outline" size="lg" onClick={() => router.back()}>
              Cancel
            </Button>
          )}

          {isLast ? (
            <Button
              size="lg"
              onClick={() => create.mutate()}
              disabled={create.isPending || allProblems.length > 0}
            >
              {create.isPending ? 'Creating…' : 'Create campaign'}
            </Button>
          ) : (
            <Button size="lg" onClick={() => goTo(step + 1)} disabled={problems.length > 0}>
              Continue
            </Button>
          )}

          <span className="stamp-sm ml-auto">
            {STEPS.length - step - 1} step{STEPS.length - step - 1 === 1 ? '' : 's'} left
          </span>
        </div>
      </div>

      {/* Live consequences of the current step, so the sidebar is never a
          reference panel the advertiser has to translate for themselves. */}
      <aside className="space-y-10 lg:sticky lg:top-24 lg:self-start">
        <Panel label="Estimated reach">
          {estimate?.suppressed ? (
            <p className="text-steel text-xs leading-relaxed">
              Fewer than five developers match. Counts are hidden below that threshold so an
              estimate cannot identify anyone.
            </p>
          ) : (
            <>
              <div className="text-almost-white text-[32px] leading-none font-light tracking-[-0.02em] tabular-nums">
                {estimate?.eligibleUsers ?? '—'}
              </div>
              <p className="text-steel mt-2.5 text-xs">developers currently match</p>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {Object.entries(estimate?.byOnchainSignal ?? {}).map(([signal, count]) => (
                  <Badge key={signal} variant="secondary">
                    {signal} · {count}
                  </Badge>
                ))}
              </div>
            </>
          )}
        </Panel>

        <Panel label="What it buys">
          <div className="space-y-3.5">
            <Row label="Qualified impressions" value={impressions.toLocaleString()} />
            <Row label="Per impression" value={`$${bid.toFixed(4)}`} />
            <Row
              label="To the developer"
              value={`$${rewardShare.toFixed(4)}`}
              accent
              hint={config ? `${(config.allocation.reward * 100).toFixed(0)}% of your spend` : ''}
            />
          </div>
        </Panel>

        <Panel label="Preview">
            {/* Whichever slot the current step is about, shown on its own —
                exactly as the developer sees it, one ad at a time. */}
            {current.id === 'inline' && runInline ? (
              <>
                <InlineSponsoredPreview
                  headline={inlineHeadline}
                  ctaText={inlineCta}
                  advertiserName={me?.user.displayName ?? 'Your company'}
                />
                <p className="text-graphite mt-4 text-xs leading-relaxed">
                  Shown while the answer is still being written, and retired the moment it
                  finishes.
                </p>
              </>
            ) : (
              <>
                <SponsoredPreview
                  headline={headline}
                  body={body}
                  ctaText={ctaText}
                  imageUrl={imageUrl.trim() || null}
                  advertiserName={me?.user.displayName ?? 'Your company'}
                  rewardMicro={
                    config ? Math.round(bid * config.allocation.reward * 1_000_000) : null
                  }
                />
                <p className="text-graphite mt-4 text-xs leading-relaxed">
                  This is exactly how it appears under a finished answer, never inside it.
                </p>
              </>
            )}
        </Panel>
      </aside>
    </Shell>
  );
}

/**
 * A sidebar panel: a stamped label, a hairline, and the content.
 *
 * Not a card, because three cards stacked in a 340px rail turn the sidebar into
 * a column of boxes — the rule and the label are enough to say where one panel
 * ends and the next begins.
 */
function Panel({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section>
      <div className="stamp-sm">{label}</div>
      <div className="border-hairline mt-4 border-t pt-5">{children}</div>
    </section>
  );
}

/**
 * The step rail.
 *
 * Numbered, named, and only ever clickable backwards: jumping ahead into a step
 * whose inputs depend on one that is still empty is how a wizard ends up
 * validating everything at the end anyway.
 */
function Stepper({
  current,
  furthest,
  onJump,
}: {
  current: number;
  furthest: number;
  onJump: (index: number) => void;
}) {
  return (
    <ol className="flex flex-wrap items-center gap-x-2.5 gap-y-3">
      {STEPS.map((step, index) => {
        const state = index === current ? 'current' : index < current ? 'done' : 'todo';
        const reachable = index <= furthest;

        return (
          <li key={step.id} className="flex items-center gap-2.5">
            <button
              type="button"
              disabled={!reachable}
              onClick={() => onJump(index)}
              aria-current={state === 'current' ? 'step' : undefined}
              className={`focus-visible:ring-ring/70 flex items-center gap-2 rounded-4xl border px-3 py-1.5 text-[11px] transition-colors focus-visible:ring-2 focus-visible:outline-none ${
                state === 'current'
                  ? 'border-signal-violet/50 bg-signal-violet/10 text-lavender-mist'
                  : state === 'done'
                    ? 'border-hairline text-almost-white hover:border-almost-white/40'
                    : 'border-hairline text-graphite'
              } ${reachable ? 'cursor-pointer' : 'cursor-default'}`}
            >
              <span className="font-mono text-[10px] tabular-nums">
                {String(index + 1).padStart(2, '0')}
              </span>
              {step.title}
            </button>
            {index < STEPS.length - 1 && (
              <span aria-hidden="true" className="bg-hairline hidden h-px w-4 sm:block" />
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** A labelled block of controls, so every step reads the same way. */
function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <Label>{label}</Label>
      {hint && <p className="text-graphite mt-2.5 text-xs leading-relaxed">{hint}</p>}
      <div className="mt-4">{children}</div>
    </div>
  );
}

/** How much room is left, where a field is truncated rather than wrapped. */
function Counter({ value, max }: { value: number; max: number }) {
  return (
    <p className="text-graphite mt-2 text-xs tabular-nums">
      {value}/{max}
    </p>
  );
}

function Summary({
  label,
  onEdit,
  children,
}: {
  label: string;
  onEdit: () => void;
  children: ReactNode;
}) {
  return (
    <div className="border-hairline border-t pt-5">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="stamp-sm">{label}</div>
        <button
          className="text-steel hover:text-almost-white text-xs underline underline-offset-4 transition-colors"
          onClick={onEdit}
        >
          Edit
        </button>
      </div>
      <div className="space-y-2.5">{children}</div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <span className="text-steel shrink-0 text-xs">{label}</span>
      <span className="text-almost-white truncate text-right">{value}</span>
    </div>
  );
}

function SummaryChips({ label, values }: { label: string; values: string[] }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <span className="text-steel shrink-0 text-xs">{label}</span>
      {values.length === 0 ? (
        <span className="text-graphite text-right text-xs">Anyone</span>
      ) : (
        <span className="flex flex-wrap justify-end gap-1.5">
          {values.map((value) => (
            <Badge key={value} variant="secondary">
              {value.replace(/_/g, ' ')}
            </Badge>
          ))}
        </span>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <div className="min-w-0">
        <div className="text-steel text-xs">{label}</div>
        {hint && <div className="text-graphite mt-0.5 text-[10px]">{hint}</div>}
      </div>
      {/* The developer's share is the number this whole rail exists to show, so
          it is the one figure allowed the accent. */}
      <div className={`shrink-0 text-sm tabular-nums ${accent ? 'text-signal-violet' : 'text-almost-white'}`}>
        {value}
      </div>
    </div>
  );
}
