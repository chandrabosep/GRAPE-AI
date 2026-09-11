'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
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
import { api, formatCredits } from '@/lib/api';
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

export default function NewCampaignPage() {
  const router = useRouter();
  const { data: me } = useMe();
  const { data: config } = usePublicConfig();

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

  if (!me?.user.roles.includes('advertiser')) {
    return (
      <div className="text-muted-foreground mx-auto max-w-5xl px-6 py-24 text-center text-sm">
        Sign in as an advertiser to create a campaign.
      </div>
    );
  }

  const impressions = bid > 0 ? Math.floor(budget / bid) : 0;
  const rewardShare = config ? bid * config.allocation.reward : 0;

  return (
    <div className="mx-auto grid max-w-6xl gap-8 px-6 py-10 lg:grid-cols-[1fr_360px]">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">New campaign</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            You are charged per qualified impression, meaning attention the developer&apos;s client
            confirmed was on screen.
          </p>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Budget and bid</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">What the developer is doing</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <Label className="mb-2 block">AI intent</Label>
              <ChipSelect
                options={config?.taxonomy.intents ?? []}
                selected={aiIntents}
                onChange={setAiIntents}
                emptyLabel="any task"
              />
            </div>
            <div>
              <Label className="mb-2 block">Technologies</Label>
              <ChipSelect
                options={config?.taxonomy.technologies ?? []}
                selected={technologies}
                onChange={setTechnologies}
                emptyLabel="any stack"
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Who they are</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <Label className="mb-2 block">Persona</Label>
              <ChipSelect
                options={config?.taxonomy.personas ?? []}
                selected={personas}
                onChange={setPersonas}
              />
            </div>
            <div>
              <Label className="mb-2 block">Interests</Label>
              <ChipSelect
                options={config?.taxonomy.interests ?? []}
                selected={interests}
                onChange={setInterests}
              />
            </div>
            <div>
              <Label className="mb-2 block">Countries</Label>
              <ChipSelect options={COUNTRIES} selected={countries} onChange={setCountries} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Onchain history</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <p className="text-muted-foreground text-sm leading-relaxed">
              Derived from The Graph using one query shape across Aave, Compound and Uniswap.
              Developers are matched on protocol interaction, never on balances or addresses.
            </p>

            <div>
              <Label>How to use it</Label>
              <Select
                value={onchainMode}
                onValueChange={(value) => setOnchainMode((value ?? 'off') as typeof onchainMode)}
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
                <div>
                  <Label className="mb-2 block">Protocol types used in the last 30 days</Label>
                  <ChipSelect
                    options={PROTOCOL_TYPES}
                    selected={protocolTypes}
                    onChange={setProtocolTypes}
                    emptyLabel="any protocol"
                  />
                </div>
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
                    In require mode a developer with no linked wallet is ineligible, so reach will
                    be smaller and much more qualified.
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Creative</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div>
              <Label htmlFor="headline">Headline</Label>
              <Input
                id="headline"
                value={headline}
                maxLength={90}
                onChange={(e) => setHeadline(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="body">Body</Label>
              <Textarea
                id="body"
                value={body}
                maxLength={240}
                onChange={(e) => setBody(e.target.value)}
              />
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Inline ad</CardTitle>
            <p className="text-muted-foreground text-sm leading-relaxed">
              One line shown beside the answer while it is still streaming — the moment the
              developer is waiting. It is a separate auction from the card, billed at 30% of
              your bid, and a developer can be shown both in one answer only if two different
              advertisers win them.
            </p>
          </CardHeader>
          <CardContent className="grid gap-4">
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
          </CardContent>
        </Card>

        <div className="flex gap-3">
          <Button onClick={() => create.mutate()} disabled={create.isPending} size="lg">
            {create.isPending ? 'Creating…' : 'Create campaign'}
          </Button>
          <Button variant="outline" size="lg" onClick={() => router.back()}>
            Cancel
          </Button>
        </div>
      </div>

      {/* Live preview: what it costs, who it reaches, and how it looks. */}
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
            <SponsoredPreview
              headline={headline}
              body={body}
              ctaText={ctaText}
              imageUrl={imageUrl.trim() || null}
              advertiserName={me?.user.displayName ?? 'Your company'}
              rewardMicro={config ? Math.round(bid * config.allocation.reward * 1_000_000) : null}
            />
            <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
              This is exactly how it appears beside an answer, never inside it.
            </p>

            {runInline && (
              <div className="mt-6 border-t pt-5">
                <div className="text-muted-foreground mb-3 text-xs tracking-wide uppercase">
                  Inline slot
                </div>
                <InlineSponsoredPreview
                  headline={inlineHeadline}
                  ctaText={inlineCta}
                  advertiserName={me?.user.displayName ?? 'Your company'}
                />
              </div>
            )}
          </CardContent>
        </Card>
      </aside>
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
