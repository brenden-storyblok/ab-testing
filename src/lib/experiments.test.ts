/**
 * Unit tests for src/lib/experiments.ts
 *
 * All tests are pure / offline:
 *   - No network calls (fetchExperiments is always a fake)
 *   - No Astro mocks
 *   - Random source is always injected for determinism
 */
import { describe, it, expect } from 'vitest';
import {
	findExperimentForSlug,
	mappedSlugFor,
	pickVariant,
	resolveVariant,
	resolveExperimentForRequest,
	type Experiment,
	type Variant,
} from './experiments';

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

function makeExperiment(overrides: Partial<Experiment> = {}): Experiment {
	return {
		id: 1,
		name: 'test-experiment',
		display_name: 'Test Experiment',
		story_ids: [100],
		variants: [],
		...overrides,
	};
}

function makeMapping(
	originalSlug: string,
	variantSlug: string,
	originalStoryId = 100,
	variantStoryId = 200,
) {
	return {
		original_story_id: originalStoryId,
		original_slug: originalSlug,
		variant_story_id: variantStoryId,
		variant_slug: variantSlug,
	};
}

// ---------------------------------------------------------------------------
// pickVariant
// ---------------------------------------------------------------------------

describe('pickVariant', () => {
	it('returns the only variant when there is exactly one', () => {
		const v = makeVariant({ weight: 100 });
		expect(pickVariant([v])).toBe(v);
	});

	it('always returns the variant whose cumulative band the roll falls in', () => {
		const control = makeVariant({ name: 'control', weight: 50 });
		const variantA = makeVariant({ name: 'variant_a', weight: 50 });

		// roll=0.0 → cumulative after control = 50, 0 * 100 = 0 < 50 → control
		expect(pickVariant([control, variantA], () => 0)).toBe(control);

		// roll=0.499 → 0.499 * 100 = 49.9 < 50 → control
		expect(pickVariant([control, variantA], () => 0.499)).toBe(control);

		// roll=0.5 → 0.5 * 100 = 50 — first band is [0, 50), so 50 is NOT < 50 → variantA
		expect(pickVariant([control, variantA], () => 0.5)).toBe(variantA);

		// roll=0.999 → 99.9 ≥ 50 → variantA
		expect(pickVariant([control, variantA], () => 0.999)).toBe(variantA);
	});

	it('honours unequal weights (25/75 split)', () => {
		const light = makeVariant({ name: 'light', weight: 25 });
		const heavy = makeVariant({ name: 'heavy', weight: 75 });

		// roll=0.24 → 24 < 25 → light
		expect(pickVariant([light, heavy], () => 0.24)).toBe(light);

		// roll=0.25 → 25 is not < 25 → heavy
		expect(pickVariant([light, heavy], () => 0.25)).toBe(heavy);

		// roll=0.99 → 99 < 100 (cumulative 25+75) → heavy
		expect(pickVariant([light, heavy], () => 0.99)).toBe(heavy);
	});

	it('handles three variants with distinct weight bands', () => {
		const a = makeVariant({ name: 'a', weight: 20 });
		const b = makeVariant({ name: 'b', weight: 30 });
		const c = makeVariant({ name: 'c', weight: 50 });

		// total = 100
		// a band: [0, 20)
		// b band: [20, 50)
		// c band: [50, 100)

		expect(pickVariant([a, b, c], () => 0)).toBe(a);       // 0 < 20
		expect(pickVariant([a, b, c], () => 0.19)).toBe(a);    // 19 < 20
		expect(pickVariant([a, b, c], () => 0.2)).toBe(b);     // 20 not < 20, next: 20 < 50
		expect(pickVariant([a, b, c], () => 0.49)).toBe(b);    // 49 < 50
		expect(pickVariant([a, b, c], () => 0.5)).toBe(c);     // 50 not < 50, next: 50 < 100
		expect(pickVariant([a, b, c], () => 0.9999)).toBe(c);  // 99.99 < 100
	});

	it('falls back gracefully when all weights are zero', () => {
		const a = makeVariant({ name: 'a', weight: 0 });
		const b = makeVariant({ name: 'b', weight: 0 });
		// total = 0, uses uniform fallback
		const result = pickVariant([a, b], () => 0);
		expect([a, b]).toContain(result);
	});
});

// ---------------------------------------------------------------------------
// resolveVariant
// ---------------------------------------------------------------------------

