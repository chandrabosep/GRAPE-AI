'use client';

import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCredits } from '@/lib/api';

/**
 * Campaign performance charts.
 *
 * Two rules shape the layout. Measures with different units never share a y-axis
 * — spend and impressions are separate charts rather than one chart with two
 * scales, which is the single most misread thing a dashboard can do. And colour
 * never carries identity alone: every chart with more than one series has a
 * legend and a labelled end point, so the series are readable in greyscale, in
 * print, and to a colourblind reader.
 *
 * The palette is the design system's own, not a categorical set borrowed from
 * outside it. This page is 95% achromatic with one violet, and a chart that
 * introduced blue and green would spend a colour budget the rest of the page
 * does not have — the violet would stop meaning "this is the thing" the moment
 * a second saturated hue appeared beside it.
 *
 * So series are separated by lightness against the void rather than by hue:
 * the violet carries the series the reader came for (what they were paid, what
 * they spent), paper-white carries its counterpart, and steel carries any
 * third. All three clear 4.5:1 on #090909 and stay separable in greyscale and
 * under every CVD simulation, because lightness is the channel doing the work.
 * The legends and end-point labels stay regardless: colour never carries
 * identity alone here.
 */

export interface InsightPoint {
  day: string;
  impressions: number;
  qualified: number;
  clicks: number;
  spendMicro: string;
  rewardMicro: string;
  clickThroughRate: number;
}

export interface FormatBreakdown {
  format: 'banner' | 'inline';
  impressions: number;
  qualified: number;
  clicks: number;
  spendMicro: string;
  clickThroughRate: number;
}

export interface CampaignInsights {
  totals: {
    impressions: number;
    qualified: number;
    clicks: number;
    spendMicro: string;
    rewardMicro: string;
    viewRate: number;
    clickThroughRate: number;
    costPerClickMicro: string | null;
    costPerMilleMicro: string | null;
    averageRelevance: number;
  };
  series: InsightPoint[];
  byFormat: FormatBreakdown[];
  topIntents: { intent: string; impressions: number }[];
}

/**
 * Chart roles, defined once.
 *
 * There is no per-theme swap any more because there is no second theme: the
 * canvas is always #090909, so these are tuned for that surface and nothing
 * else. Still custom properties rather than inline hex, so a role can be
 * retuned in one place and every mark that plays that role follows.
 */
const VIZ_STYLE = `
.viz {
  --series-spend: #f7f9fa;
  --series-reward: #af50ff;
  --series-banner: #f7f9fa;
  --series-inline: #828384;
  --viz-surface: #090909;
  --viz-grid: rgba(247, 249, 250, 0.1);
  --viz-axis: #6b6b6b;
}
`;

/** "Sep 4" — a daily axis has no room for a year, and every point shares it. */
function shortDay(iso: string): string {
  const [, month, day] = iso.split('-');
  const name = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ][Number(month) - 1];
  return `${name} ${Number(day)}`;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/**
 * A money tick formatter with enough precision for the range actually plotted.
 *
 * Two cents of spend across a fixed two decimals renders "$0.01" twice on
 * adjacent ticks, which reads as a broken axis rather than a small number. The
 * precision follows the largest value in the window instead.
 */
function moneyTicks(max: number): (value: number) => string {
  const digits = max >= 1 ? 2 : max >= 0.1 ? 3 : 4;
  return (value: number) => `$${value.toFixed(digits)}`;
}

/**
 * A dot on the final point only.
 *
 * A line that is flat at zero for most of the window and moves once at the end
 * is almost invisible — and a window with a single active day has no segment to
 * draw at all. Anchoring the end makes "where the series actually is" legible
 * without putting a marker on every point.
 */
function endDot(color: string, lastIndex: number) {
  return function EndDot(props: { cx?: number; cy?: number; index?: number }) {
    if (props.index !== lastIndex || props.cx === undefined || props.cy === undefined) {
      return <g />;
    }
    return (
      <circle
        cx={props.cx}
        cy={props.cy}
        r={4}
        fill={color}
        stroke="var(--viz-surface)"
        strokeWidth={2}
      />
    );
  };
}

