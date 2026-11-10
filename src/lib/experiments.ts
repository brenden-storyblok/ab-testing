import type { AstroCookies } from 'astro';
import type { Adapter, Experiment, Experiments } from '@storyblok/experiments';
import { createExperiments } from '@storyblok/experiments';
import { createManagementApiClient } from "@storyblok/management-api-client";
import { apiClient } from '../storyblok';


const managmentClient = createManagementApiClient({
	personalAccessToken: import.meta.env.STORYBLOK_MANAGEMENT_TOKEN,
	spaceId: import.meta.env.STORYBLOK_SPACE_ID,
	region: import.meta.env.STORYBLOK_REGION,
});

export const VISITOR_ID_COOKIE = 'sb_visitor_id';

export function readOrMintVisitorId(cookies: AstroCookies): string {
	const existing = cookies.get(VISITOR_ID_COOKIE)?.value;
	if (existing) {
		return existing;
	}

	const visitorId = crypto.randomUUID();
	cookies.set(VISITOR_ID_COOKIE, visitorId, {
		path: '/',
		maxAge: 60 * 60 * 24 * 365,
		sameSite: 'lax',
		httpOnly: true,
		secure: true,
	});

	return visitorId;
}

export async function getRunningExperiments(): Promise<Experiment[]> {
	const { data } = await apiClient.experiments.list();
	return data?.experiments ?? [];
}

// ---------------------------------------------------------------------------
// The experiments client
//
// The factory holds no per-visitor state, so one instance is shared across
// requests instead of built per render. That is what lets the API route below
// record a conversion for a click that arrives long after the render is gone.
//
// The running experiments are cached with a short TTL because the payload is
// the only thing the instance binds, and refetching it per request would cost a
// CAPI call on every page view.
// ---------------------------------------------------------------------------

const EXPERIMENTS_TTL = 60_000;

let cache: { at: number; pending: Promise<Experiments> } | undefined;

/**
 * The sink. A plain function rather than `fetchAdapter`, since posting to our
 * own `/api/experiments` would cost a second serverless invocation per event.
 *
 * Both event types arrive here: the exposure from the page render, the
 * conversion from the API route. Deduplication happens at the call sites, which
 * hold the visitor's cookies; a bar chart has no visitor dimension to dedupe on.
 */
const chartAdapter: Adapter = async (event) => {
	if (event.type === 'exposure') {
		await recordImpression(event.experiment.id, event.variant.name);
		return;
	}
	await recordConversion(event.experiment.id, event.variant.name);
};

export function getExperimentsClient(): Promise<Experiments> {
	if (cache && Date.now() - cache.at < EXPERIMENTS_TTL) {
		return cache.pending;
	}

	const pending = getRunningExperiments().then((experiments) =>
		createExperiments({
			experiments,
			adapters: [chartAdapter],
			onError: (error, event) =>
				console.error(`[experiments] delivery failed for ${event.type}`, error),
		}),
	);

	cache = { at: Date.now(), pending };
	return pending;
}

export async function getExperimentCharts(experimentId: number): Promise<ResultsChart[]> {
	const { data } = await managmentClient.experiments.results.get(experimentId);
	return data?.experiment_result?.charts ?? [];
}

// ---------------------------------------------------------------------------
// Results charts
//
// Experiments has no event ingestion, so the pushed chart snapshot doubles as
// the tally. Each event reads the snapshot, bumps one bar, and pushes it back.
// The read-modify-write is racy and every event costs two management API calls.
// A push replaces the snapshot, so these two charts are all an experiment keeps.
// ---------------------------------------------------------------------------

type ResultsChart = Parameters<
	typeof managmentClient.experiments.results.push
>[1]['body']['charts'][number];

const RATE_CHART_TITLE = 'Conversion rate by variant';
const COUNTS_CHART_TITLE = 'Impressions & conversions by variant';

function seriesData(chart: ResultsChart | undefined, seriesLabel: string): number[] {
	return [...(chart?.series?.find((series) => series.label === seriesLabel)?.data ?? [])];
}

async function recordEvent(
	experimentId: number,
	variantLabel: string,
	metric: 'Impressions' | 'Conversions',
): Promise<void> {
	try {
		const charts = await getExperimentCharts(experimentId);
		const countsChart = charts.find((chart) => chart.title === COUNTS_CHART_TITLE);

		const labels = [...(countsChart?.labels ?? [])];
		const tallies = {
			Impressions: seriesData(countsChart, 'Impressions'),
			Conversions: seriesData(countsChart, 'Conversions'),
		};

		let variantIndex = labels.indexOf(variantLabel);
		if (variantIndex === -1) {
			variantIndex = labels.push(variantLabel) - 1;
			tallies.Impressions.push(0);
			tallies.Conversions.push(0);
		}
		tallies[metric][variantIndex] += 1;

		const rates = tallies.Impressions.map((impressionCount, index) =>
			impressionCount === 0
				? 0
				: Math.round((tallies.Conversions[index] / impressionCount) * 10000) / 10000,
		);

		await managmentClient.experiments.results.push(experimentId, {
			body: {
				charts: [
					{
						kind: 'bar',
						title: RATE_CHART_TITLE,
						labels,
						series: [{ label: 'Conversion rate', data: rates }],
						xLabel: 'Variant',
						yLabel: 'Conversion rate',
					},
					{
						kind: 'bar',
						title: COUNTS_CHART_TITLE,
						labels,
						series: [
							{ label: 'Impressions', data: tallies.Impressions },
							{ label: 'Conversions', data: tallies.Conversions },
						],
						xLabel: 'Variant',
						yLabel: 'Count',
					},
				],
			},
		});
	} catch (error) {
		console.error(
			`[experiments] Failed to record ${metric} for experiment ${experimentId}, variant ${variantLabel}.`,
			error,
		);
	}
}

/** A visitor counts once per experiment per month, for both metrics. */
const SEEN_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

/**
 * Marks the visitor as counted for one experiment and one metric, and reports
 * whether they already were. Both bars have to count visitors the same way, or
 * the conversion rate compares per-visitor conversions against per-view
 * impressions and reads far too low.
 */
export function countOnce(
	cookies: AstroCookies,
	metric: 'exp' | 'conv',
	experimentId: number,
): boolean {
	const name = `sb_${metric}_${experimentId}`;
	if (cookies.has(name)) {
		return false;
	}
	// Set before recording, so a failed write cannot let the visitor count twice.
	cookies.set(name, '1', {
		httpOnly: true,
		sameSite: 'lax',
		path: '/',
		maxAge: SEEN_COOKIE_MAX_AGE,
	});
	return true;
}

/**
 * Count one exposure. Callers gate on `countOnce`, so this counts visitors.
 *
 * `variantLabel` labels the bar and identifies the variant across events: pass
 * `display_name`, or `name` when the caller only holds the event payload.
 * Renaming a variant starts a fresh bar. Bars sit in first-seen order, since
 * the events carry no `is_control` to pin the control to the front.
 *
 * Logs and swallows management API errors.
 */
export async function recordImpression(
	experimentId: number,
	variantLabel: string,
): Promise<void> {
	await recordEvent(experimentId, variantLabel, 'Impressions');
}

/**
 * Count one conversion. See recordImpression for `variantLabel`.
 * The caller dedupes: `src/pages/api/experiments.ts` calls `countOnce` first.
 */
export async function recordConversion(
	experimentId: number,
	variantLabel: string,
): Promise<void> {
	await recordEvent(experimentId, variantLabel, 'Conversions');
}