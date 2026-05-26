const UPDATE_FEED_HOST = 'w2v9ki0q.up.railway.app';
const RELAY_HOST = 'sskpzvaw.up.railway.app';

const UPSTREAM_HOSTS_BY_PUBLIC_HOST = new Map([
	['relay.vectorcode.app', RELAY_HOST],
	['vectorcode.app', UPDATE_FEED_HOST],
]);

function resolveUpstreamHost(hostname) {
	return UPSTREAM_HOSTS_BY_PUBLIC_HOST.get(hostname);
}

export default {
	async fetch(request) {
		const incomingUrl = new URL(request.url);
		if (incomingUrl.hostname === 'www.vectorcode.app') {
			incomingUrl.hostname = 'vectorcode.app';
			return Response.redirect(incomingUrl, 301);
		}

		const upstreamHost = resolveUpstreamHost(incomingUrl.hostname);

		if (!upstreamHost) {
			return new Response('Not found', { status: 404 });
		}

		const upstreamUrl = new URL(request.url);
		upstreamUrl.hostname = upstreamHost;

		const headers = new Headers(request.headers);
		headers.delete('host');
		headers.set('x-forwarded-host', incomingUrl.hostname);
		headers.set('x-forwarded-proto', incomingUrl.protocol.replace(':', ''));

		const init = {
			method: request.method,
			headers,
			redirect: 'manual'
		};

		if (request.method !== 'GET' && request.method !== 'HEAD') {
			init.body = request.body;
		}

		return fetch(upstreamUrl, init);
	}
};