describe('resolveVariant', () => {
	const control = makeVariant({
		name: 'control',
		public_id: 'pub-ctrl',
		weight: 50,
	});
	const variantA = makeVariant({
		name: 'variant_a',
		public_id: 'pub-var-a',
		weight: 50,
		is_control: false,
	});
	const experiment = makeExperiment({ variants: [control, variantA] });

	it('reuses a valid cookie variant without re-persisting', () => {
		const result = resolveVariant({
			experiment,
			cookiePublicId: 'pub-ctrl',
		});
		expect(result.variant).toBe(control);
		expect(result.persist).toBe(false);
	});

	it('reuses the non-control cookie variant without re-persisting', () => {
		const result = resolveVariant({
			experiment,
			cookiePublicId: 'pub-var-a',
		});
		expect(result.variant).toBe(variantA);
		expect(result.persist).toBe(false);
	});

	it('triggers a fresh weighted pick when cookie is absent', () => {
		const result = resolveVariant({
			experiment,
			cookiePublicId: undefined,
			random: () => 0, // deterministic → first variant
		});
		expect(result.variant).toBe(control);
		expect(result.persist).toBe(true);
	});

	it('treats a stale/unknown cookie public_id as absent and picks afresh', () => {
		const result = resolveVariant({
			experiment,
			cookiePublicId: 'stale-id-that-does-not-exist',
			random: () => 0,
		});
		expect(result.variant).toBe(control);
		expect(result.persist).toBe(true);
	});

	it('freshly picked variant sets persist = true', () => {
		const result = resolveVariant({
			experiment,
			cookiePublicId: null,
			random: () => 0.999,
		});
		expect(result.persist).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// findExperimentForSlug
// ---------------------------------------------------------------------------

describe('findExperimentForSlug', () => {
	const expWithSlug = makeExperiment({
		id: 10,
		variants: [
			makeVariant({
				story_mappings: [
					makeMapping('home', 'home-v2'),
					makeMapping('about', 'about-v2'),
				],
			}),
		],
	});

	const otherExp = makeExperiment({
		id: 20,
		variants: [
			makeVariant({
				story_mappings: [makeMapping('pricing', 'pricing-b')],
			}),
		],
	});

	it('returns the matching experiment for a known original_slug', () => {
		expect(findExperimentForSlug([expWithSlug, otherExp], 'home')).toBe(
			expWithSlug,
		);
	});

	it('matches on the second slug in the variant story_mappings', () => {
		expect(findExperimentForSlug([expWithSlug, otherExp], 'about')).toBe(
			expWithSlug,
		);
	});

	it('matches the correct experiment when multiple experiments are present', () => {
		expect(findExperimentForSlug([expWithSlug, otherExp], 'pricing')).toBe(
			otherExp,
		);
	});

	it('returns null when no experiment matches the slug', () => {
		expect(findExperimentForSlug([expWithSlug, otherExp], 'contact')).toBeNull();
	});

	it('returns null for an empty experiments array', () => {
		expect(findExperimentForSlug([], 'home')).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// mappedSlugFor
// ---------------------------------------------------------------------------

describe('mappedSlugFor', () => {
	const variant = makeVariant({
		story_mappings: [
			makeMapping('home', 'home-v2'),
			makeMapping('about', 'about-variant'),
		],
	});

	it('returns the variant_slug for a known original_slug', () => {
		expect(mappedSlugFor(variant, 'home')).toBe('home-v2');
	});

	it('returns the variant_slug for a second mapping', () => {
		expect(mappedSlugFor(variant, 'about')).toBe('about-variant');
	});

	it('returns the original slug when there is no matching mapping', () => {
		expect(mappedSlugFor(variant, 'contact')).toBe('contact');
	});

	it('returns the original slug for a variant with no story_mappings', () => {
		const emptyVariant = makeVariant({ story_mappings: [] });
		expect(mappedSlugFor(emptyVariant, 'home')).toBe('home');
	});
});

// ---------------------------------------------------------------------------
// resolveExperimentForRequest (integration of the async orchestrator)
// ---------------------------------------------------------------------------

describe('resolveExperimentForRequest', () => {
	const controlVariant = makeVariant({
		name: 'control',
		public_id: 'pub-ctrl',
		weight: 100,
		story_mappings: [makeMapping('home', 'home-control')],
	});
	const variantAVariant = makeVariant({
		name: 'variant_a',
		public_id: 'pub-var-a',
		weight: 0,
		is_control: false,
		story_mappings: [makeMapping('home', 'home-variant-a')],
	});

	const experiment = makeExperiment({
		id: 99,
		variants: [controlVariant, variantAVariant],
	});

	const fakeFetch = async (): Promise<Experiment[]> => [experiment];

	it('resolves to the original slug when no experiment matches', async () => {
		const result = await resolveExperimentForRequest({
			slug: 'no-match',
			fetchExperiments: fakeFetch,
		});
		expect(result.storySlug).toBe('no-match');
		expect(result.experiment).toBeNull();
		expect(result.variant).toBeNull();
		expect(result.persist).toBe(false);
	});

	it('resolves to the mapped slug when an experiment matches', async () => {
		const result = await resolveExperimentForRequest({
			slug: 'home',
			fetchExperiments: fakeFetch,
			random: () => 0, // picks controlVariant (weight 100)
		});
		expect(result.storySlug).toBe('home-control');
		expect(result.experiment).toBe(experiment);
		expect(result.variant).toBe(controlVariant);
		expect(result.persist).toBe(true);
	});

	it('reuses a valid cookie variant and does not re-persist', async () => {
		const result = await resolveExperimentForRequest({
			slug: 'home',
			cookiePublicId: 'pub-var-a',
			fetchExperiments: fakeFetch,
		});
		expect(result.variant).toBe(variantAVariant);
		expect(result.storySlug).toBe('home-variant-a');
		expect(result.persist).toBe(false);
	});

	it('fails open (returns original slug) when fetchExperiments throws', async () => {
		const result = await resolveExperimentForRequest({
			slug: 'home',
			fetchExperiments: async () => {
				throw new Error('network error');
			},
		});
		expect(result.storySlug).toBe('home');
		expect(result.experiment).toBeNull();
		expect(result.persist).toBe(false);
	});
});
