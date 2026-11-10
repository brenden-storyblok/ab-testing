import { defineMiddleware, sequence } from 'astro:middleware';
import { isInEditor, storyblokPreviewMiddleware } from '@storyblok/astro';
import { readOrMintVisitorId } from './lib/experiments';

const visitorIdMiddleware = defineMiddleware((context, next) => {
	// The editor iframe's first GET carries the `_storyblok` params in its own URL, but its referer is
	// only the editor origin. The sendBeacon POST has no params in its URL, so it relies on the referer.
	const isEditorUrl = isInEditor(context.url);
	const isEditorReferer = context.request.headers.get('referer')?.toString().includes('_storyblok') ?? false;
	const isVisualEditor = isEditorUrl || isEditorReferer;
	if (!isVisualEditor) {
		context.locals.visitorId = readOrMintVisitorId(context.cookies);
	}
	context.locals.isVisualEditor = isVisualEditor;
	return next();
});

export const onRequest = sequence(storyblokPreviewMiddleware, visitorIdMiddleware);
