'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
      <div className="text-muted-foreground mx-auto max-w-5xl px-6 py-24 text-center text-sm">
        Sign in as an advertiser to create a campaign.
      </div>
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
    <div className="mx-auto grid max-w-6xl gap-8 px-6 py-10 lg:grid-cols-[1fr_340px]">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">New campaign</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Six short steps. You are charged per qualified impression, meaning attention the
            developer&apos;s client confirmed was on screen.
          </p>
        </div>

        <Stepper current={step} furthest={furthest} onJump={goTo} />

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-baseline justify-between gap-4">
              <CardTitle className="text-base">{current.title}</CardTitle>
              <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                Step {step + 1} of {STEPS.length}
              </span>
            </div>
            <p className="text-muted-foreground text-sm">{current.hint}</p>
          </CardHeader>

          <CardContent className="space-y-6">
            {current.id === 'basics' && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <Label htmlFor="name">Campaign name</Label>
                  <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div>
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
                <div>
                  <Label htmlFor="bid">Bid per impression (USD)</Label>
                  <Input
                    id="bid"
                    type="number"
                    min={0.001}
                    step={0.001}
                    value={bid}
                    onChange={(e) => setBid(Number(e.target.value))}
                  />
                  <p className="text-muted-foreground mt-1.5 text-xs">
                    Buys about {impressions.toLocaleString()} qualified impressions.
                  </p>
                </div>
                <div>
                  <Label htmlFor="days">Runs for (days)</Label>
                  <Input
                    id="days"
                    type="number"
                    min={1}
                    value={days}
                    onChange={(e) => setDays(Number(e.target.value))}
                  />
                </div>
                <div>
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
                <p className="text-muted-foreground text-sm leading-relaxed">
                  Derived from The Graph using one query shape across Aave, Compound and Uniswap.
                  Developers are matched on protocol interaction, never on balances or addresses.
                </p>

                <div>
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
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={requireWalletActivity}
                        onChange={(e) => setRequireWalletActivity(e.target.checked)}
                      />
                      Has any recent onchain activity
                    </label>
                    {onchainMode === 'require' && (
                      <p className="text-muted-foreground text-xs leading-relaxed">
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
                <div>
                  <Label htmlFor="headline">Headline</Label>
                  <Input
                    id="headline"
                    value={headline}
                    maxLength={90}
                    onChange={(e) => setHeadline(e.target.value)}
                  />
                  <Counter value={headline.length} max={90} />
                </div>
                <div>
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
                  <div>
                    <Label htmlFor="cta">Call to action</Label>
                    <Input id="cta" value={ctaText} onChange={(e) => setCtaText(e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="url">Link</Label>
                    <Input id="url" value={ctaUrl} onChange={(e) => setCtaUrl(e.target.value)} />
                  </div>
                </div>
                <div>
                  <Label htmlFor="image">Image</Label>
                  <Input
                    id="image"
                    value={imageUrl}
                    placeholder="https://… or /creatives/your-art.svg"
                    onChange={(e) => setImageUrl(e.target.value)}
                  />
                  <p className="text-muted-foreground mt-1.5 text-xs">
                    Square artwork reads best: it is shown as a 76px thumbnail beside the copy.
                    Leave empty and the card falls back to your initials.
                  </p>
                </div>
              </div>
            )}

            {current.id === 'inline' && (
              <div className="grid gap-4">
                <p className="text-muted-foreground text-sm leading-relaxed">
                  One line shown while the answer is still being written — the moment the developer
                  is waiting. It is a separate auction from the card, billed at 30% of your bid.
                  The two never appear at once: the line is retired the moment the answer is
                  finished, and the card takes its place.
                </p>

                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={runInline}
                    onChange={(e) => setRunInline(e.target.checked)}
                  />
                  Also run this campaign in the inline slot
                </label>

                {runInline && (
                  <>
                    <div>
                      <Label htmlFor="inline-headline">Message</Label>
                      <Input
                        id="inline-headline"
                        value={inlineHeadline}
                        maxLength={70}
                        onChange={(e) => setInlineHeadline(e.target.value)}
                      />
                      <p className="text-muted-foreground mt-1.5 text-xs">
                        {inlineHeadline.length}/70. Write it as a useful aside, not a pitch — it
                        sits next to an answer the developer asked for, and is truncated rather
                        than wrapped.
                      </p>
                    </div>
                    <div>
                      <Label htmlFor="inline-cta">Link text</Label>
                      <Input
                        id="inline-cta"
                        value={inlineCta}
                        maxLength={24}
                        onChange={(e) => setInlineCta(e.target.value)}
                      />
                      <p className="text-muted-foreground mt-1.5 text-xs">
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
                  <div className="border-destructive/40 bg-destructive/5 rounded-lg border p-4">
                    <p className="text-destructive text-sm font-medium">
                      Fix these before creating the campaign
                    </p>
                    <ul className="mt-2 space-y-1">
                      {allProblems.map(({ step: s, p }) => (
                        <li key={`${s.id}-${p}`} className="text-sm">
                          <button
                            className="underline underline-offset-4"
                            onClick={() => goTo(STEPS.indexOf(s))}
                          >
                            {s.title}
                          </button>
                          <span className="text-muted-foreground"> — {p}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="text-muted-foreground text-sm leading-relaxed">
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
                  <li key={problem} className="text-destructive text-sm">
                    {problem}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-wrap items-center gap-3">
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

          <span className="text-muted-foreground ml-auto text-xs">
            {STEPS.length - step - 1} step{STEPS.length - step - 1 === 1 ? '' : 's'} left
          </span>
        </div>
      </div>

      {/* Live consequences of the current step, so the sidebar is never a
          reference panel the advertiser has to translate for themselves. */}
      <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Estimated reach</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {estimate?.suppressed ? (
              <p className="text-muted-foreground text-sm leading-relaxed">
                Fewer than five developers match. Counts are hidden below that threshold so an
                estimate cannot identify anyone.
              </p>
            ) : (
              <>
                <div className="text-2xl font-semibold tabular-nums">
                  {estimate?.eligibleUsers ?? '—'}
                </div>
                <p className="text-muted-foreground text-xs">developers currently match</p>
                <div className="flex flex-wrap gap-1">
                  {Object.entries(estimate?.byOnchainSignal ?? {}).map(([signal, count]) => (
                    <Badge key={signal} variant="secondary" className="text-[10px]">
                      {signal} · {count}
                    </Badge>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">What it buys</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Qualified impressions" value={impressions.toLocaleString()} />
            <Row label="Per impression" value={`$${bid.toFixed(4)}`} />
            <Row
              label="To the developer"
              value={`$${rewardShare.toFixed(4)}`}
              accent
              hint={config ? `${(config.allocation.reward * 100).toFixed(0)}% of your spend` : ''}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Preview</CardTitle>
          </CardHeader>
          <CardContent>
            {/* Whichever slot the current step is about, shown on its own —
                exactly as the developer sees it, one ad at a time. */}
            {current.id === 'inline' && runInline ? (
              <>
                <InlineSponsoredPreview
                  headline={inlineHeadline}
                  ctaText={inlineCta}
                  advertiserName={me?.user.displayName ?? 'Your company'}
                />
                <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
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
                <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
                  This is exactly how it appears under a finished answer, never inside it.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </aside>
    </div>
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
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-2">
      {STEPS.map((step, index) => {
        const state = index === current ? 'current' : index < current ? 'done' : 'todo';
        const reachable = index <= furthest;

        return (
          <li key={step.id} className="flex items-center gap-2">
            <button
              type="button"
              disabled={!reachable}
              onClick={() => onJump(index)}
              aria-current={state === 'current' ? 'step' : undefined}
              className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                state === 'current'
                  ? 'border-foreground bg-foreground text-background'
                  : state === 'done'
                    ? 'border-border text-foreground hover:border-foreground/40'
                    : 'border-border text-muted-foreground'
              } ${reachable ? 'cursor-pointer' : 'cursor-default'}`}
            >
              <span
                className={`flex size-4 items-center justify-center rounded-full text-[10px] tabular-nums ${
                  state === 'current' ? 'bg-background/20' : 'bg-muted'
                }`}
              >
                {index + 1}
              </span>
              {step.title}
            </button>
            {index < STEPS.length - 1 && (
              <span aria-hidden="true" className="bg-border hidden h-px w-4 sm:block" />
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
      <Label className="mb-1 block">{label}</Label>
      {hint && <p className="text-muted-foreground mb-2 text-xs">{hint}</p>}
      {children}
    </div>
  );
}

/** How much room is left, where a field is truncated rather than wrapped. */
function Counter({ value, max }: { value: number; max: number }) {
  return (
    <p className="text-muted-foreground mt-1.5 text-xs tabular-nums">
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
    <div className="rounded-lg border p-4">
      <div className="mb-3 flex items-center justify-between gap-4">
        <div className="text-muted-foreground text-xs tracking-wide uppercase">{label}</div>
        <button
          className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-4"
          onClick={onEdit}
        >
          Edit
        </button>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <span className="text-muted-foreground shrink-0 text-xs">{label}</span>
      <span className="truncate text-right">{value}</span>
    </div>
  );
}

function SummaryChips({ label, values }: { label: string; values: string[] }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <span className="text-muted-foreground shrink-0 text-xs">{label}</span>
      {values.length === 0 ? (
        <span className="text-muted-foreground text-right">Anyone</span>
      ) : (
        <span className="flex flex-wrap justify-end gap-1">
          {values.map((value) => (
            <Badge key={value} variant="secondary" className="text-[10px]">
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
      <div>
        <div className="text-muted-foreground text-xs">{label}</div>
        {hint && <div className="text-muted-foreground text-[10px]">{hint}</div>}
      </div>
      <div
        className={`tabular-nums ${accent ? 'font-medium text-emerald-600 dark:text-emerald-400' : ''}`}
      >
        {value}
      </div>
    </div>
  );
}
