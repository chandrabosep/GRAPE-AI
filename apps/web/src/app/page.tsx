import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { PixelQuilt } from '@/components/app/pixel-quilt';
import { Eyebrow, Section, Shell, Stamp } from '@/components/app/section';

const ACTORS = [
  {
    index: '01',
    title: 'Developers',
    body: 'Buy credits, or earn them from sponsored content that is actually relevant to what you are building. Credits pay for inference.',
    href: '/app',
    cta: 'Open your dashboard',
  },
  {
    index: '02',
    title: 'Advertisers',
    body: 'Reach developers at the moment they are choosing a tool, targeted on derived intent and real onchain history rather than demographics.',
    href: '/advertise',
    cta: 'Run a campaign',
  },
  {
    index: '03',
    title: 'AI agents',
    body: 'Pay per call over x402 on Hedera. No account, no subscription, no API key.',
    href: '/app',
    cta: 'See the ledger',
  },
];

/** The loop, as five legs of one route. */
const LEGS = [
  { code: 'BUY', body: 'A developer buys credits, or gets a starter grant on signup.' },
  { code: 'SPEND', body: 'Credits pay for AI inference, priced per token.' },
  { code: 'SHOW', body: 'A relevant sponsored card appears beside the answer, never inside it.' },
  { code: 'PAY', body: 'The advertiser funds a campaign; confirmed attention pays the developer their share.' },
  { code: 'LOOP', body: 'Those earnings are credits, which buy more inference.' },
];

const NEVER_RECEIVED = [
  'prompts',
  'source code',
  'conversations',
  'wallet addresses',
  'identities',
];

