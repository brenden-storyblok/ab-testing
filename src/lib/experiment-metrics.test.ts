/**
 * Unit tests for src/lib/experiment-metrics.ts
 *
 * All tests are pure / offline:
 *   - No Blobs, no network, no Astro mocks
 *   - The Blobs store is exercised only at the delivery-route boundary — these
 *     tests cover only the pure metrics and roster functions
 */
import { describe, it, expect } from 'vitest';
import {
	buildRoster,
	seedRoster,
	incrementImpression,
	applyImpression,
	emptyMetrics,
	type ExperimentMetrics,
	type RosterEntry,
} from './experiment-metrics';
import type { Variant } from './experiments';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeVariant(overrides: Partial<Variant> = {}): Variant {
	return {
		name: 'control',
		display_name: 'Control',
		public_id: 'pub-control',
		weight: 50,
		is_control: true,
		story_mappings: [],
		...overrides,
	};
}

function makeMetrics(
	overrides: Partial<ExperimentMetrics> = {},
): ExperimentMetrics {
	return {
		roster: [],
		counts: {},
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// emptyMetrics
// ---------------------------------------------------------------------------

describe('emptyMetrics', () => {
	it('returns a record with an empty roster and no counts', () => {
		const metrics = emptyMetrics();
		expect(metrics.roster).toEqual([]);
		expect(metrics.counts).toEqual({});
	});

	it('returns a new object on each call (no shared reference)', () => {
		const firstMetrics = emptyMetrics();
		const secondMetrics = emptyMetrics();
		expect(firstMetrics).not.toBe(secondMetrics);
	});
});

// ---------------------------------------------------------------------------
// buildRoster
// ---------------------------------------------------------------------------

describe('buildRoster', () => {
	it('maps each variant to a RosterEntry with the correct fields', () => {
		const controlVariant = makeVariant({
			public_id: 'pub-ctrl',
			display_name: 'Control',
			is_control: true,
		});
		const treatmentVariant = makeVariant({
			public_id: 'pub-var-a',
			display_name: 'Variant A',
			is_control: false,
		});
		const roster = buildRoster([controlVariant, treatmentVariant]);

		expect(roster).toHaveLength(2);
		expect(roster[0]).toEqual<RosterEntry>({
			public_id: 'pub-ctrl',
			display_name: 'Control',
			is_control: true,
			order: 0,
		});
		expect(roster[1]).toEqual<RosterEntry>({
			public_id: 'pub-var-a',
			display_name: 'Variant A',
			is_control: false,
			order: 1,
		});
	});

	it('assigns zero-based order indices matching the input array position', () => {
		const variants = [
			makeVariant({ public_id: 'pub-a', name: 'a' }),
			makeVariant({ public_id: 'pub-b', name: 'b' }),
			makeVariant({ public_id: 'pub-c', name: 'c' }),
		];
		const roster = buildRoster(variants);
		expect(roster[0].order).toBe(0);
		expect(roster[1].order).toBe(1);
		expect(roster[2].order).toBe(2);
	});

	it('returns an empty array for an empty variants list', () => {
		expect(buildRoster([])).toEqual([]);
	});

	it('does not mutate the input array', () => {
		const variants = [makeVariant({ public_id: 'pub-ctrl' })];
		const originalLength = variants.length;
		buildRoster(variants);
		expect(variants).toHaveLength(originalLength);
	});
});

// ---------------------------------------------------------------------------
// seedRoster
// ---------------------------------------------------------------------------

describe('seedRoster', () => {
	const controlVariant = makeVariant({
		public_id: 'pub-ctrl',
		display_name: 'Control',
		is_control: true,
	});
	const treatmentVariant = makeVariant({
		public_id: 'pub-var-a',
		display_name: 'Variant A',
		is_control: false,
	});
	const variants = [controlVariant, treatmentVariant];

	it('seeds the roster when the record has no roster yet', () => {
		const metrics = emptyMetrics();
		const result = seedRoster(metrics, variants);

		expect(result.roster).toHaveLength(2);
		expect(result.roster[0].public_id).toBe('pub-ctrl');
		expect(result.roster[1].public_id).toBe('pub-var-a');
	});

	it('initialises counts to zero for each variant when seeding from scratch', () => {
		const metrics = emptyMetrics();
		const result = seedRoster(metrics, variants);

		expect(result.counts['pub-ctrl']).toEqual({ impressions: 0, conversions: 0 });
		expect(result.counts['pub-var-a']).toEqual({ impressions: 0, conversions: 0 });
	});

	it('is idempotent — a second seed call with the same variants does not reset counts', () => {
		const metricsWithCounts = makeMetrics({
			roster: [
				{ public_id: 'pub-ctrl', display_name: 'Control', is_control: true, order: 0 },
				{ public_id: 'pub-var-a', display_name: 'Variant A', is_control: false, order: 1 },
			],
			counts: {
				'pub-ctrl': { impressions: 5, conversions: 2 },
				'pub-var-a': { impressions: 3, conversions: 1 },
			},
		});

		const result = seedRoster(metricsWithCounts, variants);

		// Counts must not be reset
		expect(result.counts['pub-ctrl']).toEqual({ impressions: 5, conversions: 2 });
		expect(result.counts['pub-var-a']).toEqual({ impressions: 3, conversions: 1 });
	});

	it('preserves existing counts for known variants and initialises new variants to zero', () => {
		const newVariant = makeVariant({
			public_id: 'pub-var-b',
			display_name: 'Variant B',
			is_control: false,
		});
		const metricsWithExistingCounts = makeMetrics({
			roster: [
				{ public_id: 'pub-ctrl', display_name: 'Control', is_control: true, order: 0 },
			],
			counts: {
				'pub-ctrl': { impressions: 10, conversions: 3 },
			},
		});

		const result = seedRoster(metricsWithExistingCounts, [controlVariant, newVariant]);

		expect(result.counts['pub-ctrl']).toEqual({ impressions: 10, conversions: 3 });
		expect(result.counts['pub-var-b']).toEqual({ impressions: 0, conversions: 0 });
	});

	it('does not mutate the input record', () => {
		const metrics = emptyMetrics();
		const originalRosterRef = metrics.roster;
		seedRoster(metrics, variants);
		// The original object should be unchanged
		expect(metrics.roster).toBe(originalRosterRef);
		expect(metrics.roster).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// incrementImpression
// ---------------------------------------------------------------------------

describe('incrementImpression', () => {
	it('increments the impression count for the target variant', () => {
		const metrics = makeMetrics({
			counts: {
				'pub-ctrl': { impressions: 0, conversions: 0 },
				'pub-var-a': { impressions: 0, conversions: 0 },
			},
		});
		const result = incrementImpression(metrics, 'pub-ctrl');

		expect(result.counts['pub-ctrl'].impressions).toBe(1);
	});

	it('does not alter other variants when incrementing one', () => {
		const metrics = makeMetrics({
			counts: {
				'pub-ctrl': { impressions: 0, conversions: 0 },
				'pub-var-a': { impressions: 5, conversions: 2 },
			},
		});
		const result = incrementImpression(metrics, 'pub-ctrl');

		expect(result.counts['pub-var-a']).toEqual({ impressions: 5, conversions: 2 });
	});

	it('does not alter the conversions count of the incremented variant', () => {
		const metrics = makeMetrics({
			counts: {
				'pub-ctrl': { impressions: 3, conversions: 2 },
			},
		});
		const result = incrementImpression(metrics, 'pub-ctrl');

		expect(result.counts['pub-ctrl'].impressions).toBe(4);
		expect(result.counts['pub-ctrl'].conversions).toBe(2);
	});

	it('accumulates correctly across multiple increments', () => {
		let metrics = makeMetrics({
			counts: { 'pub-ctrl': { impressions: 0, conversions: 0 } },
		});
		metrics = incrementImpression(metrics, 'pub-ctrl');
		metrics = incrementImpression(metrics, 'pub-ctrl');
		metrics = incrementImpression(metrics, 'pub-ctrl');
		expect(metrics.counts['pub-ctrl'].impressions).toBe(3);
	});

	it('initialises a missing variant entry to { impressions: 1, conversions: 0 }', () => {
		const metrics = emptyMetrics();
		const result = incrementImpression(metrics, 'pub-unknown');

		expect(result.counts['pub-unknown']).toEqual({ impressions: 1, conversions: 0 });
	});

	it('does not mutate the input record', () => {
		const metrics = makeMetrics({
			counts: { 'pub-ctrl': { impressions: 0, conversions: 0 } },
		});
		const originalImpressions = metrics.counts['pub-ctrl'].impressions;
		incrementImpression(metrics, 'pub-ctrl');
		expect(metrics.counts['pub-ctrl'].impressions).toBe(originalImpressions);
	});

	it('preserves the roster unchanged', () => {
		const originalRoster: RosterEntry[] = [
			{ public_id: 'pub-ctrl', display_name: 'Control', is_control: true, order: 0 },
		];
		const metrics = makeMetrics({
			roster: originalRoster,
			counts: { 'pub-ctrl': { impressions: 0, conversions: 0 } },
		});
		const result = incrementImpression(metrics, 'pub-ctrl');

		expect(result.roster).toEqual(originalRoster);
	});
});

// ---------------------------------------------------------------------------
// applyImpression — the combined entry point
// ---------------------------------------------------------------------------

describe('applyImpression', () => {
	const controlVariant = makeVariant({
		public_id: 'pub-ctrl',
		display_name: 'Control',
		is_control: true,
	});
	const treatmentVariant = makeVariant({
		public_id: 'pub-var-a',
		display_name: 'Variant A',
		is_control: false,
	});
	const variants = [controlVariant, treatmentVariant];

	it('seeds the roster and increments the assigned variant in one call', () => {
		const metrics = emptyMetrics();
		const result = applyImpression(metrics, variants, 'pub-ctrl');

		expect(result.roster).toHaveLength(2);
		expect(result.counts['pub-ctrl'].impressions).toBe(1);
		expect(result.counts['pub-var-a'].impressions).toBe(0);
	});

	it('increments only the assigned variant — not others', () => {
		const metrics = emptyMetrics();
		const result = applyImpression(metrics, variants, 'pub-var-a');

		expect(result.counts['pub-var-a'].impressions).toBe(1);
		expect(result.counts['pub-ctrl'].impressions).toBe(0);
	});

	it('preserves existing counts when called on a record that already has data', () => {
		const existingMetrics = makeMetrics({
			roster: [
				{ public_id: 'pub-ctrl', display_name: 'Control', is_control: true, order: 0 },
				{ public_id: 'pub-var-a', display_name: 'Variant A', is_control: false, order: 1 },
			],
			counts: {
				'pub-ctrl': { impressions: 10, conversions: 3 },
				'pub-var-a': { impressions: 7, conversions: 2 },
			},
		});

		const result = applyImpression(existingMetrics, variants, 'pub-ctrl');

		expect(result.counts['pub-ctrl'].impressions).toBe(11);
		expect(result.counts['pub-ctrl'].conversions).toBe(3);
		expect(result.counts['pub-var-a']).toEqual({ impressions: 7, conversions: 2 });
	});

	it('does not mutate the input record', () => {
		const metrics = emptyMetrics();
		applyImpression(metrics, variants, 'pub-ctrl');
		expect(metrics.roster).toHaveLength(0);
		expect(metrics.counts).toEqual({});
	});

	it('returning-visitor semantics: the route only calls applyImpression on persist=true (fresh pick)', () => {
		// This test documents the contract: returning visitors (persist=false) never
		// reach applyImpression. The pure function is called once per fresh
		// assignment, so a single call must produce exactly one impression.
		const metrics = emptyMetrics();
		const result = applyImpression(metrics, variants, 'pub-ctrl');

		// Only one impression recorded — this matches a single fresh assignment.
		expect(result.counts['pub-ctrl'].impressions).toBe(1);
	});

	it('the roster in the result reflects the current experiment variants', () => {
		const metrics = emptyMetrics();
		const result = applyImpression(metrics, variants, 'pub-ctrl');

		expect(result.roster.find((entry) => entry.public_id === 'pub-ctrl')?.is_control).toBe(true);
		expect(result.roster.find((entry) => entry.public_id === 'pub-var-a')?.is_control).toBe(false);
	});
});
