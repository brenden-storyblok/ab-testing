/**
 * experiment-metrics.ts — Functional core for per-experiment metrics.
 *
 * No Blobs, no network, no Astro imports. All IO is performed by the caller.
 *
 * The metrics record is the durable Blobs-backed state for an experiment. It
 * stores:
 *   - A roster of variant entries (seeded once from experiment.variants on the
 *     first write for that experiment, then read from the stored record).
 *   - Per-variant { impressions, conversions } counts.
 *
 * This file only defines the domain types and pure transform functions.
 * The Blobs read-modify-write shell lives in experiment-store.ts.
 *
 * Scope: issue #16 (impression metrics). Conversions are part of the shape
 * (initialised to 0) but only written by the conversion path (#17).
 */

import type { Variant } from './experiments';

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

/**
 * One row in the variant roster — the stable record of a variant inside the
 * metrics. Seeded from Variant (which the delivery path already holds) and
 * retained so the conversion endpoint never needs a Storyblok read.
 */
export interface RosterEntry {
	public_id: string;
	display_name: string;
	is_control: boolean;
	/** Zero-based insertion order — preserves the Storyblok variant ordering. */
	order: number;
}

/** Per-variant metric counters. */
export interface VariantCount {
	impressions: number;
	conversions: number;
}

/**
 * The full metrics record for one experiment, stored as a single Blob keyed by
 * experiment id. `roster` and `counts` are parallel by `public_id`.
 */