export default function LandingPage() {
  return (
    <>
      {/*
       * The hero is the one full-bleed moment on the site: atmosphere behind,
       * a 55/45 split in front, and the boarding pass laid over the right of
       * the sky. Everything below it sits on the flat void with no dividers —
       * the rhythm comes from the section gap and the stamps, not from bands.
       *
       * The sky is a pixel quilt whose hot core sits in the top right, which
       * is what decides this layout's two halves: the headline keeps the
       * bottom-left quadrant, where the quilt has already fallen back to void
       * black, and the boarding pass sits over the mid-violet band below the
       * core, where white type still holds against frosted glass.
       *
       * The vapor trail that used to cross this sky is gone. One smooth
       * hairline arc over hard-edged cells read as two unrelated drawings in
       * the same frame, and between a streak and the quilt, the quilt is the
       * thing carrying the hero.
       */}
      <section className="relative isolate overflow-hidden">
        <div className="atmosphere" aria-hidden="true">
          <PixelQuilt className="atmosphere__quilt" />
        </div>

        <Shell className="relative grid gap-14 pt-24 pb-28 md:pt-32 md:pb-36 lg:grid-cols-[55fr_45fr] lg:items-center lg:gap-16">
          <div className="rise">
            <Eyebrow>AI Attention Marketplace</Eyebrow>

            <h1 className="mt-8 text-balance">
              <span className="display-serif text-almost-white block text-[clamp(3.25rem,11vw,9.125rem)]">
                Ads that
              </span>
              <span className="text-almost-white mt-2 block text-[clamp(2rem,6.4vw,4rem)] leading-[1.05] font-light tracking-[-0.04em]">
                pay for your AI
              </span>
              <span className="display-serif text-lavender-mist mt-3 block text-[clamp(1.6rem,4.4vw,3.125rem)]">
                instead of interrupting it
              </span>
            </h1>

            <p className="text-steel mt-9 max-w-xl text-[19px] leading-relaxed font-light text-pretty">
              A coding assistant denominated in credits, where relevant sponsored content subsidises
              inference. At current settings, roughly one relevant sponsored card funds one AI
              response.
            </p>
          </div>

          <BoardingPass />
        </Shell>
      </section>

      <Shell>
        <Section>
          <Stamp sub="Three parties, one ledger. Everything on this page is denominated in credits, because credits are the only currency the marketplace has.">
            Who it is for
          </Stamp>

          {/*
           * Feature rows, not a card grid. The card IS the row — no container,
           * no fill; the hairline above each one and the spacing create the
           * boundary, which is the system's whole approach to separation.
           */}
          <div className="mt-16">
            {ACTORS.map((actor) => (
              <Link
                key={actor.title}
                href={actor.href}
                className="border-hairline hover:border-hairline-strong group grid gap-x-10 gap-y-4 border-t py-10 transition-colors last:border-b md:grid-cols-[auto_1fr_auto] md:items-baseline"
              >
                <span className="stamp-sm md:pt-1.5">{actor.index}</span>
                <span className="min-w-0">
                  <span className="text-almost-white block text-[28px] leading-tight font-light tracking-[-0.02em]">
                    {actor.title}
                  </span>
                  <span className="text-steel mt-3 block max-w-xl text-[15px] leading-relaxed text-pretty">
                    {actor.body}
                  </span>
                </span>
                <span className="text-steel group-hover:text-almost-white text-[15px] whitespace-nowrap transition-colors">
                  {actor.cta} <span aria-hidden="true">→</span>
                </span>
              </Link>
            ))}
          </div>
        </Section>

        <Section>
          <Stamp sub="Usage is what creates the inventory. A developer asking how to deploy a Solidity contract is worth more to an Ethereum infrastructure advertiser than any demographic segment, and that value exists only at the moment they ask.">
            How the loop closes
          </Stamp>

          <Route />
        </Section>

        <Section>
          {/*
           * The one violet surface on the page. It is spent here, on the single
           * number that makes the whole argument, and nowhere else — no violet
           * badges, no violet borders, no second bloom.
           *
           * Type on it is near-black, not the white the source specifies. White
           * on #af50ff is 3.64:1, which is fine for a four-word button label
           * and not fine for three lines of body copy at this size; near-black
           * is 5.13:1. The filled button keeps white, because there the text is
           * short, large and the only thing in the control.
           */}
          <div className="bloom rounded-card text-near-black grid gap-10 p-10 md:grid-cols-[1fr_auto] md:items-end md:p-14">
            <div>
              <div className="stamp-sm text-near-black/60">The exchange rate</div>
              <p className="mt-6 max-w-2xl text-[clamp(1.75rem,4vw,2.75rem)] leading-[1.1] font-light tracking-[-0.03em] text-balance">
                One relevant sponsored card funds one AI response.
              </p>
              <p className="text-near-black/70 mt-5 max-w-lg text-[15px] leading-relaxed">
                Seventy per cent of what an advertiser is charged for confirmed attention goes to
                the developer who gave it, as credits they can spend or withdraw.
              </p>
            </div>
            <div className="text-[clamp(4rem,12vw,8rem)] leading-none font-light tracking-[-0.06em] tabular-nums">
              70%
            </div>
          </div>
        </Section>

        <Section>
          <Stamp sub="Targeting runs on a closed vocabulary of derived signals. There is no database column anywhere that can hold a prompt.">
            What advertisers never receive
          </Stamp>

          <div className="mt-14 grid gap-14 lg:grid-cols-2">
            <ul className="border-hairline border-t">
              {NEVER_RECEIVED.map((item) => (
                <li
                  key={item}
                  className="border-hairline text-almost-white flex items-center gap-5 border-b py-5 text-[19px] font-light"
                >
                  <Strikethrough />
                  {item}
                </li>
              ))}
            </ul>

            <div>
              <p className="text-steel text-[15px] leading-relaxed text-pretty">
                What an advertiser can target is the complete list below, and nothing else. No
                advertiser can see an individual user at all — only whether a campaign matched.
              </p>
              <div className="mt-7 flex flex-wrap gap-2">
                {['solidity', 'smart_contract_deployment', 'lending_activity_30d', 'rust', 'rpc_provider', 'subgraph_authoring'].map(
                  (signal) => (
                    <code
                      key={signal}
                      className="border-hairline text-lavender-mist rounded-4xl border px-3 py-1.5 font-mono text-[11px]"
                    >
                      {signal}
                    </code>
                  ),
                )}
              </div>
            </div>
          </div>
        </Section>

        <Section divide className="flex flex-wrap items-center justify-between gap-8">
          <p className="display-serif text-almost-white max-w-lg text-[clamp(2rem,5vw,3.25rem)] text-balance">
            Start spending credits you did not have to buy.
          </p>
          <Button size="lg" nativeButton={false} render={<Link href="/app" />}>
            Open your dashboard
          </Button>
        </Section>
      </Shell>
    </>
  );
}

