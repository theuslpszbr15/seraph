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

export interface Provider {
	readonly id: string;
	chat(request: ChatRequest): Promise<ChatResult>;
	listModels(signal: AbortSignal): Promise<string[]>;
}

/** Resolved on every call so short-lived tokens (Copilot) can refresh themselves. */
export type ProviderAuth = () => Promise<{baseUrl: string; headers: Record<string, string>}>;

export type FetchLike = typeof fetch;

export type AgentMode = 'build' | 'plan';
