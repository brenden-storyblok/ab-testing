import { createApiClient } from '@storyblok/api-client';
import { defineStoryblokBlocks } from '@storyblok/astro';
import ConversionButton from './storyblok/ConversionButton.astro';
import Feature from './storyblok/Feature.astro';
import Grid from './storyblok/Grid.astro';
import Page from './storyblok/Page.astro';
import Teaser from './storyblok/Teaser.astro';

const { STORYBLOK_DELIVERY_API_TOKEN, STORYBLOK_API_BASE_URL, STORYBLOK_REGION } = import.meta.env;

export const apiClient = createApiClient({
	accessToken: STORYBLOK_DELIVERY_API_TOKEN,
	/** Set the correct region for your space. */
	region: STORYBLOK_REGION || 'eu',
	/**
	 * Only required when creating a Storyblok space directly via the Blueprints feature.
	 * The client appends `/v2/cdn/...` itself, so this is the origin only.
	 */
	baseUrl: STORYBLOK_API_BASE_URL ? new URL(STORYBLOK_API_BASE_URL).origin : undefined,
});

export const { StoryblokBlock, StoryblokRichText } = defineStoryblokBlocks(() => ({
	components: {
		page: Page,
		grid: Grid,
		feature: Feature,
		teaser: Teaser,
		// Keys match the technical names in Storyblok. v11 dropped v9's camelCase conversion.
		conversion_button: ConversionButton,
	},
}));
