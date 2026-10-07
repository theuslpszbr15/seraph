export type Role = 'system' | 'user' | 'assistant' | 'tool';

export type ToolCall = {id: string; name: string; arguments: string};

export type Message = {
	role: Role;
	content: string;
	toolCalls?: ToolCall[];
	toolCallId?: string;
	name?: string;
};

export type Usage = {input: number; output: number};

export type StreamEvent =
	| {type: 'text'; text: string}
	| {type: 'thinking'; text: string};

export type ToolSchema = {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
};

export type ChatRequest = {
	model: string;
	messages: Message[];
	tools: ToolSchema[];
	signal: AbortSignal;
	onEvent: (event: StreamEvent) => void;
};

export type ChatResult = {text: string; toolCalls: ToolCall[]; usage?: Usage};

export type ModelInfo = {id: string; context?: number};

export interface Provider {
	readonly id: string;
	chat(request: ChatRequest): Promise<ChatResult>;
	listModels(signal: AbortSignal): Promise<ModelInfo[]>;
}

/** Resolved on every call so short-lived tokens (Copilot) can refresh themselves. */
export type ProviderAuth = () => Promise<{baseUrl: string; headers: Record<string, string>}>;

export type FetchLike = typeof fetch;

export class RateLimitError extends Error {
	constructor(readonly retryAt: number) {
		const seconds = Math.max(1, Math.ceil((retryAt - Date.now()) / 1000));
		super(`Limite de requisições do provedor (429). Aguarde ${seconds}s antes de tentar novamente. Se persistir, confira a cota da conta ou use outro provedor com /models.`);
		this.name = 'RateLimitError';
	}
}

/** The provider leaked the model's internal control tokens: the text is garbage and must not be kept. */
export class CorruptOutputError extends Error {
	constructor() {
		super('O modelo devolveu texto corrompido (tokens internos vazando do provedor). Tente de novo ou troque o modelo com /models.');
		this.name = 'CorruptOutputError';
	}
}

const CONTROL_TOKEN = /<\|(?:reserved_token_\d+|open|close|sep|im_start|im_end|im_sep|endoftext|start_header_id|end_header_id|eot_id)\|>/;

export function looksCorrupted(text: string): boolean {
	return CONTROL_TOKEN.test(text);
}

export type AgentMode = 'build' | 'plan';
