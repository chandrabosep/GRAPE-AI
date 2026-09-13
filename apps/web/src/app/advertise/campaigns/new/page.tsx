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
import { AI_INTENT_GROUPS } from '@aam/shared';
import { ChipSelect } from '@/components/app/chip-select';
import { Eyebrow, Shell, Stamp } from '@/components/app/section';
import { InlineSponsoredPreview, SponsoredPreview } from '@/components/app/sponsored-preview';
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
  { id: 'audience', title: 'Audience', hint: 'How wide this runs, and what it narrows to' },
  { id: 'onchain', title: 'Onchain', hint: 'Optional: match on real wallet history' },
  { id: 'creative', title: 'Creative', hint: 'The card shown under a finished answer' },
  { id: 'inline', title: 'Inline ad', hint: 'The line shown while the answer is thinking' },
  { id: 'review', title: 'Review', hint: 'Check it, then create it as a draft' },
] as const;

/**
 * Options for the onchain mode select.
 *
 * Passed to `Select` as `items` as well as being mapped into `SelectItem`s:
 * Base UI resolves the trigger's label through `items`, and without it the
 * closed trigger renders the raw stored value — "boost" — rather than the
 * sentence the advertiser chose.
 */
const ONCHAIN_MODES = [
  { value: 'off', label: 'Ignore onchain history' },
  { value: 'boost', label: 'Prefer matching developers' },
  { value: 'require', label: 'Only matching developers' },
] as const;