/**
 * The boarding pass.
 *
 * A frosted panel laid over the right of the hero: origin and destination
 * stamped across the top, the claim in the middle, two pill CTAs, and a
 * vertical barcode down the edge. The pink wash and the 1px white border are
 * the only things holding it — it is transparent, so the atmosphere shows
 * through and it reads as glass rather than as a box.
 */
function BoardingPass() {
  return (
    <div className="rise border-hairline-strong rounded-card bg-wash-glass relative flex gap-6 border p-8 backdrop-blur-[10px] md:p-10">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2.5">
          <Ticket />
          <span className="stamp-sm">Credit pass</span>
        </div>

        <div className="border-hairline mt-7 flex items-center gap-4 border-y py-4">
          <span className="min-w-0">
            <span className="stamp-sm block">Origin</span>
            <span className="text-almost-white mt-2 block text-sm">Attention</span>
          </span>
          <span className="text-steel shrink-0" aria-hidden="true">
            →
          </span>
          <span className="min-w-0">
            <span className="stamp-sm block">Destination</span>
            <span className="text-almost-white mt-2 block text-sm">Credits</span>
          </span>
        </div>

        <p className="text-almost-white mt-7 text-[28px] leading-[1.15] font-light tracking-[-0.02em] text-balance">
          Deploys in your editor in minutes
        </p>

        <div className="mt-8 flex flex-col gap-2.5">
          <Button
            size="pill"
            variant="pill"
            className="justify-start"
            nativeButton={false}
            render={<Link href="/app" />}
          >
            Start using AI
          </Button>
          <Button
            size="pill"
            variant="pill"
            className="justify-start"
            nativeButton={false}
            render={<Link href="/advertise" />}
          >
            Advertise to AI users
          </Button>
        </div>
      </div>

      <Barcode />
    </div>
  );
}

/**
 * The route.
 *
 * The source connects its comparison cards with a horizontal line and circular
 * node markers, "like a flight route". The loop is genuinely a route with five
 * legs, so it gets the same treatment — and because this one closes, the last
 * node is violet and carries the arrow back to the first.
 */
function Route() {
  return (
    <ol className="relative mt-16 grid gap-y-12 md:grid-cols-5 md:gap-x-6">
      {/* The line itself, behind the nodes, desktop only — stacked on a phone
          the legs already read top to bottom without it. */}
      <span
        aria-hidden="true"
        className="bg-hairline absolute top-[7px] right-0 left-0 hidden h-px md:block"
      />

      {LEGS.map((leg, index) => {
        const last = index === LEGS.length - 1;
        return (
          <li key={leg.code} className="relative">
            <span
              aria-hidden="true"
              className={`bg-background relative z-10 block size-[15px] rounded-full border ${
                last ? 'border-signal-violet' : 'border-hairline-strong'
              }`}
            >
              {last && (
                <span className="bg-signal-violet absolute inset-[3px] rounded-full" />
              )}
            </span>
            <div className="stamp-sm mt-6">{leg.code}</div>
            <p className="text-steel mt-3 text-[15px] leading-relaxed text-pretty">{leg.body}</p>
          </li>
        );
      })}
    </ol>
  );
}

/* --- line glyphs ---------------------------------------------------------- */

function Ticket() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="text-almost-white size-3.5">
      <path
        d="M1.5 6V3.5h13V6a2 2 0 0 0 0 4v2.5h-13V10a2 2 0 0 0 0-4Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A barcode, drawn as bars rather than an image — the stripe widths are fixed
    so it renders identically on the server and the client. */
function Barcode() {
  const bars = [3, 1, 1, 2, 1, 3, 1, 1, 1, 2, 2, 1, 3, 1, 1, 2, 1, 1, 2, 3, 1, 1, 2, 1];
  return (
    <div aria-hidden="true" className="hidden w-8 shrink-0 flex-col justify-center gap-[3px] sm:flex">
      {bars.map((weight, index) => (
        <span
          key={index}
          className="bg-almost-white/70 block w-full"
          style={{ height: `${weight}px` }}
        />
      ))}
    </div>
  );
}

function Strikethrough() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className="text-graphite size-4 shrink-0">
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1" />
      <path d="M3.4 12.6 12.6 3.4" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}
