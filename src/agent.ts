import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {findTool, inside, toolsFor} from './tools.js';
import {CorruptOutputError, type AgentMode, type ChatResult, type Message, type Provider, type ToolCall, type Usage} from './types.js';

const MAX_STEPS = 25;
/** Rough character budget for the history sent on each step. */
const HISTORY_BUDGET = 320_000;
const OLD_TOOL_OUTPUT = 1_500;

export type ToolStatus = 'running' | 'done' | 'error' | 'denied';

export type AgentEvent =
	| {type: 'text'; text: string}
	| {type: 'thinking'; text: string}
	| {type: 'tool'; id: string; name: string; summary: string; status: ToolStatus; output?: string}
	| {type: 'usage'; usage: Usage}
	/** The step is being asked again; whatever was streamed for it must be discarded. */
	| {type: 'retry'; reason: string};

export type Approval = (request: {name: string; summary: string}) => Promise<boolean>;

export type TurnOptions = {
	provider: Provider;
	model: string;
	mode: AgentMode;
	history: Message[];
	root: string;
	signal: AbortSignal;
	approve: Approval;
	onEvent: (event: AgentEvent) => void;
	/** Called with the absolute path right before write_file or edit_file touches it. */
	onBeforeWrite?: (path: string) => void;
	onMessage?: (message: Message) => void;
};

export function systemPrompt(mode: AgentMode, root: string): string {
	const rules = existsSync(join(root, 'AGENTS.md')) ? `\n\nRegras do projeto (AGENTS.md):\n${readFileSync(join(root, 'AGENTS.md'), 'utf8').slice(0, 8000)}` : '';
	const modeText =
		mode === 'plan'
			? 'Você está em modo PLANO: só pode ler e pesquisar. Não altere nada; descreva o que faria.'
			: 'Você está em modo CONSTRUIR: pode ler, editar arquivos e rodar comandos.';
	return [
		'Você é o SERAPH, um assistente de programação que trabalha no terminal do usuário.',
		'Responda em português do Brasil, de forma curta e direta.',
		'Antes de afirmar que algo funciona, verifique rodando o comando ou lendo o resultado.',
		modeText,
		`Pasta de trabalho: ${root}`,
		process.platform === 'win32'
			? 'Sistema: Windows. A ferramenta bash roda no Windows PowerShell 5.1: use ; entre comandos (não &&) e confira se um caminho existe antes de usar -Recurse.'
			: `Sistema: ${process.platform}`,
	].join('\n') + rules;
}

/** Old tool output is the first thing to go when the history outgrows the model. */
export function fitHistory(messages: Message[], budget = HISTORY_BUDGET): Message[] {
	let size = messages.reduce((sum, message) => sum + message.content.length, 0);
	if (size <= budget) return messages;
	return messages.map((message, index) => {
		const isRecent = index >= messages.length - 6;
		if (size <= budget || isRecent || message.role !== 'tool' || message.content.length <= OLD_TOOL_OUTPUT) return message;
		size -= message.content.length - OLD_TOOL_OUTPUT;
		return {...message, content: `${message.content.slice(0, OLD_TOOL_OUTPUT)}\n[… saída antiga cortada]`};
	});
}

function parseArgs(call: ToolCall): Record<string, unknown> {
	if (!call.arguments.trim()) return {};
	const parsed: unknown = JSON.parse(call.arguments);
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('Os argumentos precisam ser um objeto.');
	return parsed as Record<string, unknown>;
}

async function execute(call: ToolCall, options: TurnOptions): Promise<string> {
	const {onEvent} = options;
	const tool = findTool(call.name);
	if (!tool || (options.mode === 'plan' && tool.mutating)) {
		const message = tool ? `A ferramenta ${call.name} não está disponível no modo plano.` : `Ferramenta desconhecida: ${call.name}`;
		onEvent({type: 'tool', id: call.id, name: call.name, summary: call.name, status: 'error', output: message});
		return message;
	}

	let args: Record<string, unknown>;
	try {
		args = parseArgs(call);
	} catch (error) {
		const message = `Argumentos inválidos: ${error instanceof Error ? error.message : String(error)}`;
		onEvent({type: 'tool', id: call.id, name: call.name, summary: call.name, status: 'error', output: message});
		return message;
	}

	const summary = tool.summarize(args);
	if (tool.mutating && !(await options.approve({name: call.name, summary}))) {
		onEvent({type: 'tool', id: call.id, name: call.name, summary, status: 'denied'});
		return 'O usuário negou esta ação. Pergunte o que ele prefere.';
	}

	onEvent({type: 'tool', id: call.id, name: call.name, summary, status: 'running'});
	try {
		if ((call.name === 'write_file' || call.name === 'edit_file') && typeof args['path'] === 'string') {
			options.onBeforeWrite?.(inside(options.root, args['path']));
		}
		const output = await tool.run(args, options.root, options.signal);
		onEvent({type: 'tool', id: call.id, name: call.name, summary, status: 'done', output});
		return output;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		onEvent({type: 'tool', id: call.id, name: call.name, summary, status: 'error', output: message});
		return `Erro: ${message}`;
	}
}

/**
 * `history` must already end with the user's new message. Returns the messages this turn added;
 * `onMessage` sees each one as it is added, so progress survives an interruption.
 */
export async function runTurn(options: TurnOptions): Promise<Message[]> {
	const added: Message[] = [];
	const record = (message: Message) => {
		added.push(message);
		options.onMessage?.(message);
	};
	const tools = toolsFor(options.mode).map(({name, description, parameters}) => ({name, description, parameters}));

	for (let step = 0; step < MAX_STEPS; step += 1) {
		if (options.signal.aborted) break;

		const conversation: Message[] = [{role: 'system', content: systemPrompt(options.mode, options.root)}, ...options.history, ...added];
		const ask = () =>
			options.provider.chat({
				model: options.model,
				messages: fitHistory(conversation),
				tools,
				signal: options.signal,
				onEvent: event => options.onEvent(event),
			});
		let result: ChatResult;
		try {
			result = await ask();
		} catch (error) {
			// A leak of control tokens is usually a one-off on the provider's side: one fresh attempt.
			if (!(error instanceof CorruptOutputError) || options.signal.aborted) throw error;
			options.onEvent({type: 'retry', reason: 'O modelo devolveu texto corrompido; pedindo de novo.'});
			result = await ask();
		}
		if (result.usage) options.onEvent({type: 'usage', usage: result.usage});

		record({role: 'assistant', content: result.text, ...(result.toolCalls.length > 0 ? {toolCalls: result.toolCalls} : {})});
		if (result.toolCalls.length === 0) return added;

		// Every tool call needs an answer, or the next request is rejected by the API.
		for (const call of result.toolCalls) {
			const output = options.signal.aborted ? 'Cancelado: o usuário interrompeu antes desta ação.' : await execute(call, options);
			record({role: 'tool', content: output, toolCallId: call.id, name: call.name});
		}
	}

	if (!options.signal.aborted) {
		const note = `Parei após ${MAX_STEPS} passos. Diga "continue" para seguir.`;
		options.onEvent({type: 'text', text: `\n${note}`});
		record({role: 'assistant', content: note});
	}
	return added;
}
