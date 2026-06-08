/**
 * Unit tests for src/lib/experiments.ts
 *
 * All tests are pure / offline:
 *   - No network calls (experiments are passed in directly)
 *   - No Astro mocks (the cookie reader is a plain injected function)
 *   - Random source is always injected for determinism
 */
import { describe, it, expect } from 'vitest';
import {
	findExperimentForStory,
	variantSlugFor,
	pickVariant,
	resolveVariant,
	resolveExperiment,
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
		const onlyVariant = makeVariant({ weight: 100 });
		expect(pickVariant([onlyVariant])).toBe(onlyVariant);
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
		const lightVariant = makeVariant({ name: 'light', weight: 25 });
		const heavyVariant = makeVariant({ name: 'heavy', weight: 75 });

		// roll=0.24 → 24 < 25 → light
		expect(pickVariant([lightVariant, heavyVariant], () => 0.24)).toBe(
			lightVariant,
		);

		// roll=0.25 → 25 is not < 25 → heavy
		expect(pickVariant([lightVariant, heavyVariant], () => 0.25)).toBe(
			heavyVariant,
		);

		// roll=0.99 → 99 < 100 (cumulative 25+75) → heavy
		expect(pickVariant([lightVariant, heavyVariant], () => 0.99)).toBe(
			heavyVariant,
		);
	});

	it('handles three variants with distinct weight bands', () => {
		const firstVariant = makeVariant({ name: 'a', weight: 20 });
		const secondVariant = makeVariant({ name: 'b', weight: 30 });
		const thirdVariant = makeVariant({ name: 'c', weight: 50 });
		const variants = [firstVariant, secondVariant, thirdVariant];

		// total = 100
		// firstVariant band:  [0, 20)
		// secondVariant band: [20, 50)
		// thirdVariant band:  [50, 100)

		expect(pickVariant(variants, () => 0)).toBe(firstVariant); // 0 < 20
		expect(pickVariant(variants, () => 0.19)).toBe(firstVariant); // 19 < 20
		expect(pickVariant(variants, () => 0.2)).toBe(secondVariant); // 20 not < 20, next: 20 < 50
		expect(pickVariant(variants, () => 0.49)).toBe(secondVariant); // 49 < 50
		expect(pickVariant(variants, () => 0.5)).toBe(thirdVariant); // 50 not < 50, next: 50 < 100
		expect(pickVariant(variants, () => 0.9999)).toBe(thirdVariant); // 99.99 < 100
	});

	it('falls back gracefully when all weights are zero', () => {
		const firstVariant = makeVariant({ name: 'a', weight: 0 });
		const secondVariant = makeVariant({ name: 'b', weight: 0 });
		// total = 0, uses uniform fallback
		const chosenVariant = pickVariant([firstVariant, secondVariant], () => 0);
		expect([firstVariant, secondVariant]).toContain(chosenVariant);
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
// findExperimentForStory
// ---------------------------------------------------------------------------

describe('findExperimentForStory', () => {
	const homeExperiment = makeExperiment({ id: 10, story_ids: [100, 101] });
	const pricingExperiment = makeExperiment({ id: 20, story_ids: [200] });

	it('returns the experiment whose story_ids include the story id', () => {
		expect(
			findExperimentForStory([homeExperiment, pricingExperiment], 100),
		).toBe(homeExperiment);
	});

	it('matches against any id in the story_ids array, not just the first', () => {
		expect(
			findExperimentForStory([homeExperiment, pricingExperiment], 101),
		).toBe(homeExperiment);
	});

	it('selects the correct experiment when multiple experiments are present', () => {
		expect(
			findExperimentForStory([homeExperiment, pricingExperiment], 200),
		).toBe(pricingExperiment);
	});

	it('returns null when no experiment includes the story id', () => {
		expect(
			findExperimentForStory([homeExperiment, pricingExperiment], 999),
		).toBeNull();
	});

	it('returns null for an empty experiments array', () => {
		expect(findExperimentForStory([], 100)).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// variantSlugFor
// ---------------------------------------------------------------------------

describe('variantSlugFor', () => {
	const nonControlVariant = makeVariant({
		name: 'variant_a',
		is_control: false,
		story_mappings: [
			makeMapping('home', 'home--test--variant-a'),
			makeMapping('blog/post', 'blog/post--test--variant-a'),
		],
	});

	it('returns the variant_slug for a matching full_slug', () => {
		expect(variantSlugFor(nonControlVariant, 'home')).toBe(
			'home--test--variant-a',
		);
	});

	it('matches a nested (foldered) full_slug', () => {
		expect(variantSlugFor(nonControlVariant, 'blog/post')).toBe(
			'blog/post--test--variant-a',
		);
	});

	it('returns null when no mapping matches the full_slug', () => {
		expect(variantSlugFor(nonControlVariant, 'contact')).toBeNull();
	});

	it('returns null for the control variant (renders the original story)', () => {
		const controlVariant = makeVariant({ is_control: true, story_mappings: [] });
		expect(variantSlugFor(controlVariant, 'home')).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// resolveExperiment (the deep, pure orchestrator)
// ---------------------------------------------------------------------------

describe('resolveExperiment', () => {
	const controlVariant = makeVariant({
		name: 'control',
		public_id: 'pub-ctrl',
		weight: 100,
		is_control: true,
		story_mappings: [],
	});
	const treatmentVariant = makeVariant({
		name: 'variant_a',
		public_id: 'pub-var-a',
		weight: 0,
		is_control: false,
		story_mappings: [makeMapping('home', 'home--test--variant-a')],
	});

	const experiment = makeExperiment({
		id: 99,
		story_ids: [100],
		variants: [controlVariant, treatmentVariant],
	});

	const homeStory = { id: 100, full_slug: 'home' };

	it('returns nulls and no remap when the story is in no experiment', () => {
		const result = resolveExperiment({
			story: { id: 555, full_slug: 'unrelated' },
			experiments: [experiment],
		});
		expect(result.experiment).toBeNull();
		expect(result.variant).toBeNull();
		expect(result.persist).toBe(false);
		expect(result.variantStorySlug).toBeNull();
	});

	it('picks the control variant and renders the original story (no remap)', () => {
		const result = resolveExperiment({
			story: homeStory,
			experiments: [experiment],
			random: () => 0, // weight 100 control → control
		});
		expect(result.experiment).toBe(experiment);
		expect(result.variant).toBe(controlVariant);
		expect(result.variantStorySlug).toBeNull();
		expect(result.persist).toBe(true);
	});

	it('remaps to the variant story slug when a non-control variant wins', () => {
		const result = resolveExperiment({
			story: homeStory,
			experiments: [experiment],
			random: () => 0.999, // pushes the roll toward the second variant
			// Force the treatment to win by giving it the only weight.
			readCookie: () => 'pub-var-a',
		});
		expect(result.variant).toBe(treatmentVariant);
		expect(result.variantStorySlug).toBe('home--test--variant-a');
		expect(result.persist).toBe(false);
	});

	it('reads the stickiness cookie via the injected reader, keyed by experiment id', () => {
		const seenExperimentIds: number[] = [];
		const result = resolveExperiment({
			story: homeStory,
			experiments: [experiment],
			readCookie: (experimentId) => {
				seenExperimentIds.push(experimentId);
				return 'pub-var-a';
			},
		});
		expect(seenExperimentIds).toEqual([99]);
		expect(result.variant).toBe(treatmentVariant);
		expect(result.persist).toBe(false);
	});

	it('does not call the cookie reader when no experiment matches', () => {
		let readerCalled = false;
		resolveExperiment({
			story: { id: 555, full_slug: 'unrelated' },
			experiments: [experiment],
			readCookie: () => {
				readerCalled = true;
				return undefined;
			},
		});
		expect(readerCalled).toBe(false);
	});

	it('makes a fresh weighted pick and flags persist when the cookie is absent', () => {
		const result = resolveExperiment({
			story: homeStory,
			experiments: [experiment],
			readCookie: () => undefined,
			random: () => 0, // control wins (weight 100)
		});
		expect(result.variant).toBe(controlVariant);
		expect(result.persist).toBe(true);
		expect(result.variantStorySlug).toBeNull();
	});
});