const AXIS = {
  stroke: 'var(--viz-axis)',
  fontSize: 11,
  tickLine: false,
  axisLine: false,
} as const;

/** Legend swatch plus label. The label is ink; only the swatch carries the hue. */
function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="text-steel mb-3 flex flex-wrap items-center gap-4 text-xs">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: item.color }}
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}

interface TooltipRow {
  label: string;
  value: string;
  color: string;
}

/** One shared tooltip shell, so every chart reads the same way on hover. */
function VizTooltip({
  active,
  label,
  rows,
}: {
  active?: boolean;
  label?: string;
  rows: TooltipRow[];
}) {
  if (!active || rows.length === 0) return null;

  return (
    // Hairline and radius, no shadow — the system creates depth with line
    // weight everywhere else and a tooltip is not the place to break that.
    <div className="bg-popover text-popover-foreground border-hairline-strong rounded-[10.8px] border px-3.5 py-2.5 text-xs">
      {label && <div className="stamp-sm mb-2">{label}</div>}
      {rows.map((row) => (
        <div key={row.label} className="flex items-center gap-2 tabular-nums">
          <span
            aria-hidden="true"
            className="inline-block h-2 w-2 rounded-full"
            style={{ background: row.color }}
          />
          <span className="text-muted-foreground">{row.label}</span>
          <span className="ml-auto font-medium">{row.value}</span>
        </div>
      ))}
    </div>
  );
}

