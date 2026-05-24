const UPDATE_FEED_HOST = 'update-feed-production.up.railway.app';
const RELAY_HOST = 'relay-production-e21f.up.railway.app';

function resolveUpstreamHost(hostname) {
	if (hostname === 'relay.vectorcode.app') {
		return RELAY_HOST;
	}

	if (hostname === 'vectorcode.app' || hostname === 'www.vectorcode.app') {
		return UPDATE_FEED_HOST;
	}

	return undefined;
}

export default {
	async fetch(request) {
		const incomingUrl = new URL(request.url);
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
