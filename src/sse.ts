export type SseMessage = {event?: string; data: string};

function parseBlock(block: string): SseMessage | undefined {
	let event: string | undefined;
	const data: string[] = [];
	for (const line of block.split(/\r?\n/)) {
		if (!line || line.startsWith(':')) continue;
		const colon = line.indexOf(':');
		const field = colon < 0 ? line : line.slice(0, colon);
		const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
		if (field === 'event') event = value;
		else if (field === 'data') data.push(value);
	}
	if (data.length === 0) return undefined;
	return {...(event ? {event} : {}), data: data.join('\n')};
}

/** Reads a Server-Sent Events body, one message at a time. */
export async function* sseMessages(body: ReadableStream<Uint8Array>): AsyncGenerator<SseMessage> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	try {
		while (true) {
			const {done, value} = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, {stream: true});
			let match = /\r?\n\r?\n/.exec(buffer);
			while (match) {
				const message = parseBlock(buffer.slice(0, match.index));
				buffer = buffer.slice(match.index + match[0].length);
				if (message) yield message;
				match = /\r?\n\r?\n/.exec(buffer);
			}
		}
		const rest = parseBlock(buffer);
		if (rest) yield rest;
	} finally {
		reader.releaseLock();
	}
}
