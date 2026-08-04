import type { APIRoute } from 'astro';
import type { ExperimentEvent } from '@storyblok/experiments';
import { recordConversion, recordImpression } from '../../lib/experiments';

/** A visitor converts at most once per experiment per month. */
const CONVERSION_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

export const POST: APIRoute = async ({ request, cookies }) => {
	const event = (await request.json()) as ExperimentEvent;
	console.log('event', event);
	const experimentId = event.experiment?.id;
	// Exposures come from the library adapter, which carries the technical name
	// and public_id only, so both event types label bars with the technical name.
	const variantLabel = event.variant?.name;

	if (!experimentId || !variantLabel) {
		return Response.json({ status: 'ignored' }, { status: 400 });
	}

	if (event.type === 'exposure') {
		await recordImpression(experimentId, variantLabel);
		return Response.json({ status: 'ok' });
	}

	if (event.type === 'conversion') {
		const cookieName = `sb_conv_${experimentId}`;
		if (cookies.has(cookieName)) {
			console.log('already_converted');
			return Response.json({ status: 'already_converted' });
		}

		// Set before recording so a failed write cannot let the visitor
		// convert twice.
		cookies.set(cookieName, '1', {
			httpOnly: true,
			sameSite: 'lax',
			path: '/',
			maxAge: CONVERSION_COOKIE_MAX_AGE,
		});
		await recordConversion(experimentId, variantLabel);
		return Response.json({ status: 'ok' });
	}

	return Response.json({ status: 'ignored' }, { status: 400 });
};
