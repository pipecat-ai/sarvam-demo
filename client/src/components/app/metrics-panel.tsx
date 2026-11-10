import { Panel } from "@/components/pipecat/panel"
import {
  BarChart,
  MiniBars,
  Segments,
  SectionLabel,
  Stat,
} from "@/components/spellspeak/meters"
import {
  usePipecatMetrics,
  usePipecatTokenTotals,
  type MetricCategory,
  type MetricSeries,
} from "@/hooks/use-pipecat-metrics"
import { cn } from "@/lib/utils"

// Anchored on the class names: a loose /TTS/ would also match any
// "...STTService" (it contains "TTS").
const TTS_PROCESSOR = /^SarvamTTSService/
const STT_PROCESSOR = /^SarvamSTTService/
const LLM_PROCESSOR = /LLMService/

/** A stage's meter is full at one second. */
const STAGE_BUDGET_S = 1
/** History shown beside each stage. */
const TRAIL = 16

/** Seconds → "320ms" or "1.24s". */
function formatSeconds(seconds: number | null): string | null {
  if (seconds === null) return null
  return seconds < 1
    ? `${Math.round(seconds * 1000)}ms`
    : `${seconds.toFixed(2)}s`
}

/** 1500 → "1.5k", 31000 → "31k". */
function formatCount(value: number): string {
  const scale = (n: number) =>
    n >= 10 ? String(Math.round(n)) : n.toFixed(1).replace(/\.0$/, "")
  if (value >= 1_000_000) return `${scale(value / 1_000_000)}M`
  if (value >= 1_000) return `${scale(value / 1_000)}k`
  return String(Math.round(value))
}

/** Speed as colour: green while quick, amber past half the budget, pink over it. */
function speedColor(seconds: number | null, budget: number): string {
  if (seconds === null || seconds <= budget / 2)
    return "var(--active-background)"
  return seconds <= budget ? "var(--tool)" : "var(--inactive-background)"
}

function seriesFor(
  series: MetricSeries[],
  category: MetricCategory,
  pattern: RegExp
): MetricSeries | undefined {
  return series.find(
    (s) => s.category === category && pattern.test(s.processor)
  )
}

/**
 * Time to first audio per reply: each TTS ttfa plus the LLM ttfb that came
 * just before it. Excludes the STT, which has its own row.
 */
function replyLatencies(series: MetricSeries[]) {
  const tts = seriesFor(series, "ttfa", TTS_PROCESSOR)?.points ?? []
  const llm = seriesFor(series, "ttfb", LLM_PROCESSOR)?.points ?? []
  return tts.map((point) => {
    const before = llm.filter((p) => p.time <= point.time).at(-1)
    return { time: point.time, value: point.value + (before?.value ?? 0) }
  })
}

/** One pipeline stage: its latest reading as segments, the number, and its history. */
function StageRow({
  label,
  series,
}: {
  label: string
  series: MetricSeries | undefined
}) {
  const latest = series?.latest ?? null
  const color = speedColor(latest, STAGE_BUDGET_S)
  const trail = (series?.points ?? []).slice(-TRAIL).map((p) => p.value)
  return (
    <div className="grid grid-cols-[2.75rem_auto_4rem_1fr] items-center gap-x-3 py-0.5">
      <span className="ss-t-label">{label}</span>
      <Segments
        value={(latest ?? 0) / STAGE_BUDGET_S}
        color={color}
        label={`${label} latency`}
      />
      <span
        className="text-right text-[12px] font-bold tabular-nums"
        style={{ color: latest === null ? undefined : color }}
      >
        {formatSeconds(latest) ?? "—"}
      </span>
      {trail.length > 1 ? (
        <MiniBars
          values={trail}
          max={Math.max(STAGE_BUDGET_S, ...trail)}
          color={color}
          label={`${label} history`}
        />
      ) : (
        <span />
      )}
    </div>
  )
}

export interface MetricsPanelProps {
  className?: string
}

/**
 * The always-visible readout beside the transcript, in the SpellSpeak
 * Terminal style: each stage's latest latency as a segment meter, a bar per
 * reply for the LLM + TTS time to first audio, and the session's totals.
 * Must be rendered inside a PipecatClientProvider.
 */
export function MetricsPanel({ className }: MetricsPanelProps) {
  const { series } = usePipecatMetrics()
  const { tokens, hasTokens } = usePipecatTokenTotals()
  const replies = replyLatencies(series)
  const values = replies.map((r) => r.value)
  const average = values.length
    ? values.reduce((sum, v) => sum + v, 0) / values.length
    : null
  const best = values.length ? Math.min(...values) : null

  return (
    <Panel
      title="metrics"
      status={
        <span className="text-muted-foreground">
          {replies.length} {replies.length === 1 ? "reply" : "replies"}
        </span>
      }
      className={cn("flex flex-col", className)}
    >
      <div className="flex flex-col gap-3 px-4 pt-5 pb-3">
        <div>
          <SectionLabel left="latest" right="0–1s" />
          <StageRow
            label="stt"
            series={seriesFor(series, "ttfb", STT_PROCESSOR)}
          />
          <StageRow
            label="llm"
            series={seriesFor(series, "ttfb", LLM_PROCESSOR)}
          />
          <StageRow
            label="tts"
            series={seriesFor(series, "ttfa", TTS_PROCESSOR)}
          />
        </div>

        <div>
          <SectionLabel left="llm + tts · first audio" right="per reply" />
          <BarChart
            data={replies.map((r) => ({
              key: r.time,
              value: r.value * 1000,
              color: speedColor(r.value, 2 * STAGE_BUDGET_S),
              label: formatSeconds(r.value) ?? undefined,
            }))}
            floor={1500}
            unit="ms"
            height={44}
            empty="a bar for every reply, as it's spoken"
            label="LLM plus TTS time to first audio per reply"
          />
        </div>

        <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
          <Stat label="avg" value={formatSeconds(average)} />
          <Stat label="best" value={formatSeconds(best)} />
          <Stat
            label="tokens"
            value={hasTokens ? formatCount(tokens.total) : null}
            color="var(--agent)"
            className="ml-auto"
            align="right"
          />
        </div>
      </div>
    </Panel>
  )
}
