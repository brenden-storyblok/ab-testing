import type { AstroCookies } from 'astro';
import type { Experiment } from '@storyblok/experiments';
import type { useStoryblokApi } from '@storyblok/astro';

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
