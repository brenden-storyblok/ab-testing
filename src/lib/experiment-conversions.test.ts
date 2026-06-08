/**
 * Unit tests for the conversion additions in src/lib/experiment-metrics.ts
 *
 * All tests are pure / offline:
 *   - No Blobs, no network, no Astro mocks, no storyblok-js-client calls
 *   - Tests cover only the pure functions: incrementConversion, buildResultsCharts
 */
import { describe, it, expect } from 'vitest';
import {
	incrementConversion,
	buildResultsCharts,
	emptyMetrics,
	type ExperimentMetrics,
	type RosterEntry,
} from './experiment-metrics';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeRosterEntry(overrides: Partial<RosterEntry> = {}): RosterEntry {
	return {
		public_id: 'pub-ctrl',
		display_name: 'Control',
		is_control: true,
		order: 0,
		...overrides,
	};
}

function makeMetrics(overrides: Partial<ExperimentMetrics> = {}): ExperimentMetrics {
	return {
		roster: [],
		counts: {},
		...overrides,
	};
}

/** A minimal two-variant metrics record with roster and non-zero counts. */
function makeTwoVariantMetrics(): ExperimentMetrics {
	return makeMetrics({
		roster: [
			makeRosterEntry({ public_id: 'pub-ctrl', display_name: 'Control', is_control: true, order: 0 }),
			makeRosterEntry({ public_id: 'pub-var-a', display_name: 'Variant A', is_control: false, order: 1 }),
		],
		counts: {
			'pub-ctrl': { impressions: 10, conversions: 2 },
			'pub-var-a': { impressions: 8, conversions: 4 },
		},
	});
}

// ---------------------------------------------------------------------------
// incrementConversion
// ---------------------------------------------------------------------------

describe('incrementConversion', () => {
	it('increments the conversion count for the target variant', () => {
		const metrics = makeMetrics({
			counts: {
				'pub-ctrl': { impressions: 5, conversions: 0 },
				'pub-var-a': { impressions: 3, conversions: 1 },
			},
		});
		const result = incrementConversion(metrics, 'pub-ctrl');

		expect(result.counts['pub-ctrl'].conversions).toBe(1);
	});

	it('does not alter other variants when incrementing one', () => {
		const metrics = makeMetrics({
			counts: {
				'pub-ctrl': { impressions: 5, conversions: 0 },
				'pub-var-a': { impressions: 3, conversions: 2 },
			},
		});
		const result = incrementConversion(metrics, 'pub-ctrl');

		expect(result.counts['pub-var-a']).toEqual({ impressions: 3, conversions: 2 });
	});

	it('does not alter the impressions count of the incremented variant', () => {
		const metrics = makeMetrics({
			counts: {
				'pub-ctrl': { impressions: 7, conversions: 1 },
			},
		});
		const result = incrementConversion(metrics, 'pub-ctrl');

		expect(result.counts['pub-ctrl'].impressions).toBe(7);
		expect(result.counts['pub-ctrl'].conversions).toBe(2);
	});

	it('accumulates correctly across multiple increments', () => {
		let metrics = makeMetrics({
			counts: { 'pub-ctrl': { impressions: 0, conversions: 0 } },
		});
		metrics = incrementConversion(metrics, 'pub-ctrl');
		metrics = incrementConversion(metrics, 'pub-ctrl');
		metrics = incrementConversion(metrics, 'pub-ctrl');

		expect(metrics.counts['pub-ctrl'].conversions).toBe(3);
	});

	it('initialises a missing variant entry to { impressions: 0, conversions: 1 }', () => {
		const metrics = emptyMetrics();
		const result = incrementConversion(metrics, 'pub-unknown');

		expect(result.counts['pub-unknown']).toEqual({ impressions: 0, conversions: 1 });
	});

	it('does not mutate the input record', () => {
		const metrics = makeMetrics({
			counts: { 'pub-ctrl': { impressions: 0, conversions: 0 } },
		});
		const originalConversions = metrics.counts['pub-ctrl'].conversions;
		incrementConversion(metrics, 'pub-ctrl');

		expect(metrics.counts['pub-ctrl'].conversions).toBe(originalConversions);
	});

	it('preserves the roster unchanged', () => {
		const originalRoster: RosterEntry[] = [
			makeRosterEntry({ public_id: 'pub-ctrl', display_name: 'Control', is_control: true, order: 0 }),
		];
		const metrics = makeMetrics({
			roster: originalRoster,
			counts: { 'pub-ctrl': { impressions: 0, conversions: 0 } },
		});
		const result = incrementConversion(metrics, 'pub-ctrl');

		expect(result.roster).toEqual(originalRoster);
	});

	it('returns a new record — not the same reference', () => {
		const metrics = makeMetrics({
			counts: { 'pub-ctrl': { impressions: 5, conversions: 1 } },
		});
		const result = incrementConversion(metrics, 'pub-ctrl');

		expect(result).not.toBe(metrics);
	});
});

