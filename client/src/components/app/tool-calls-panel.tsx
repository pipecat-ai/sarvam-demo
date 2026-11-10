import { Metric } from "@/components/pipecat/metric"
import { Panel } from "@/components/pipecat/panel"
import {
  useLastToolCall,
  useToolCallFlash,
  type ToolCall,
} from "@/hooks/use-tool-calls"
import { cn } from "@/lib/utils"

/** The reservation tools in server/tools.py, with their counter labels. */
const RESERVATION_TOOLS = [
  { name: "get_reservation", label: "look up" },
  { name: "create_reservation", label: "book" },
  { name: "update_reservation", label: "change" },
]

/** One tool's session call count, flashed green for a beat on each call. */
function ToolCounter({ name, label }: { name: string; label: string }) {
  const { count, flashing } = useToolCallFlash(name)
  return (
    <Metric
      layout="stack"
      label={label}
      value={String(count).padStart(2, "0")}
      // duration-0 in, duration-700 out: the whole cell snaps green with
      // the call and fades back over the beat after it.
      valueClassName={cn(
        "transition-colors duration-700",
        flashing ? "text-active duration-0" : "text-foreground"
      )}
      className={cn(
        "pt-5 pb-3 transition-colors duration-700 not-first:border-l not-first:border-border not-first:pl-3",
        flashing &&
          "bg-active/25 duration-0 [&_[data-slot=metric-label]]:text-active"
      )}
    />
  )
}

/** `name=Jon Taylor, party_size=2` from a call's arguments. */
function formatArguments(args: Record<string, unknown> | null): string {
  if (!args) return ""
  return Object.entries(args)
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(", ")
}

/** What came back, in a word or two: the confirmation number, or why not. */
function formatResult(call: ToolCall): string {
  if (call.cancelled) return "cancelled"
  if (call.result === undefined) return "…"
  const result = call.result as Record<string, unknown> | null
  if (!result || typeof result !== "object") return "ok"
  const reservation = result.reservation as Record<string, unknown> | undefined
  if (reservation?.confirmation_number)
    return `#${reservation.confirmation_number}`
  if (result.found === false) return "not found"
  if (result.success === false) return "failed"
  if (result.hanging_up) return "hanging up"
  return "ok"
}

/** The latest call: name, arguments and result, on one wrapping line. */
function LastCall() {
  const call = useLastToolCall()
  return (
    <div className="border-t border-border px-4 py-2 text-[12px] leading-5">
      <span className="text-muted-foreground">last call · </span>
      {call ? (
        <span className="break-words">
          <span className="text-tool">{call.name}</span>
          <span className="text-muted-foreground">
            ({formatArguments(call.arguments)})
          </span>
          <span className="text-muted-foreground"> → </span>
          <span className="text-foreground">{formatResult(call)}</span>
        </span>
      ) : (
        <span className="text-muted-foreground/50">none yet</span>
      )}
    </div>
  )
}

export interface ToolCallsPanelProps {
  className?: string
}

/**
 * The host's tool calls, as in turkcat's turkish bot: a flashing counter per
 * reservation tool, and the latest call with its arguments and result. Must
 * be rendered inside a PipecatClientProvider.
 */
export function ToolCallsPanel({ className }: ToolCallsPanelProps) {
  return (
    <Panel title="tool calls" className={className}>
      <div className="grid grid-cols-3 px-4">
        {RESERVATION_TOOLS.map((tool) => (
          <ToolCounter key={tool.name} name={tool.name} label={tool.label} />
        ))}
      </div>
      <LastCall />
    </Panel>
  )
}
