import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const ACTORS = [
  {
    title: 'Developers',
    body: 'Buy credits, or earn them from sponsored content that is actually relevant to what you are building. Credits pay for inference.',
  },
  {
    title: 'Advertisers',
    body: 'Reach developers at the moment they are choosing a tool, targeted on derived intent and real onchain history rather than demographics.',
  },
  {
    title: 'AI agents',
    body: 'Pay per call over x402 on Hedera. No account, no subscription, no API key.',
  },
];

const STEPS = [
  'A developer buys credits, or gets a starter grant on signup.',
  'Credits pay for AI inference, priced per token.',
  'A relevant sponsored card appears beside the answer, never inside it.',
  'The advertiser funds a campaign; confirmed attention pays the developer their share.',
  'Those earnings are credits, which buy more inference.',
];

export default function LandingPage() {
  return (
    <div className="mx-auto max-w-6xl px-6">
      <section className="py-24">
        <h1 className="max-w-3xl text-5xl font-semibold tracking-tight text-balance">
          Ads that pay for your AI.
        </h1>
        <p className="text-muted-foreground mt-6 max-w-2xl text-lg leading-relaxed">
          A coding assistant denominated in credits, where relevant sponsored content subsidises
          inference instead of interrupting it. At current settings, roughly one relevant sponsored
          card funds one AI response.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Button size="lg" render={<Link href="/app" />}>
            Start using AI
          </Button>
          <Button size="lg" variant="outline" render={<Link href="/advertise" />}>
            Advertise to AI users
          </Button>
        </div>
      </section>

      <section className="grid gap-4 pb-20 sm:grid-cols-3">
        {ACTORS.map((actor) => (
          <Card key={actor.title}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{actor.title}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-sm leading-relaxed">{actor.body}</p>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="border-border/60 border-t py-16">
        <h2 className="text-xl font-semibold tracking-tight">How the loop closes</h2>
        <ol className="mt-6 grid gap-3">
          {STEPS.map((step, index) => (
            <li key={step} className="flex gap-4">
              <span className="bg-muted text-muted-foreground flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs tabular-nums">
                {index + 1}
              </span>
              <span className="text-muted-foreground text-sm leading-relaxed">{step}</span>
            </li>
          ))}
        </ol>
        <p className="text-muted-foreground mt-8 max-w-2xl text-sm leading-relaxed">
          Usage is what creates the inventory. A developer asking how to deploy a Solidity contract
          is worth more to an Ethereum infrastructure advertiser than any demographic segment, and
          that value exists only at the moment they ask.
        </p>
      </section>

      <section className="border-border/60 border-t py-16">
        <h2 className="text-xl font-semibold tracking-tight">What advertisers never receive</h2>
        <p className="text-muted-foreground mt-4 max-w-2xl text-sm leading-relaxed">
          No prompts, no source code, no conversations, no wallet addresses, no identities. Targeting
          runs on a closed vocabulary of derived signals such as{' '}
          <code className="bg-muted rounded px-1 py-0.5 text-xs">solidity</code>,{' '}
          <code className="bg-muted rounded px-1 py-0.5 text-xs">smart_contract_deployment</code> and{' '}
          <code className="bg-muted rounded px-1 py-0.5 text-xs">lending_activity_30d</code>. There is
          no database column anywhere that can hold a prompt.
        </p>
      </section>
    </div>
  );
}