// ---------------------------------------------------------------------------
// buildResultsCharts
// ---------------------------------------------------------------------------

describe('buildResultsCharts', () => {
	// -------------------------------------------------------------------------
	// Null / empty cases
	// -------------------------------------------------------------------------

	it('returns null when the roster is empty', () => {
		const metrics = emptyMetrics();
		expect(buildResultsCharts(metrics)).toBeNull();
	});

	it('returns null for a metrics record with counts but no roster', () => {
		const metrics = makeMetrics({
			roster: [],
			counts: { 'pub-ctrl': { impressions: 5, conversions: 2 } },
		});
		expect(buildResultsCharts(metrics)).toBeNull();
	});

	// -------------------------------------------------------------------------
	// Return shape
	// -------------------------------------------------------------------------

	it('returns a tuple of exactly two charts', () => {
		const metrics = makeTwoVariantMetrics();
		const result = buildResultsCharts(metrics);

		expect(result).not.toBeNull();
		expect(Array.isArray(result)).toBe(true);
		expect(result!).toHaveLength(2);
	});

	it('both charts have kind "bar"', () => {
		const metrics = makeTwoVariantMetrics();
		const [rateChart, volumeChart] = buildResultsCharts(metrics)!;

		expect(rateChart.kind).toBe('bar');
		expect(volumeChart.kind).toBe('bar');
	});

	// -------------------------------------------------------------------------
	// Labels: display_name, control-first ordering
	// -------------------------------------------------------------------------

	it('uses variant display_name as chart labels', () => {
		const metrics = makeTwoVariantMetrics();
		const [rateChart] = buildResultsCharts(metrics)!;

		expect(rateChart.labels).toContain('Control');
		expect(rateChart.labels).toContain('Variant A');
	});

	it('places the control variant first in labels', () => {
		// Roster with control stored second to verify ordering is applied.
		const metrics = makeMetrics({
			roster: [
				makeRosterEntry({ public_id: 'pub-var-a', display_name: 'Variant A', is_control: false, order: 1 }),
				makeRosterEntry({ public_id: 'pub-ctrl', display_name: 'Control', is_control: true, order: 0 }),
			],
			counts: {
				'pub-ctrl': { impressions: 10, conversions: 3 },
				'pub-var-a': { impressions: 8, conversions: 2 },
			},
		});
		const [rateChart] = buildResultsCharts(metrics)!;

		expect(rateChart.labels[0]).toBe('Control');
		expect(rateChart.labels[1]).toBe('Variant A');
	});

	it('sorts multiple non-control variants by ascending order when control is first', () => {
		const metrics = makeMetrics({
			roster: [
				makeRosterEntry({ public_id: 'pub-var-b', display_name: 'Variant B', is_control: false, order: 2 }),
				makeRosterEntry({ public_id: 'pub-ctrl', display_name: 'Control', is_control: true, order: 0 }),
				makeRosterEntry({ public_id: 'pub-var-a', display_name: 'Variant A', is_control: false, order: 1 }),
			],
			counts: {
				'pub-ctrl': { impressions: 10, conversions: 2 },
				'pub-var-a': { impressions: 10, conversions: 3 },
				'pub-var-b': { impressions: 10, conversions: 4 },
			},
		});
		const [rateChart] = buildResultsCharts(metrics)!;

		expect(rateChart.labels).toEqual(['Control', 'Variant A', 'Variant B']);
	});

	it('both charts share the same labels array in the same order', () => {
		const metrics = makeTwoVariantMetrics();
		const [rateChart, volumeChart] = buildResultsCharts(metrics)!;

		expect(rateChart.labels).toEqual(volumeChart.labels);
	});

	// -------------------------------------------------------------------------
	// Chart 1 — Conversion rate
	// -------------------------------------------------------------------------

	it('chart 1 has the title "Conversion rate by variant" and one series labelled "Conversion rate"', () => {
		const metrics = makeTwoVariantMetrics();
		const [rateChart] = buildResultsCharts(metrics)!;

		expect(rateChart.title).toBe('Conversion rate by variant');
		expect(rateChart.series).toHaveLength(1);
		expect(rateChart.series[0].label).toBe('Conversion rate');
	});

	it('computes conversion rate correctly: conversions ÷ impressions', () => {
		const metrics = makeMetrics({
			roster: [
				makeRosterEntry({ public_id: 'pub-ctrl', display_name: 'Control', is_control: true, order: 0 }),
			],
			counts: {
				'pub-ctrl': { impressions: 10, conversions: 4 },
			},
		});
		const [rateChart] = buildResultsCharts(metrics)!;

		// 4 / 10 = 0.4
		expect(rateChart.series[0].data[0]).toBe(0.4);
	});

	it('rounds the rate to four decimal places', () => {
		const metrics = makeMetrics({
			roster: [
				makeRosterEntry({ public_id: 'pub-ctrl', display_name: 'Control', is_control: true, order: 0 }),
			],
			counts: {
				'pub-ctrl': { impressions: 3, conversions: 1 },
			},
		});
		const [rateChart] = buildResultsCharts(metrics)!;

		// 1 / 3 = 0.3333... → rounded to 0.3333
		expect(rateChart.series[0].data[0]).toBe(0.3333);
	});

	it('guards against zero impressions by returning 0 for the rate', () => {
		const metrics = makeMetrics({
			roster: [
				makeRosterEntry({ public_id: 'pub-ctrl', display_name: 'Control', is_control: true, order: 0 }),
			],
			counts: {
				'pub-ctrl': { impressions: 0, conversions: 0 },
			},
		});
		const [rateChart] = buildResultsCharts(metrics)!;

		// Should not divide by zero — rate is 0.
		expect(rateChart.series[0].data[0]).toBe(0);
	});

	it('returns 0 rate for a variant with zero impressions even if conversions somehow > 0', () => {
		// Defensive guard: should never happen in practice, but the function must
		// not produce NaN or Infinity.
		const metrics = makeMetrics({
			roster: [
				makeRosterEntry({ public_id: 'pub-ctrl', display_name: 'Control', is_control: true, order: 0 }),
			],
			counts: {
				'pub-ctrl': { impressions: 0, conversions: 5 },
			},
		});
		const [rateChart] = buildResultsCharts(metrics)!;

		expect(rateChart.series[0].data[0]).toBe(0);
		expect(isNaN(rateChart.series[0].data[0])).toBe(false);
		expect(isFinite(rateChart.series[0].data[0])).toBe(true);
	});

	it('uses 0 for variants missing from counts', () => {
		const metrics = makeMetrics({
			roster: [
				makeRosterEntry({ public_id: 'pub-ctrl', display_name: 'Control', is_control: true, order: 0 }),
			],
			counts: {}, // no entry for pub-ctrl
		});
		const [rateChart, volumeChart] = buildResultsCharts(metrics)!;

		expect(rateChart.series[0].data[0]).toBe(0);
		expect(volumeChart.series[0].data[0]).toBe(0); // impressions
		expect(volumeChart.series[1].data[0]).toBe(0); // conversions
	});

	it('chart 1 data aligns with chart labels in the same index positions', () => {
		const metrics = makeTwoVariantMetrics();
		// Control: 10 impressions, 2 conversions → rate 0.2
		// Variant A: 8 impressions, 4 conversions → rate 0.5
		const [rateChart] = buildResultsCharts(metrics)!;

		const controlIndex = rateChart.labels.indexOf('Control');
		const variantAIndex = rateChart.labels.indexOf('Variant A');

		expect(rateChart.series[0].data[controlIndex]).toBe(0.2);
		expect(rateChart.series[0].data[variantAIndex]).toBe(0.5);
	});

	// -------------------------------------------------------------------------
	// Chart 2 — Impressions & conversions
	// -------------------------------------------------------------------------

	it('chart 2 has exactly two series', () => {
		const metrics = makeTwoVariantMetrics();
		const [, volumeChart] = buildResultsCharts(metrics)!;

		expect(volumeChart.series).toHaveLength(2);
	});

	it('chart 2 has the title "Impressions & conversions by variant" and a first series labelled "Impressions"', () => {
		const metrics = makeTwoVariantMetrics();
		const [, volumeChart] = buildResultsCharts(metrics)!;

		expect(volumeChart.title).toBe('Impressions & conversions by variant');
		expect(volumeChart.series[0].label).toBe('Impressions');
	});

	it('chart 2 second series is labelled "Conversions"', () => {
		const metrics = makeTwoVariantMetrics();
		const [, volumeChart] = buildResultsCharts(metrics)!;

		expect(volumeChart.series[1].label).toBe('Conversions');
	});

	it('chart 2 impressions series contains the correct raw counts', () => {
		const metrics = makeTwoVariantMetrics();
		// Control: 10 impressions; Variant A: 8 impressions (control first)
		const [, volumeChart] = buildResultsCharts(metrics)!;

		const controlIndex = volumeChart.labels.indexOf('Control');
		const variantAIndex = volumeChart.labels.indexOf('Variant A');

		expect(volumeChart.series[0].data[controlIndex]).toBe(10);
		expect(volumeChart.series[0].data[variantAIndex]).toBe(8);
	});

	it('chart 2 conversions series contains the correct raw counts', () => {
		const metrics = makeTwoVariantMetrics();
		// Control: 2 conversions; Variant A: 4 conversions (control first)
		const [, volumeChart] = buildResultsCharts(metrics)!;

		const controlIndex = volumeChart.labels.indexOf('Control');
		const variantAIndex = volumeChart.labels.indexOf('Variant A');

		expect(volumeChart.series[1].data[controlIndex]).toBe(2);
		expect(volumeChart.series[1].data[variantAIndex]).toBe(4);
	});

	it('chart 2 data arrays have the same length as the labels array', () => {
		const metrics = makeTwoVariantMetrics();
		const [, volumeChart] = buildResultsCharts(metrics)!;

		expect(volumeChart.series[0].data).toHaveLength(volumeChart.labels.length);
		expect(volumeChart.series[1].data).toHaveLength(volumeChart.labels.length);
	});

	// -------------------------------------------------------------------------
	// Immutability
	// -------------------------------------------------------------------------

	it('does not mutate the input metrics record', () => {
		const metrics = makeTwoVariantMetrics();
		const originalRosterLength = metrics.roster.length;
		const originalControlConversions = metrics.counts['pub-ctrl'].conversions;

		buildResultsCharts(metrics);

		expect(metrics.roster).toHaveLength(originalRosterLength);
		expect(metrics.counts['pub-ctrl'].conversions).toBe(originalControlConversions);
	});

	// -------------------------------------------------------------------------
	// Single-variant edge case
	// -------------------------------------------------------------------------

	it('works correctly with a single control variant', () => {
		const metrics = makeMetrics({
			roster: [
				makeRosterEntry({ public_id: 'pub-ctrl', display_name: 'Control', is_control: true, order: 0 }),
			],
			counts: {
				'pub-ctrl': { impressions: 20, conversions: 5 },
			},
		});
		const result = buildResultsCharts(metrics);

		expect(result).not.toBeNull();
		const [rateChart, volumeChart] = result!;

		expect(rateChart.labels).toEqual(['Control']);
		expect(rateChart.series[0].data[0]).toBe(0.25); // 5 / 20
		expect(volumeChart.series[0].data[0]).toBe(20);
		expect(volumeChart.series[1].data[0]).toBe(5);
	});
});