export interface ExperimentMetrics {
	/** Ordered variant metadata — seeded once on the first write. */
	roster: RosterEntry[];
	/**
	 * Per-variant metric counts, keyed by variant `public_id`.
	 * Only variants present in the roster are tracked here.
	 */
	counts: Record<string, VariantCount>;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Build a roster from the experiment's variants, preserving the array order.
 * Returns a new array — the input is not mutated.
 */
export function buildRoster(variants: Variant[]): RosterEntry[] {
	return variants.map((variant, index) => ({
		public_id: variant.public_id,
		display_name: variant.display_name,
		is_control: variant.is_control,
		order: index,
	}));
}

/**
 * Seed the roster from the experiment's variants — once.
 *
 * If the record already has a roster, it is returned unchanged: the roster is
 * read from the stored record on every subsequent write, never rebuilt. This
 * keeps writes cheap and, crucially, can never discard accumulated counts.
 *
 * Trade-off: a variant added or renamed *after* the first write is not picked
 * up in the roster (its impressions still accumulate via incrementImpression's
 * fallback, but it has no roster metadata). Acceptable for fixed-variant
 * experiments and consistent with ADR-0002's current-tallies-only posture.
 *
 * Returns a new record only when seeding; otherwise returns the input as-is.
 */
export function seedRoster(
	metrics: ExperimentMetrics,
	variants: Variant[],
): ExperimentMetrics {
	// Already seeded — read the existing roster/counts from the record.
	if (metrics.roster.length > 0) {
		return metrics;
	}

	const roster = buildRoster(variants);
	const counts: Record<string, VariantCount> = {};
	for (const rosterEntry of roster) {
		counts[rosterEntry.public_id] = metrics.counts[rosterEntry.public_id] ?? {
			impressions: 0,
			conversions: 0,
		};
	}

	return { roster, counts };
}

/**
 * Increment the impression count for the given variant.
 *
 * If the variant is not yet present in `counts` (e.g. the record was seeded
 * without this variant), its entry is initialised to { impressions: 1,
 * conversions: 0 }. The roster is not modified here — call seedRoster first.
 *
 * Returns a new metrics record — the input is not mutated.
 */
export function incrementImpression(
	metrics: ExperimentMetrics,
	variantPublicId: string,
): ExperimentMetrics {
	const existingCount = metrics.counts[variantPublicId] ?? {
		impressions: 0,
		conversions: 0,
	};

	return {
		...metrics,
		counts: {
			...metrics.counts,
			[variantPublicId]: {
				...existingCount,
				impressions: existingCount.impressions + 1,
			},
		},
	};
}

/**
 * Build an empty metrics record with no roster and no counts.
 * Used when no Blob exists yet for the experiment (first ever write).
 */
export function emptyMetrics(): ExperimentMetrics {
	return { roster: [], counts: {} };
}

/**
 * Apply a fresh-assignment impression to the metrics in one step:
 * seed the roster from the experiment's variants, then increment the
 * assigned variant's impression count.
 *
 * This is the primary entry point for the delivery route's `persist` hook.
 * Returns a new metrics record — inputs are not mutated.
 */
export function applyImpression(
	metrics: ExperimentMetrics,
	variants: Variant[],
	assignedVariantPublicId: string,
): ExperimentMetrics {
	const metricsWithRoster = seedRoster(metrics, variants);
	return incrementImpression(metricsWithRoster, assignedVariantPublicId);
}

// ---------------------------------------------------------------------------
// Conversion counting (issue #17)
// ---------------------------------------------------------------------------

/**
 * Increment the conversion count for the given variant.
 *
 * If the variant is not yet present in `counts` (e.g. a visitor arrived before
 * the roster was seeded), its entry is initialised to { impressions: 0,
 * conversions: 1 }. The roster is not modified here.
 *
 * Returns a new metrics record — the input is not mutated.
 */
export function incrementConversion(
	metrics: ExperimentMetrics,
	variantPublicId: string,
): ExperimentMetrics {
	const existingCount = metrics.counts[variantPublicId] ?? {
		impressions: 0,
		conversions: 0,
	};

	return {
		...metrics,
		counts: {
			...metrics.counts,
			[variantPublicId]: {
				...existingCount,
				conversions: existingCount.conversions + 1,
			},
		},
	};
}

// ---------------------------------------------------------------------------
// Chart building (issue #17)
// ---------------------------------------------------------------------------

/**
 * A single data series in a bar chart — a named array of numeric values whose
 * indices correspond to the chart's `labels` array. The Management API names
 * the human-readable field `label`.
 */
export interface ChartSeries {
	label: string;
	data: number[];
}

/**
 * A bar chart object in the shape expected by the Storyblok Management API
 * results endpoint (`POST spaces/:space_id/experiments/:experiment_id/results`).
 *
 * Field names match the Management API exactly: `kind` is always `"bar"`;
 * `title` is the chart heading shown in Storyblok; `labels` is the x-axis
 * (variant display names in control-first order); `series` is one or more
 * data series each keyed by `label`; `xLabel`/`yLabel` are axis captions.
 */
export interface ResultsChart {
	kind: 'bar';
	title: string;
	labels: string[];
	series: ChartSeries[];
	xLabel?: string;
	yLabel?: string;
}

/**
 * Build the two result charts from the current experiment metrics.
 *
 * Chart 1 — "Conversion rate by variant": a single series with one rate per
 * variant. Rate = conversions ÷ impressions, rounded to four decimal places.
 * Guarded for zero impressions (rate = 0).
 *
 * Chart 2 — "Impressions & conversions by variant": two series — impressions
 * (denominator) and conversions (numerator) — to convey sample size.
 *
 * Both charts order variants control-first (is_control = true, then by `order`
 * ascending). Labels are variant `display_name` from the roster.
 *
 * Returns null when the roster is empty (no roster means no meaningful chart
 * can be built). The caller should treat a null result as a skip-push signal.
 *
 * Pure function — reads only from the metrics input; never throws.
 */
export function buildResultsCharts(
	metrics: ExperimentMetrics,
): [ResultsChart, ResultsChart] | null {
	if (metrics.roster.length === 0) {
		return null;
	}

	// Sort: control first, then ascending by insertion order.
	const sortedRoster = [...metrics.roster].sort((entryA, entryB) => {
		if (entryA.is_control !== entryB.is_control) {
			return entryA.is_control ? -1 : 1;
		}
		return entryA.order - entryB.order;
	});

	const labels = sortedRoster.map((entry) => entry.display_name);

	const conversionRates = sortedRoster.map((entry) => {
		const variantCount = metrics.counts[entry.public_id];
		const impressionCount = variantCount?.impressions ?? 0;
		const conversionCount = variantCount?.conversions ?? 0;
		if (impressionCount === 0) {
			return 0;
		}
		// Round to four decimal places so the float stays human-readable in charts.
		return Math.round((conversionCount / impressionCount) * 10000) / 10000;
	});

	const impressionCounts = sortedRoster.map((entry) => {
		return metrics.counts[entry.public_id]?.impressions ?? 0;
	});

	const conversionCounts = sortedRoster.map((entry) => {
		return metrics.counts[entry.public_id]?.conversions ?? 0;
	});

	const conversionRateChart: ResultsChart = {
		kind: 'bar',
		title: 'Conversion rate by variant',
		labels,
		series: [
			{
				label: 'Conversion rate',
				data: conversionRates,
			},
		],
		xLabel: 'Variant',
		yLabel: 'Conversion rate',
	};

	const volumeChart: ResultsChart = {
		kind: 'bar',
		title: 'Impressions & conversions by variant',
		labels,
		series: [
			{
				label: 'Impressions',
				data: impressionCounts,
			},
			{
				label: 'Conversions',
				data: conversionCounts,
			},
		],
		xLabel: 'Variant',
		yLabel: 'Count',
	};

	return [conversionRateChart, volumeChart];
}
