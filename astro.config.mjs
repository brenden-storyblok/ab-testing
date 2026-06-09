import { defineConfig } from 'astro/config';
import { storyblok } from '@storyblok/astro';
import { loadEnv } from 'vite';
import mkcert from 'vite-plugin-mkcert';

import netlify from '@astrojs/netlify';

const env = loadEnv(import.meta.env.MODE, process.cwd(), '');
const {
	NETLIFY,
	STORYBLOK_DELIVERY_API_TOKEN,
	STORYBLOK_API_BASE_URL,
	STORYBLOK_REGION,
} = env;

export default defineConfig({
	devToolbar: {
		enabled: false,
	},
	integrations: [
		storyblok({
			accessToken: STORYBLOK_DELIVERY_API_TOKEN,
			apiOptions: {
				/** Set the correct region for your space. Learn more: https://www.storyblok.com/docs/packages/storyblok-js#example-region-parameter */
				region: STORYBLOK_REGION || 'eu',
				/** The following code is only required when creating a Storyblok space directly via the Blueprints feature. */
				endpoint: STORYBLOK_API_BASE_URL
					? `${new URL(STORYBLOK_API_BASE_URL).origin}/v2`
					: undefined,
			},
			components: {
				page: 'storyblok/Page',
				grid: 'storyblok/Grid',
				feature: 'storyblok/Feature',
				teaser: 'storyblok/Teaser',
				conversion_button: 'storyblok/ConversionButton',
			},
		}),
	],
	output: 'server',
	adapter:  netlify() ,
	vite: {
		// mkcert serves the Astro dev server over HTTPS for the Storyblok Visual
		// Editor. Skipped when DISABLE_DEV_HTTPS is set: under `netlify dev` Astro
		// runs HTTP on the proxy target (4321) and Netlify terminates TLS on 8888,
		// because netlify dev's proxy cannot reach an HTTPS target.
		plugins: process.env.DISABLE_DEV_HTTPS ? [] : [mkcert()],
	},
});
