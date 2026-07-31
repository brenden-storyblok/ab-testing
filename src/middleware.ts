import { defineMiddleware } from 'astro:middleware';
import { readOrMintVisitorId } from './lib/experiments';

export const onRequest = defineMiddleware((context, next) => {
	context.locals.visitorId = readOrMintVisitorId(context.cookies);
	return next();
});
