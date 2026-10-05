import {sseMessages} from '../sse.js';
import type {ChatRequest, ChatResult, FetchLike, Message, Provider, ProviderAuth, ToolCall, Usage} from '../types.js';
import {failure, trimSlash} from './openai.js';

const REQUEST_TIMEOUT_MS = 300_000;
const MAX_TOKENS = 8192;

type Block = Record<string, unknown>;
type ApiMessage = {role: 'user' | 'assistant'; content: string | Block[]};

/** Anthropic wants tool results inside a user turn, and consecutive results merged. */
export function toAnthropicMessages(messages: Message[]): {system: string; messages: ApiMessage[]} {
	const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
	const out: ApiMessage[] = [];

	for (const message of messages) {
		if (message.role === 'system') continue;

		if (message.role === 'tool') {
			const block: Block = {type: 'tool_result', tool_use_id: message.toolCallId ?? '', content: message.content};
			const last = out[out.length - 1];
			if (last?.role === 'user' && Array.isArray(last.content) && last.content[0]?.['type'] === 'tool_result') {
				last.content.push(block);
			} else {
				out.push({role: 'user', content: [block]});
			}
			continue;
		}

		if (message.role === 'assistant') {
			const blocks: Block[] = [];
			if (message.content) blocks.push({type: 'text', text: message.content});
			for (const call of message.toolCalls ?? []) {
				let input: unknown = {};
				try {
					input = JSON.parse(call.arguments || '{}');
				} catch {
					input = {};
				}
				blocks.push({type: 'tool_use', id: call.id, name: call.name, input});
			}
			out.push({role: 'assistant', content: blocks.length > 0 ? blocks : ' '});
			continue;
		}

		out.push({role: 'user', content: message.content});
	}

	return {system, messages: out};
}

export function anthropicProvider(id: string, auth: ProviderAuth, fetchImpl: FetchLike = fetch): Provider {
	return {
		id,

		async chat({model, messages, tools, signal, onEvent}: ChatRequest): Promise<ChatResult> {
			const {baseUrl, headers} = await auth();
			const converted = toAnthropicMessages(messages);
			const response = await fetchImpl(`${trimSlash(baseUrl)}/v1/messages`, {
				method: 'POST',
				headers: {'Content-Type': 'application/json', 'anthropic-version': '2023-06-01', ...headers},
				body: JSON.stringify({
					model,
					max_tokens: MAX_TOKENS,
					stream: true,
					...(converted.system ? {system: converted.system} : {}),
					messages: converted.messages,
					...(tools.length > 0
						? {tools: tools.map(tool => ({name: tool.name, description: tool.description, input_schema: tool.parameters}))}
						: {}),
				}),
				signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
			});
			if (!response.ok || !response.body) throw await failure(response);

			let text = '';
			let input = 0;
			let output = 0;
			const blocks = new Map<number, {id: string; name: string; json: string}>();

			for await (const message of sseMessages(response.body)) {
				let event: Record<string, any>;
				try {
					event = JSON.parse(message.data) as Record<string, any>;
				} catch {
					continue;
				}
				const type = event['type'] as string | undefined;

				if (type === 'message_start') {
					input = event['message']?.usage?.input_tokens ?? input;
				} else if (type === 'content_block_start' && event['content_block']?.type === 'tool_use') {
					blocks.set(event['index'] as number, {id: event['content_block'].id, name: event['content_block'].name, json: ''});
				} else if (type === 'content_block_delta') {
					const delta = event['delta'] ?? {};
					if (delta.type === 'text_delta' && typeof delta.text === 'string') {
						text += delta.text;
						onEvent({type: 'text', text: delta.text});
					} else if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
						onEvent({type: 'thinking', text: delta.thinking});
					} else if (delta.type === 'input_json_delta') {
						const block = blocks.get(event['index'] as number);
						if (block) block.json += String(delta.partial_json ?? '');
					}
				} else if (type === 'message_delta') {
					output = event['usage']?.output_tokens ?? output;
				} else if (type === 'error') {
					throw new Error(String(event['error']?.message ?? 'Erro da API Anthropic'));
				}
			}

			const toolCalls: ToolCall[] = [...blocks.entries()]
				.sort(([a], [b]) => a - b)
				.map(([, block]) => ({id: block.id, name: block.name, arguments: block.json || '{}'}));
			const usage: Usage | undefined = input || output ? {input, output} : undefined;

			return {text, toolCalls, ...(usage ? {usage} : {})};
		},

		async listModels(signal: AbortSignal): Promise<string[]> {
			const {baseUrl, headers} = await auth();
			const response = await fetchImpl(`${trimSlash(baseUrl)}/v1/models?limit=100`, {
				headers: {'anthropic-version': '2023-06-01', ...headers},
				signal,
			});
			if (!response.ok) throw await failure(response);
			const body = (await response.json()) as {data?: Array<{id?: unknown}>};
			return (body.data ?? []).map(entry => entry.id).filter((value): value is string => typeof value === 'string');
		},
	};
}
