/**
 * experiment-metrics.ts — Functional core for per-experiment metrics.
 *
 * No Blobs, no network, no Astro imports. All IO is performed by the caller.
 *
 * The metrics record is the durable Blobs-backed state for an experiment. It
 * stores:
 *   - A roster of variant entries (seeded from experiment.variants, refreshed
 *     on each write for that experiment).
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
	/** Ordered variant metadata — seeded once, refreshed on each write. */
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
 * Refresh the roster from the current variants, preserving existing counts.
 *
 * Idempotent: counts for variants already present are carried over untouched;
 * entries for variants not yet present are initialised to zero. Handles the
 * case where variants change between writes without disturbing accumulated data.
 *
 * Returns a new metrics record — the input is not mutated.
 */
export function seedRoster(
	metrics: ExperimentMetrics,
	variants: Variant[],
): ExperimentMetrics {
	const nextRoster = buildRoster(variants);

	// Build a counts map that preserves any existing counts and initialises
	// entries for any variants not yet present.
	const nextCounts: Record<string, VariantCount> = {};
	for (const rosterEntry of nextRoster) {
		nextCounts[rosterEntry.public_id] = metrics.counts[rosterEntry.public_id] ?? {
			impressions: 0,
			conversions: 0,
		};
	}

	return {
		roster: nextRoster,
		counts: nextCounts,
	};
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
