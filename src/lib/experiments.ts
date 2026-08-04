import type { AstroCookies } from 'astro';
import type { Experiment } from '@storyblok/experiments';
import type { useStoryblokApi } from '@storyblok/astro';
import { createManagementApiClient } from "@storyblok/management-api-client";


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

export async function getRunningExperiments(
	storyblokApi: ReturnType<typeof useStoryblokApi>,
): Promise<Experiment[]> {
	const { data } = await storyblokApi.get('cdn/experiments');
	return data.experiments ?? [];
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

/**
 * Count one exposure. Every render fires one, so this counts views, not visitors.
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
 * The caller dedupes: `src/pages/api/experiments.ts` checks the visitor's
 * conversion cookie before calling this.
 */
export async function recordConversion(
	experimentId: number,
	variantLabel: string,
): Promise<void> {
	await recordEvent(experimentId, variantLabel, 'Conversions');
}