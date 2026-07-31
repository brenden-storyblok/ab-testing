import { defineMiddleware } from 'astro:middleware';
import { readOrMintVisitorId } from './lib/experiments';

export const onRequest = defineMiddleware((context, next) => {
	// Storyblok appends `_storyblok` when rendering inside the Visual Editor.
	const isVisualEditor = context.request.headers.get('referer')?.toString().includes('_storyblok') ?? false;
	if (!isVisualEditor) {
		context.locals.visitorId = readOrMintVisitorId(context.cookies);
	}
	context.locals.isVisualEditor = isVisualEditor;
	return next();
});