export function InsightsCharts({ data }: { data: CampaignInsights }) {
  const [showTable, setShowTable] = useState(false);

  // Recharts needs numbers; money arrives as micro-USD strings so it survives
  // the wire without losing precision.
  const series = useMemo(
    () =>
      data.series.map((point) => ({
        ...point,
        label: shortDay(point.day),
        spend: Number(point.spendMicro) / 1_000_000,
        reward: Number(point.rewardMicro) / 1_000_000,
        ctrPercent: point.clickThroughRate * 100,
      })),
    [data.series],
  );

  const lastIndex = series.length - 1;
  const formatMoney = useMemo(
    () => moneyTicks(Math.max(0, ...series.map((p) => Math.max(p.spend, p.reward)))),
    [series],
  );

  const hasActivity = data.totals.impressions > 0;

  if (!hasActivity) {
    return (
      <Card>
        <CardContent className="text-muted-foreground py-12 text-center text-sm">
          No impressions yet. Once a campaign is live and matching questions, delivery
          and spend appear here daily.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="viz space-y-4">
      <style>{VIZ_STYLE}</style>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Two series, same unit, so one axis is honest. */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Delivery</CardTitle>
            <p className="text-muted-foreground text-xs">
              Selected is what won an auction. Qualified is what a developer actually looked
              at — only qualified impressions are billed.
            </p>
          </CardHeader>
          <CardContent>
            <Legend
              items={[
                { label: 'Selected', color: 'var(--series-spend)' },
                { label: 'Qualified', color: 'var(--series-reward)' },
              ]}
            />
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={series} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
                <CartesianGrid stroke="var(--viz-grid)" vertical={false} />
                <XAxis dataKey="label" {...AXIS} minTickGap={24} />
                <YAxis {...AXIS} width={44} allowDecimals={false} />
                <Tooltip
                  cursor={{ stroke: 'var(--viz-grid)', strokeWidth: 1 }}
                  content={({ active, label, payload }) => (
                    <VizTooltip
                      active={active}
                      label={String(label ?? '')}
                      rows={(payload ?? []).map((entry) => ({
                        label: entry.name === 'impressions' ? 'Selected' : 'Qualified',
                        value: Number(entry.value).toLocaleString(),
                        color: String(entry.color),
                      }))}
                    />
                  )}
                />
                <Line
                  type="monotone"
                  dataKey="impressions"
                  stroke="var(--series-spend)"
                  strokeWidth={2}
                  strokeLinecap="round"
                  isAnimationActive={false}
                  strokeLinejoin="round"
                  dot={endDot('var(--series-spend)', lastIndex)}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--viz-surface)' }}
                />
                <Line
                  type="monotone"
                  dataKey="qualified"
                  stroke="var(--series-reward)"
                  strokeWidth={2}
                  strokeLinecap="round"
                  isAnimationActive={false}
                  strokeLinejoin="round"
                  dot={endDot('var(--series-reward)', lastIndex)}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--viz-surface)' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Also one unit — micro-USD — so these two belong together. */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Spend and developer earnings</CardTitle>
            <p className="text-muted-foreground text-xs">
              What you were charged, and the share of it that reached the developers who
              saw your ad.
            </p>
          </CardHeader>
          <CardContent>
            <Legend
              items={[
                { label: 'Spend', color: 'var(--series-spend)' },
                { label: 'Paid to developers', color: 'var(--series-reward)' },
              ]}
            />
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={series} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
                <CartesianGrid stroke="var(--viz-grid)" vertical={false} />
                <XAxis dataKey="label" {...AXIS} minTickGap={24} />
                <YAxis {...AXIS} width={64} tickFormatter={formatMoney} />
                <Tooltip
                  cursor={{ stroke: 'var(--viz-grid)', strokeWidth: 1 }}
                  content={({ active, label, payload }) => (
                    <VizTooltip
                      active={active}
                      label={String(label ?? '')}
                      rows={(payload ?? []).map((entry) => ({
                        label: entry.name === 'spend' ? 'Spend' : 'Paid to developers',
                        value: `$${Number(entry.value).toFixed(4)}`,
                        color: String(entry.color),
                      }))}
                    />
                  )}
                />
                <Line
                  type="monotone"
                  dataKey="spend"
                  stroke="var(--series-spend)"
                  strokeWidth={2}
                  strokeLinecap="round"
                  isAnimationActive={false}
                  dot={endDot('var(--series-spend)', lastIndex)}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--viz-surface)' }}
                />
                <Line
                  type="monotone"
                  dataKey="reward"
                  stroke="var(--series-reward)"
                  strokeWidth={2}
                  strokeLinecap="round"
                  isAnimationActive={false}
                  dot={endDot('var(--series-reward)', lastIndex)}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--viz-surface)' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* A rate, not a count: its own chart rather than a second axis. */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Click-through rate</CardTitle>
            <p className="text-muted-foreground text-xs">
              Clicks as a share of qualified impressions. One series, so the title names it.
            </p>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={series} margin={{ top: 8, right: 12, bottom: 0, left: -16 }}>
                <CartesianGrid stroke="var(--viz-grid)" vertical={false} />
                <XAxis dataKey="label" {...AXIS} minTickGap={24} />
                <YAxis
                  {...AXIS}
                  width={48}
                  tickFormatter={(value: number) => `${value.toFixed(0)}%`}
                />
                <Tooltip
                  cursor={{ stroke: 'var(--viz-grid)', strokeWidth: 1 }}
                  content={({ active, label, payload }) => (
                    <VizTooltip
                      active={active}
                      label={String(label ?? '')}
                      rows={(payload ?? []).map((entry) => ({
                        label: 'Click-through rate',
                        value: `${Number(entry.value).toFixed(1)}%`,
                        color: String(entry.color),
                      }))}
                    />
                  )}
                />
                <Line
                  type="monotone"
                  dataKey="ctrPercent"
                  stroke="var(--series-spend)"
                  strokeWidth={2}
                  strokeLinecap="round"
                  isAnimationActive={false}
                  dot={endDot('var(--series-spend)', lastIndex)}
                  activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--viz-surface)' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">By format</CardTitle>
            <p className="text-muted-foreground text-xs">
              Impressions served in each slot — the banner card below a finished answer,
              against the single line shown while it streams. Hover for what qualified.
            </p>
          </CardHeader>
          <CardContent>
            {data.byFormat.length === 0 ? (
              <p className="text-muted-foreground py-8 text-center text-sm">
                No impressions in either format yet.
              </p>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart
                  data={data.byFormat}
                  margin={{ top: 8, right: 12, bottom: 0, left: -18 }}
                >
                  <CartesianGrid stroke="var(--viz-grid)" vertical={false} />
                  <XAxis dataKey="format" {...AXIS} />
                  <YAxis {...AXIS} width={44} allowDecimals={false} />
                  <Tooltip
                    cursor={{ fill: 'var(--viz-grid)' }}
                    content={({ active, label, payload }) => {
                      const row = payload?.[0]?.payload as FormatBreakdown | undefined;
                      if (!row) return null;
                      return (
                        <VizTooltip
                          active={active}
                          label={String(label ?? '')}
                          rows={[
                            {
                              label: 'Served',
                              value: row.impressions.toLocaleString(),
                              color: `var(--series-${row.format})`,
                            },
                            {
                              label: 'Qualified',
                              value: row.qualified.toLocaleString(),
                              color: `var(--series-${row.format})`,
                            },
                            {
                              label: 'Clicks',
                              value: row.clicks.toLocaleString(),
                              color: `var(--series-${row.format})`,
                            },
                            {
                              label: 'CTR',
                              value: percent(row.clickThroughRate),
                              color: `var(--series-${row.format})`,
                            },
                          ]}
                        />
                      );
                    }}
                  />
                  <Bar
                    dataKey="impressions"
                    maxBarSize={24}
                    radius={[4, 4, 0, 0]}
                    isAnimationActive={false}
                  >
                    {data.byFormat.map((row) => (
                      <Cell key={row.format} fill={`var(--series-${row.format})`} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {data.topIntents.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">What people were actually asking</CardTitle>
            <p className="text-muted-foreground text-xs">
              The derived intents that won your impressions. Taxonomy values only — no
              prompt text is recorded anywhere.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.topIntents.map((row) => {
              const share = row.impressions / (data.topIntents[0]?.impressions || 1);
              return (
                <div key={row.intent} className="flex items-center gap-3 text-sm">
                  <span className="w-52 shrink-0 truncate">{row.intent.replace(/_/g, ' ')}</span>
                  <span className="bg-muted h-2 flex-1 overflow-hidden rounded-full">
                    <span
                      className="block h-full rounded-full"
                      style={{
                        width: `${Math.max(share * 100, 2)}%`,
                        background: 'var(--series-spend)',
                      }}
                    />
                  </span>
                  <span className="text-muted-foreground w-12 text-right tabular-nums">
                    {row.impressions.toLocaleString()}
                  </span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* The table is the relief for anyone the colours do not reach: a
          colourblind reader, a printout, or a screen reader. */}
      <div>
        <button
          className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-4"
          onClick={() => setShowTable((open) => !open)}
        >
          {showTable ? 'Hide the numbers' : 'Show the numbers'}
        </button>

        {showTable && (
          <div className="mt-3 overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Day</th>
                  <th className="px-3 py-2 text-right font-medium">Selected</th>
                  <th className="px-3 py-2 text-right font-medium">Qualified</th>
                  <th className="px-3 py-2 text-right font-medium">Clicks</th>
                  <th className="px-3 py-2 text-right font-medium">CTR</th>
                  <th className="px-3 py-2 text-right font-medium">Spend</th>
                  <th className="px-3 py-2 text-right font-medium">To developers</th>
                </tr>
              </thead>
              <tbody>
                {data.series
                  .filter((point) => point.impressions > 0)
                  .map((point) => (
                    <tr key={point.day} className="border-t tabular-nums">
                      <td className="px-3 py-1.5">{shortDay(point.day)}</td>
                      <td className="px-3 py-1.5 text-right">{point.impressions}</td>
                      <td className="px-3 py-1.5 text-right">{point.qualified}</td>
                      <td className="px-3 py-1.5 text-right">{point.clicks}</td>
                      <td className="px-3 py-1.5 text-right">
                        {percent(point.clickThroughRate)}
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        {formatCredits(point.spendMicro, 4)}
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        {formatCredits(point.rewardMicro, 4)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
