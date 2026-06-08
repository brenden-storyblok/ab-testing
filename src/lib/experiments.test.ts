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
	experimentDataAttributes,
	httpStatusFromError,
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

	// --- forcedVariantName (issue #9) ---

	it('returns the forced variant with persist:false when forcedVariantName matches by technical name', () => {
		const result = resolveVariant({
			experiment,
			forcedVariantName: 'variant_a',
		});
		expect(result.variant).toBe(variantA);
		expect(result.persist).toBe(false);
	});

	it('forced override takes precedence over a valid cookie', () => {
		// Cookie points to control, but override forces variant_a.
		const result = resolveVariant({
			experiment,
			cookiePublicId: 'pub-ctrl',
			forcedVariantName: 'variant_a',
		});
		expect(result.variant).toBe(variantA);
		expect(result.persist).toBe(false);
	});

	it('forced override of the control variant returns it with persist:false', () => {
		const result = resolveVariant({
			experiment,
			forcedVariantName: 'control',
		});
		expect(result.variant).toBe(control);
		expect(result.persist).toBe(false);
	});

	it('forcedVariantName "reset" ignores the cookie and shows control, clearing the assignment', () => {
		// Reset must NOT reuse the cookie and must NOT re-randomise — it always
		// shows the control variant for this view (persist:false) and signals
		// clearCookie so the caller deletes the cookie, leaving the visitor unassigned.
		const result = resolveVariant({
			experiment,
			cookiePublicId: 'pub-var-a', // would normally be reused
			forcedVariantName: 'reset',
			random: () => 0.999, // a weighted pick would land on variant_a — reset ignores this
		});
		expect(result.variant).toBe(control); // always control, never the cookie or a fresh pick
		expect(result.variant.is_control).toBe(true);
		expect(result.persist).toBe(false);
		expect(result.clearCookie).toBe(true);
	});

	it('forcedVariantName "reset" shows control even when no cookie is present', () => {
		const result = resolveVariant({
			experiment,
			forcedVariantName: 'reset',
			random: () => 0.999, // ignored — reset does not re-randomise
		});
		expect(result.variant).toBe(control);
		expect(result.clearCookie).toBe(true);
		expect(result.persist).toBe(false);
	});

	it('an unknown forcedVariantName falls through to cookie/pick without clearing', () => {
		// Unknown name — must not throw, must fall through to the cookie, and must
		// NOT clear (clearing is reserved for the explicit "reset" keyword).
		const result = resolveVariant({
			experiment,
			cookiePublicId: 'pub-var-a',
			forcedVariantName: 'nonexistent_variant',
		});
		expect(result.variant).toBe(variantA);
		expect(result.persist).toBe(false); // came from cookie
		expect(result.clearCookie).toBe(false);
	});

	it('an unknown forcedVariantName with no cookie falls through to weighted pick', () => {
		const result = resolveVariant({
			experiment,
			cookiePublicId: null,
			forcedVariantName: 'nonexistent_variant',
			random: () => 0, // deterministic → control
		});
		expect(result.variant).toBe(control);
		expect(result.persist).toBe(true); // fresh pick
		expect(result.clearCookie).toBe(false);
	});

	it('a named override and a cookie reuse never set clearCookie', () => {
		const forcedResult = resolveVariant({
			experiment,
			forcedVariantName: 'variant_a',
		});
		expect(forcedResult.clearCookie).toBe(false);

		const cookieResult = resolveVariant({
			experiment,
			cookiePublicId: 'pub-ctrl',
		});
		expect(cookieResult.clearCookie).toBe(false);
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

	// --- forcedVariantName threading (issue #9) ---

	it('forcing the control variant yields no variantStorySlug and persist:false', () => {
		const result = resolveExperiment({
			story: homeStory,
			experiments: [experiment],
			forcedVariantName: 'control',
		});
		expect(result.variant).toBe(controlVariant);
		expect(result.variantStorySlug).toBeNull();
		expect(result.persist).toBe(false);
		expect(result.experiment).toBe(experiment);
	});

	it('forcing a non-control variant yields its mapped variantStorySlug and persist:false', () => {
		const result = resolveExperiment({
			story: homeStory,
			experiments: [experiment],
			forcedVariantName: 'variant_a',
		});
		expect(result.variant).toBe(treatmentVariant);
		expect(result.variantStorySlug).toBe('home--test--variant-a');
		expect(result.persist).toBe(false);
	});

	it('forcing a non-control variant overrides a cookie pointing to the control', () => {
		// Cookie says control, but forcedVariantName says variant_a.
		const result = resolveExperiment({
			story: homeStory,
			experiments: [experiment],
			readCookie: () => 'pub-ctrl',
			forcedVariantName: 'variant_a',
		});
		expect(result.variant).toBe(treatmentVariant);
		expect(result.variantStorySlug).toBe('home--test--variant-a');
		expect(result.persist).toBe(false);
	});

	it('forcedVariantName "reset" ignores the cookie, shows control, and signals clearCookie', () => {
		const result = resolveExperiment({
			story: homeStory,
			experiments: [experiment],
			readCookie: () => 'pub-var-a', // cookie points at the treatment variant
			forcedVariantName: 'reset',
			random: () => 0.999, // ignored — reset does not re-randomise
		});
		// Reset ignores the cookie's treatment assignment, shows the control
		// variant this view (→ original story), persists nothing, and asks the
		// caller to clear the stickiness cookie.
		expect(result.variant).toBe(controlVariant);
		expect(result.variant?.is_control).toBe(true);
		expect(result.variantStorySlug).toBeNull(); // control → original story
		expect(result.persist).toBe(false);
		expect(result.clearCookie).toBe(true);
	});

	it('non-reset resolutions never set clearCookie in the orchestrator', () => {
		const cookieResult = resolveExperiment({
			story: homeStory,
			experiments: [experiment],
			readCookie: () => 'pub-ctrl',
		});
		expect(cookieResult.clearCookie).toBe(false);

		const freshPickResult = resolveExperiment({
			story: homeStory,
			experiments: [experiment],
			readCookie: () => undefined,
			random: () => 0,
		});
		expect(freshPickResult.clearCookie).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Fail-open hardening (issue #8)
//
// The Astro route wraps the cdn/experiments fetch in a try/catch and passes an
// empty array to resolveExperiment on any error. These tests document the
// contract: an empty experiments list → no match → no cookie written (persist
// false) → original story rendered unchanged.
//
// The variant-story fetch fallback (also #8) lives at the route boundary (an
// async try/catch around storyblokApi.get) and is not unit-testable without
// Astro. Its behaviour: on catch, the original story already in memory is
// rendered and the stickiness cookie is PRESERVED (a transient failure must
// not reset the assignment). The error is inspected via httpStatusFromError so
// a 404 (missing/unpublished variant story) is logged as a warning while other
// failures are logged as errors. httpStatusFromError itself is unit-tested below.
// ---------------------------------------------------------------------------

describe('resolveExperiment — fail-open: empty experiments list (cdn/experiments error path)', () => {
	const homeStory = { id: 100, full_slug: 'home' };

	it('returns no experiment and no variant when the experiments list is empty', () => {
		const result = resolveExperiment({
			story: homeStory,
			experiments: [],
		});
		expect(result.experiment).toBeNull();
		expect(result.variant).toBeNull();
	});

	it('returns persist:false when the experiments list is empty, so no cookie is written', () => {
		const result = resolveExperiment({
			story: homeStory,
			experiments: [],
		});
		expect(result.persist).toBe(false);
	});

	it('returns variantStorySlug:null when the experiments list is empty, so the original story is rendered', () => {
		const result = resolveExperiment({
			story: homeStory,
			experiments: [],
		});
		expect(result.variantStorySlug).toBeNull();
	});

	it('does not invoke the cookie reader when the experiments list is empty', () => {
		let readerCallCount = 0;
		resolveExperiment({
			story: homeStory,
			experiments: [],
			readCookie: () => {
				readerCallCount += 1;
				return undefined;
			},
		});
		expect(readerCallCount).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// experimentDataAttributes (issue #10)
//
// Pure helper — returns the data-sb-* attributes for the DOM when an experiment
// is active, or an empty object (no-op spread) on non-experiment pages.
// ---------------------------------------------------------------------------

describe('experimentDataAttributes', () => {
	const controlVariant = makeVariant({
		name: 'control',
		public_id: 'pub-ctrl',
		is_control: true,
	});
	const treatmentVariant = makeVariant({
		name: 'variant_a',
		public_id: 'pub-var-a',
		is_control: false,
	});
	const experiment = makeExperiment({
		id: 42,
		variants: [controlVariant, treatmentVariant],
	});

	it('returns the correct attributes when both experiment and variant are present', () => {
		const attributes = experimentDataAttributes(experiment, controlVariant);
		expect(attributes).toEqual({
			'data-sb-experiment': '42',
			'data-sb-variant': 'pub-ctrl',
		});
	});

	it('uses the experiment numeric id (not name) as the attribute value', () => {
		const attributes = experimentDataAttributes(experiment, controlVariant);
		expect(attributes['data-sb-experiment']).toBe('42');
		expect(attributes['data-sb-experiment']).not.toBe('test-experiment');
	});

	it('uses the variant public_id as the attribute value', () => {
		const attributes = experimentDataAttributes(experiment, treatmentVariant);
		expect(attributes['data-sb-variant']).toBe('pub-var-a');
	});

	it('returns an empty object when experiment is null', () => {
		const attributes = experimentDataAttributes(null, controlVariant);
		expect(attributes).toEqual({});
	});

	it('returns an empty object when variant is null', () => {
		const attributes = experimentDataAttributes(experiment, null);
		expect(attributes).toEqual({});
	});

	it('returns an empty object when both arguments are null', () => {
		const attributes = experimentDataAttributes(null, null);
		expect(attributes).toEqual({});
	});

	it('returns an empty object when experiment is undefined', () => {
		const attributes = experimentDataAttributes(undefined, controlVariant);
		expect(attributes).toEqual({});
	});

	it('returns an empty object when variant is undefined', () => {
		const attributes = experimentDataAttributes(experiment, undefined);
		expect(attributes).toEqual({});
	});

	it('returns a plain object with exactly two keys on an experiment page', () => {
		const attributes = experimentDataAttributes(experiment, controlVariant);
		expect(Object.keys(attributes)).toHaveLength(2);
		expect(Object.keys(attributes)).toContain('data-sb-experiment');
		expect(Object.keys(attributes)).toContain('data-sb-variant');
	});

	it('serialises the experiment id as a string even though the domain type is number', () => {
		const numericIdExperiment = makeExperiment({ id: 99 });
		const attributes = experimentDataAttributes(numericIdExperiment, controlVariant);
		expect(typeof attributes['data-sb-experiment']).toBe('string');
		expect(attributes['data-sb-experiment']).toBe('99');
	});
});

// ---------------------------------------------------------------------------
// httpStatusFromError — used by the route to distinguish a missing variant
// story (404) from other variant-fetch failures when deciding the log level.
// ---------------------------------------------------------------------------

describe('httpStatusFromError', () => {
	it('reads a top-level numeric status (storyblok-js-client reject shape)', () => {
		const storyblokError = {
			message: 'Not Found',
			status: 404,
			response: { status: 404 },
		};
		expect(httpStatusFromError(storyblokError)).toBe(404);
	});

	it('reads a non-404 status such as 500', () => {
		expect(httpStatusFromError({ status: 500 })).toBe(500);
	});

	it('falls back to response.status when no top-level status is present', () => {
		expect(httpStatusFromError({ response: { status: 403 } })).toBe(403);
	});

	it('returns null for a plain Error with no HTTP status (network failure)', () => {
		expect(httpStatusFromError(new Error('network down'))).toBeNull();
	});

	it('returns null for null / undefined / non-objects', () => {
		expect(httpStatusFromError(null)).toBeNull();
		expect(httpStatusFromError(undefined)).toBeNull();
		expect(httpStatusFromError('404')).toBeNull();
	});
});