const labelOf = (options: readonly { value: string; label: string }[], value: string) =>
  options.find((option) => option.value === value)?.label ?? value;

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

  const [name, setName] = useState('');
  const [budget, setBudget] = useState(100);
  const [bid, setBid] = useState(0.01);
  const [days, setDays] = useState(30);

  const [countries, setCountries] = useState<string[]>([]);
  const [personas, setPersonas] = useState<string[]>([]);
  const [interests, setInterests] = useState<string[]>([]);
  const [aiIntents, setAiIntents] = useState<string[]>([]);

  /**
   * Whether the advertiser has asked to narrow at all.
   *
   * The step used to open on 28 coding tasks, which framed targeting as a
   * developer survey you had to fill in before you could leave. An advertiser
   * who does not recognise that vocabulary picks the first thing they do
   * recognise, and a half-recognised guess targets worse than nothing at all.
   * So the first question is how wide to run, and the closed vocabulary is what
   * you get when the answer is "narrow it down".
   *
   * Derived from the values above rather than pinned to `everyone`, so that a
   * draft restored with dimensions already set does not open on "Everyone" and
   * contradict itself.
   */
  const [reach, setReach] = useState<'everyone' | 'narrow'>(
    personas.length + aiIntents.length + interests.length + countries.length > 0
      ? 'narrow'
      : 'everyone',
  );

  const [onchainMode, setOnchainMode] = useState<'off' | 'boost' | 'require'>('boost');
  const [protocolTypes, setProtocolTypes] = useState<string[]>([]);
  const [requireWalletActivity, setRequireWalletActivity] = useState(true);

  const [headline, setHeadline] = useState('');
  const [body, setBody] = useState('');
  const [ctaText, setCtaText] = useState('');
  const [ctaUrl, setCtaUrl] = useState('');
  // A path is accepted as well as a full URL; it is resolved against this origin
  // on submit, because the extension loads the artwork from a different one.
  const [imageUrl, setImageUrl] = useState('');

  // The inline slot gets its own copy: it has to read like a one-liner rather
  // than a truncated banner, which is the whole point of the slot.
  const [runInline, setRunInline] = useState(true);
  const [inlineHeadline, setInlineHeadline] = useState('');
  const [inlineCta, setInlineCta] = useState('');

  const targeting = useMemo(
    () => ({
      countries,
      personas,
      interests,
      // Neither is set by this builder any more. They stay in the payload
      // because the targeting contract requires them, at the values that mean
      // "do not filter on this".
      technologies: [],
      intentCategories: [],
      aiIntents,
      models: [],
      minCommercialIntent: 'low',
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
    [countries, personas, interests, aiIntents, onchainMode, protocolTypes, requireWalletActivity],
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
          // Stored exactly as typed. Resolving a relative path here would pin
          // the creative to whichever origin this builder was open on.
          imageUrl: imageUrl.trim() || null,
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

  const whoCount = personas.length + interests.length + countries.length;

  /** "Everyone" has to mean everyone, so choosing it clears the narrowing
      instead of leaving it set behind a collapsed section. */
  const reachEveryone = () => {
    setReach('everyone');
    setPersonas([]);
    setInterests([]);
    setCountries([]);
    setAiIntents([]);
  };
  const impressions = bid > 0 ? Math.floor(budget / bid) : 0;
  const rewardShare = config ? bid * config.allocation.reward : 0;

  return (
    <Shell className="grid gap-12 py-16 md:py-20 lg:grid-cols-[1fr_340px] lg:gap-16">
      {/* `min-w-0` because a grid item defaults to min-width:auto, which lets a
          wide child size the track instead of being wrapped or scrolled. */}
      <div className="min-w-0">
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
                  <Input
                    id="name"
                    value={name}
                    placeholder="Spring developer launch"
                    onChange={(e) => setName(e.target.value)}
                  />
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
              </div>
            )}

            {current.id === 'audience' && (
              <>
                <Field
                  label="How wide should this run?"
                  hint="Every dimension you leave empty matches everyone, so this is really one question: how much of the vocabulary do you want to answer?"
                >
                  <div className="grid gap-3 sm:grid-cols-2">
                    <ReachOption
                      active={reach === 'everyone'}
                      onClick={reachEveryone}
                      label="Everyone"
                      detail="Considered on every request, wherever it comes from."
                    />
                    <ReachOption
                      active={reach === 'narrow'}
                      onClick={() => setReach('narrow')}
                      label="Narrow it down"
                      detail="Choose who they are, or what they are doing."
                    />
                  </div>
                </Field>

                {reach === 'everyone' ? (
                  /* Breadth is a real choice here, not a skipped step, so it
                     gets the one thing an advertiser needs to hear about it:
                     matching everyone is not the same as winning anything. */
                  <p className="text-steel text-sm leading-relaxed">
                    Nothing is excluded — this campaign is considered on every request. It still has
                    to clear the auction&rsquo;s relevance floor to be shown, and an untargeted
                    campaign gives the request nothing to match on, so it is scored on bid alone and
                    will usually lose to a narrower one. Breadth buys reach, not impressions.
                  </p>
                ) : (
                  /* Ordered widest first. "Who they are" holds the dimensions
                     that make sense without knowing the product's vocabulary;
                     the 28 tasks are a drill-down for advertisers who want
                     them, not the price of entry. */
                  <div className="border-hairline border-t">
                    <Disclosure
                      label="Who they are"
                      hint="Standing signals rather than the question in front of them: the role inferred from what they ask about over time, the interests on their profile, and the country the request came from."
                      count={whoCount}
                    >
                      <Field label="Role">
                        <ChipSelect
                          options={config?.taxonomy.personas ?? []}
                          selected={personas}
                          onChange={setPersonas}
                          emptyLabel="any developer"
                        />
                      </Field>
                      <Field label="Interests">
                        <ChipSelect
                          options={config?.taxonomy.interests ?? []}
                          selected={interests}
                          onChange={setInterests}
                          emptyLabel="any interest"
                        />
                      </Field>
                      <Field label="Countries" hint="From request geography only.">
                        <ChipSelect
                          options={COUNTRIES}
                          selected={countries}
                          onChange={setCountries}
                          emptyLabel="anywhere"
                        />
                      </Field>
                    </Disclosure>

                    <Disclosure
                      label="What they are doing"
                      hint="Derived from the question they asked, never from a stored profile."
                      count={aiIntents.length}
                    >
                      <Field label="Task">
                        <ChipSelect
                          options={config?.taxonomy.intents ?? []}
                          groups={AI_INTENT_GROUPS}
                          selected={aiIntents}
                          onChange={setAiIntents}
                          emptyLabel="any task"
                          noun="tasks"
                        />
                      </Field>
                    </Disclosure>
                  </div>
                )}

                {/* The consequence of every choice above, on the same screen as
                    the choices. Hidden from `lg` up, where the sticky rail is
                    already showing the same number a few inches to the right. */}
                <div className="border-hairline flex flex-wrap items-baseline justify-between gap-3 border-t pt-5 lg:hidden">
                  <span className="stamp-sm">Matching now</span>
                  <span className="text-steel text-sm">
                    {estimate?.suppressed ? (
                      'Fewer than five developers — counts are hidden below that threshold'
                    ) : (
                      <>
                        <span className="text-almost-white tabular-nums">
                          {estimate?.eligibleUsers ?? '—'}
                        </span>{' '}
                        developers match this audience
                      </>
                    )}
                  </span>
                </div>
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
                    items={ONCHAIN_MODES}
                    value={onchainMode}
                    onValueChange={(value) =>
                      setOnchainMode((value ?? 'off') as typeof onchainMode)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ONCHAIN_MODES.map((mode) => (
                        <SelectItem key={mode.value} value={mode.value}>
                          {mode.label}
                        </SelectItem>
                      ))}
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
                    placeholder="What your product does, in one line"
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
                    placeholder="One or two sentences on why a developer should care."
                    maxLength={240}
                    onChange={(e) => setBody(e.target.value)}
                  />
                  <Counter value={body.length} max={240} />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2.5">
                    <Label htmlFor="cta">Call to action</Label>
                    <Input
                      id="cta"
                      value={ctaText}
                      placeholder="Read the docs"
                      onChange={(e) => setCtaText(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2.5">
                    <Label htmlFor="url">Link</Label>
                    <Input
                      id="url"
                      value={ctaUrl}
                      placeholder="https://example.com/docs"
                      onChange={(e) => setCtaUrl(e.target.value)}
                    />
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
                    Artwork always sits in a 76px square beside your copy — the card is the size of
                    a chat message and never widens for a creative. Square art is what the slot is
                    built for; 400×400 is a good target. Anything much longer than square is shown
                    whole and letterboxed rather than cropped, so a wide wordmark survives, but it
                    gets less of the square. Leave it empty and the card falls back to your
                    initials. The preview below updates either way.
                  </p>
                </div>
              </div>
            )}

            {current.id === 'inline' && (
              <div className="grid gap-4">
                <p className="text-steel text-sm leading-relaxed">
                  One line shown while the answer is still being written — the moment the developer
                  is waiting. It is a separate auction from the card, billed at 30% of your bid. The
                  two never appear at once: the line is retired the moment the answer is finished,
                  and the card takes its place.
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
                        placeholder="The same offer, short enough to read mid-answer"
                        maxLength={70}
                        onChange={(e) => setInlineHeadline(e.target.value)}
                      />
                      <p className="text-graphite mt-2 text-xs">
                        {inlineHeadline.length}/70. Write it as a useful aside, not a pitch — it
                        sits next to an answer the developer asked for, and is truncated rather than
                        wrapped.
                      </p>
                    </div>
                    <div className="space-y-2.5">
                      <Label htmlFor="inline-cta">Link text</Label>
                      <Input
                        id="inline-cta"
                        value={inlineCta}
                        placeholder="Read the docs"
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
                  <SummaryRow label="Bid" value={`$${bid.toFixed(4)} per qualified impression`} />
                  <SummaryRow label="Runs for" value={`${days} days`} />
                </Summary>

                <Summary label="Audience" onEdit={() => goTo(1)}>
                  <SummaryChips label="Role" values={personas} />
                  <SummaryChips label="Interests" values={interests} />
                  <SummaryChips label="Countries" values={countries} />
                  <SummaryChips label="Task" values={aiIntents} />
                </Summary>

                <Summary label="Onchain" onEdit={() => goTo(2)}>
                  <SummaryRow label="Mode" value={labelOf(ONCHAIN_MODES, onchainMode)} />
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
              value={`$${rewardShare.toFixed(4)}+`}
              accent
              hint={
                config
                  ? `At least ${(config.allocation.reward * 100).toFixed(0)}% of your spend. A developer on a higher earning tier gets more of it, out of our share rather than your budget.`
                  : ''
              }
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
                Shown while the answer is still being written, and retired the moment it finishes.
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
                rewardMicro={config ? Math.round(bid * config.allocation.reward * 1_000_000) : null}
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
function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <Label>{label}</Label>
      {hint && <p className="text-graphite mt-2.5 text-xs leading-relaxed">{hint}</p>}
      <div className="mt-4">{children}</div>
    </div>
  );
}

/**
 * One of the two answers to "how wide should this run?".
 *
 * A pair of pressed-state buttons rather than a `Select`, because the choice
 * carries a consequence each option has to be able to state: a dropdown can
 * show one label at a time, and the advertiser needs to weigh both.
 */
function ReachOption({
  active,
  onClick,
  label,
  detail,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  detail: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`focus-visible:ring-ring/70 rounded-[10.8px] border p-4 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none ${
        active
          ? 'border-signal-violet/50 bg-signal-violet/10'
          : 'border-hairline hover:border-almost-white/40'
      }`}
    >
      <div className={`text-[13px] ${active ? 'text-lavender-mist' : 'text-almost-white'}`}>
        {label}
      </div>
      <div className="text-graphite mt-1.5 text-xs leading-relaxed">{detail}</div>
    </button>
  );
}

/**
 * One folded dimension of the audience.
 *
 * `<details>` rather than React state: the browser already gets the keyboard,
 * the expanded state and find-in-page right for this, and three of them on one
 * step is three chances to get that wrong by hand.
 *
 * All three start shut, including ones already holding a selection. Opening on
 * a selection sounds kinder but rebuilds the wall of chips this step exists to
 * avoid — and nothing is hidden by it, because the count beside the label says
 * what is in there and the review step lists every value before anything is
 * created.
 */
function Disclosure({
  label,
  hint,
  count,
  children,
}: {
  label: string;
  hint: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <details className="border-hairline group border-b last:border-b-0">
      <summary className="flex cursor-pointer list-none items-center gap-3 py-5 [&::-webkit-details-marker]:hidden">
        <svg
          viewBox="0 0 12 12"
          aria-hidden="true"
          className="text-steel size-2.5 shrink-0 -rotate-90 transition-transform group-open:rotate-0"
        >
          <path d="M1.5 3.75 6 8.25l4.5-4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        <span className="text-almost-white flex-1 text-[13px]">{label}</span>
        {/* A zero here is the honest part: it says there is something in this
            section and you have chosen none of it. */}
        <span
          className={`shrink-0 text-[11px] tabular-nums ${
            count > 0 ? 'text-lavender-mist' : 'text-graphite'
          }`}
        >
          {count > 0 ? `${count} selected` : 'matches anyone'}
        </span>
      </summary>
      <div className="space-y-8 pb-8">
        <p className="text-graphite text-xs leading-relaxed">{hint}</p>
        {children}
      </div>
    </details>
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
      <div
        className={`shrink-0 text-sm tabular-nums ${accent ? 'text-signal-violet' : 'text-almost-white'}`}
      >
        {value}
      </div>
    </div>
  );
}
