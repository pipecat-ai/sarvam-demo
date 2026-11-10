/**
 * Meters and charts from the SpellSpeak Terminal design system
 * (claude.ai/artifact/T9AEuxphmuovYq6goH422M, components/bundle.js), ported
 * from its React.createElement sources to typed components. The rules they
 * keep: a reading is lit square segments, never a smooth bar, with its number
 * beside it; the latest bar is at full strength and history a trail; a chart
 * writes its ceiling top-right and has a floor so small readings stay small.
 * Styles are the `ss-` classes in index.css, drawn in this app's tokens.
 */
import { useRef, type CSSProperties, type ReactNode } from "react"

import { cn } from "@/lib/utils"

const clamp01 = (value: number) => Math.max(0, Math.min(1, value || 0))

// ---------------------------------------------------------------------------
// Segments
// ---------------------------------------------------------------------------

export interface SegmentsProps {
  /** 0–1: the first round(value × count) segments are lit. */
  value: number
  color?: string
  count?: number
  /** Segment size in px. */
  size?: number
  gap?: number
  /** Makes it a labelled role="meter"; without it the meter is decorative. */
  label?: string
  className?: string
}

/**
 * A row of square segments. When the value moves, the segments that change
 * light up or go out one after another, 45ms apart, each popping in the
 * direction it went.
 */
export function Segments({
  value,
  color = "var(--foreground)",
  count = 10,
  size = 6,
  gap = 2,
  label,
  className,
}: SegmentsProps) {
  const filled = Math.round(clamp01(value) * count)
  const last = useRef(filled)
  const wave = useRef({ from: filled, to: filled, n: 0 })
  if (last.current !== filled) {
    wave.current = { from: last.current, to: filled, n: wave.current.n + 1 }
    last.current = filled
  }
  const { from, to, n } = wave.current
  const lo = Math.min(from, to)
  const hi = Math.max(from, to)
  const up = to > from

  return (
    <span
      className={cn("ss-seg", className)}
      style={{ gap }}
      {...(label
        ? {
            role: "meter",
            "aria-label": label,
            "aria-valuemin": 0,
            "aria-valuemax": 100,
            "aria-valuenow": Math.round(clamp01(value) * 100),
          }
        : { "aria-hidden": true })}
    >
      {Array.from({ length: count }, (_, i) => {
        const moved = n > 0 && i >= lo && i < hi
        const order = up ? i - lo : hi - 1 - i
        return (
          <i
            key={moved ? `${i}-${n}` : i}
            className={moved ? "ss-pop" : undefined}
            style={
              {
                width: size,
                height: size,
                background: i < filled ? color : undefined,
                transitionDelay: moved ? `${order * 45}ms` : "0ms",
                animationDelay: moved ? `${order * 45}ms` : undefined,
                "--pop-y": up ? "-3px" : "3px",
              } as CSSProperties
            }
          />
        )
      })}
    </span>
  )
}

// ---------------------------------------------------------------------------
// MiniBars
// ---------------------------------------------------------------------------

export interface MiniBarsProps {
  values: number[]
  /** Scale top; defaults to the largest value. */
  max?: number
  height?: number
  color?: string
  label?: string
  className?: string
}

/** A tiny bar chart for inside a line: 3px bars 1px apart, the latest lit and the rest a trail. */
export function MiniBars({
  values,
  max,
  height = 16,
  color = "var(--agent)",
  label,
  className,
}: MiniBarsProps) {
  const top = max ?? Math.max(1, ...values)
  return (
    <span
      className={cn("ss-minibars", className)}
      style={{ height }}
      role="img"
      aria-label={label ?? values.join(", ")}
    >
      {values.map((value, i) => (
        <i
          key={i}
          style={{
            height: Math.max(1, Math.round((value / (top || 1)) * height)),
            background: color,
            opacity: i === values.length - 1 ? 1 : "var(--opacity-trail)",
          }}
        />
      ))}
    </span>
  )
}

// ---------------------------------------------------------------------------
// BarChart
// ---------------------------------------------------------------------------

export interface BarDatum {
  value: number
  color?: string
  label?: string
  /** Stable key, so old bars don't re-grow when new ones arrive. */
  key?: string | number
}

export interface BarChartProps {
  data: BarDatum[]
  /** The scale never drops below this, so small readings look small. */
  floor?: number
  unit?: string
  format?: (ceiling: number) => string
  height?: number
  barWidth?: number
  /** How many of the latest bars to show. */
  limit?: number
  color?: string
  /** Sentence shown before the first bar. */
  empty?: ReactNode
  label?: string
  className?: string
}

/**
 * A bar per reading on one scale, on a 2px baseline with the ceiling written
 * top-right. The latest bar is at full strength, the rest a trail; new bars
 * grow in from the baseline with a small overshoot.
 */
export function BarChart({
  data,
  floor = 0,
  unit,
  format,
  height = 56,
  barWidth = 7,
  limit = 40,
  color = "var(--agent)",
  empty = "a bar for every reading, as it arrives",
  label,
  className,
}: BarChartProps) {
  const start = Math.max(0, data.length - limit)
  const shown = data.slice(start)
  const scale = Math.max(floor, ...shown.map((d) => d.value)) || 1
  return (
    <div
      className={cn("ss-bars", className)}
      style={{ height }}
      role="img"
      aria-label={label}
    >
      <span className="ss-bars-ceil ss-t-axis">
        {(format ? format(scale) : scale.toFixed(0)) + (unit ? ` ${unit}` : "")}
      </span>
      {shown.length === 0 && <span className="ss-bars-empty">{empty}</span>}
      {shown.map((d, i) => (
        <i
          key={d.key ?? start + i}
          title={d.label}
          style={{
            width: barWidth,
            height: `${Math.max(4, (d.value / scale) * 100)}%`,
            background: d.color ?? color,
            opacity: i === shown.length - 1 ? 1 : "var(--opacity-trail)",
          }}
        />
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Stat, SectionLabel
// ---------------------------------------------------------------------------

export interface StatProps {
  label: ReactNode
  /** Null prints an em dash: no value yet. */
  value: ReactNode | null
  unit?: string
  color?: string
  /** Anything after the value: a MiniBars, a Delta. */
  aside?: ReactNode
  align?: "right"
  className?: string
}

/** A number with its name: a tracked label over an extrabold tabular value. */
export function Stat({
  label,
  value,
  unit,
  color,
  aside,
  align,
  className,
}: StatProps) {
  return (
    <div
      className={cn(
        "ss-stat",
        align === "right" && "items-end text-right",
        className
      )}
    >
      <span className="ss-t-label">{label}</span>
      <span className="ss-stat-val" style={{ color }}>
        {value ?? "—"}
        {unit && <small>{unit}</small>}
        {aside}
      </span>
    </div>
  )
}

/** A group's header row: its name on the left, its scale or unit on the right. */
export function SectionLabel({
  left,
  right,
}: {
  left: ReactNode
  right?: ReactNode
}) {
  return (
    <p className="ss-section-label ss-t-label">
      <span>{left}</span>
      {right != null && <span>{right}</span>}
    </p>
  )
}
