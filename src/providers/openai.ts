import {sseMessages} from '../sse.js';
import {CorruptOutputError, RateLimitError, looksCorrupted, type ChatRequest, type ChatResult, type FetchLike, type Message, type ModelInfo, type Provider, type ProviderAuth, type ToolCall, type Usage} from '../types.js';

const REQUEST_TIMEOUT_MS = 300_000;

export function trimSlash(url: string): string {
	return url.replace(/\/+$/, '');
}

/** Turns an HTTP failure into a sentence the user can act on. */
export async function failure(response: Response): Promise<Error> {
	const body = (await response.text().catch(() => '')).slice(0, 400);
	if (response.status === 401 || response.status === 403) {
		return new Error(`Acesso negado (${response.status}). Confira a chave em /connect. ${body}`.trim());
	}
	if (response.status === 404) return new Error(`Endereço ou modelo não encontrado (404). ${body}`.trim());
	if (response.status === 429) {
		const now = Date.now();
		const retryAfter = response.headers.get('Retry-After')?.trim();
		const delay = retryAfter && /^\d+(?:\.\d+)?$/.test(retryAfter)
			? Number(retryAfter) * 1000
			: retryAfter ? Date.parse(retryAfter) - now : NaN;
		return new RateLimitError(now + (Number.isFinite(delay) ? Math.max(1000, delay) : 60_000));
	}
	return new Error(`${response.status} ${response.statusText}. ${body}`.trim());
}

type ApiMessage = Record<string, unknown>;

export function toOpenAiMessages(messages: Message[]): ApiMessage[] {
	return messages.map((message): ApiMessage => {
		if (message.role === 'tool') {
			return {role: 'tool', tool_call_id: message.toolCallId ?? '', content: message.content};
		}
		if (message.role === 'assistant' && message.toolCalls && message.toolCalls.length > 0) {
			return {
				role: 'assistant',
				content: message.content || null,
				tool_calls: message.toolCalls.map(call => ({
					id: call.id,
					type: 'function',
					function: {name: call.name, arguments: call.arguments},
				})),
			};
		}
		return {role: message.role, content: message.content};
	});
}

type Delta = {
	content?: unknown;
	reasoning_content?: unknown;
	reasoning?: unknown;
	tool_calls?: Array<{index?: number; id?: string; function?: {name?: string; arguments?: string}}>;
};

/** Any server that speaks `/chat/completions`: OpenAI, OpenRouter, Groq, Ollama, Copilot... */
export function openAiProvider(id: string, auth: ProviderAuth, fetchImpl: FetchLike = fetch, options: {streamUsage?: boolean} = {}): Provider {
	return {
		id,

		async chat({model, messages, tools, signal, onEvent}: ChatRequest): Promise<ChatResult> {
			const {baseUrl, headers} = await auth();
			const response = await fetchImpl(`${trimSlash(baseUrl)}/chat/completions`, {
				method: 'POST',
				headers: {'Content-Type': 'application/json', Accept: 'text/event-stream', ...headers},
				body: JSON.stringify({
					model,
					messages: toOpenAiMessages(messages),
					stream: true,
					...(options.streamUsage ? {stream_options: {include_usage: true}} : {}),
					...(tools.length > 0
						? {
								tools: tools.map(tool => ({
									type: 'function',
									function: {name: tool.name, description: tool.description, parameters: tool.parameters},
								})),
								tool_choice: 'auto',
							}
						: {}),
				}),
				signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
			});
			if (!response.ok || !response.body) throw await failure(response);

			let text = '';
			let usage: Usage | undefined;
			const pending = new Map<number, {id: string; name: string; args: string}>();

			for await (const message of sseMessages(response.body)) {
				if (message.data === '[DONE]') break;
				let event: {choices?: Array<{delta?: Delta}>; usage?: {prompt_tokens?: number; completion_tokens?: number}};
				try {
					event = JSON.parse(message.data) as typeof event;
				} catch {
					continue;
				}
				if (event.usage && typeof event.usage.prompt_tokens === 'number') {
					usage = {input: event.usage.prompt_tokens, output: event.usage.completion_tokens ?? 0};
				}
				const delta = event.choices?.[0]?.delta;
				if (!delta) continue;

				if (typeof delta.content === 'string' && delta.content) {
					text += delta.content;
					// Checked on the tail only, so a long answer is not rescanned on every chunk.
					if (looksCorrupted(text.slice(-200))) throw new CorruptOutputError();
					onEvent({type: 'text', text: delta.content});
				}
				const reasoning = delta.reasoning_content ?? delta.reasoning;
				if (typeof reasoning === 'string' && reasoning) onEvent({type: 'thinking', text: reasoning});

				for (const piece of delta.tool_calls ?? []) {
					const index = piece.index ?? 0;
					const call = pending.get(index) ?? {id: '', name: '', args: ''};
					if (piece.id) call.id = piece.id;
					if (piece.function?.name) call.name += piece.function.name;
					if (piece.function?.arguments) call.args += piece.function.arguments;
					pending.set(index, call);
				}
			}

			const toolCalls: ToolCall[] = [...pending.entries()]
				.sort(([a], [b]) => a - b)
				.filter(([, call]) => call.name)
				.map(([index, call]) => ({id: call.id || `call_${index}`, name: call.name, arguments: call.args || '{}'}));

			return {text, toolCalls, ...(usage ? {usage} : {})};
		},

		async listModels(signal: AbortSignal): Promise<ModelInfo[]> {
			const {baseUrl, headers} = await auth();
			const response = await fetchImpl(`${trimSlash(baseUrl)}/models`, {headers, signal});
			if (!response.ok) throw await failure(response);
			const body = (await response.json()) as unknown;
			const list = Array.isArray(body) ? body : (body as {data?: unknown}).data;
			if (!Array.isArray(list)) return [];
			return list
				.filter((entry): entry is RawModel => typeof (entry as {id?: unknown})?.id === 'string')
				.filter(entry => entry.model_picker_enabled !== false)
				.map(entry => {
					const context = contextOf(entry);
					return context ? {id: entry.id, context} : {id: entry.id};
				})
				.sort((a, b) => a.id.localeCompare(b.id));
		},
	};
}

type RawModel = {
	id: string;
	model_picker_enabled?: boolean;
	context_length?: unknown;
	context_window?: unknown;
	max_model_len?: unknown;
	capabilities?: {limits?: {max_context_window_tokens?: unknown}};
};

/** Each server names the context window differently: Copilot, OpenRouter, Groq, vLLM. */
export function contextOf(entry: RawModel): number | undefined {
	for (const value of [entry.capabilities?.limits?.max_context_window_tokens, entry.context_length, entry.context_window, entry.max_model_len]) {
		if (typeof value === 'number' && value > 0) return value;
	}
	return undefined;
}
