import assert from 'node:assert/strict';
import {test} from 'node:test';
import {runTurn, type AgentEvent} from '../src/agent.ts';
import {openAiProvider} from '../src/providers/openai.ts';
import {withoutCorrupted} from '../src/sessions.ts';
import {runShell} from '../src/tools.ts';
import {CorruptOutputError, looksCorrupted, type ChatResult, type Provider} from '../src/types.ts';

const stream = (chunks: string[]) =>
	new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
			controller.close();
		},
	});

test('terminal: acentos chegam inteiros', async () => {
	const output = await runShell(process.platform === 'win32' ? 'Write-Output "ação e coração"' : 'echo "ação e coração"', process.cwd(), new AbortController().signal);
	assert.match(output, /ação e coração/);
});

test('terminal: comando que passa do tempo é encerrado com explicação para o modelo', async () => {
	const command = process.platform === 'win32' ? 'Start-Sleep -Seconds 30' : 'sleep 30';
	const started = Date.now();
	const output = await runShell(command, process.cwd(), new AbortController().signal, 1500);
	assert.ok(Date.now() - started < 15_000, 'não respeitou o tempo limite');
	assert.match(output, /encerrado: passou de 2 s/);
});

test('detecção de tokens internos vazando', () => {
	assert.equal(looksCorrupted('<|close|>to实战think<|open|>'), true);
	assert.equal(looksCorrupted('abc <|reserved_token_163696|> x'), true);
	assert.equal(looksCorrupted('Use `a | b` e <div>'), false);
	assert.equal(looksCorrupted('Olá! Tudo bem?'), false);
});

test('provedor OpenAI interrompe o fluxo ao ver texto corrompido', async () => {
	const body = [
		'data: {"choices":[{"delta":{"content":"começo "}}]}\n\n',
		'data: {"choices":[{"delta":{"content":"<|close|>lixo"}}]}\n\n',
		'data: {"choices":[{"delta":{"content":" muito mais lixo"}}]}\n\n',
	];
	const seen: string[] = [];
	const provider = openAiProvider('t', async () => ({baseUrl: 'http://x', headers: {}}), (async () => new Response(stream(body))) as typeof fetch);
	await assert.rejects(
		provider.chat({model: 'm', messages: [], tools: [], signal: new AbortController().signal, onEvent: event => event.type === 'text' && seen.push(event.text)}),
		CorruptOutputError,
	);
	assert.deepEqual(seen, ['começo '], 'o lixo chegou à tela');
});

test('agente pede de novo uma vez quando a resposta vem corrompida', async () => {
	let calls = 0;
	const provider: Provider = {
		id: 'f',
		async chat(): Promise<ChatResult> {
			calls += 1;
			if (calls === 1) throw new CorruptOutputError();
			return {text: 'certo', toolCalls: []};
		},
		listModels: async () => [],
	};
	const events: AgentEvent[] = [];
	const added = await runTurn({provider, model: 'm', mode: 'build', history: [{role: 'user', content: 'oi'}], root: process.cwd(), signal: new AbortController().signal, approve: async () => true, onEvent: event => events.push(event)});
	assert.equal(calls, 2);
	assert.ok(events.some(event => event.type === 'retry'));
	assert.deepEqual(added.map(message => message.content), ['certo']);
});

test('conversa salva perde o texto corrompido ao ser carregada, mas mantém as chamadas de ferramenta', () => {
	const cleaned = withoutCorrupted([
		{role: 'user', content: 'oi'},
		{role: 'assistant', content: '<|close|>lixo', toolCalls: [{id: '1', name: 'bash', arguments: '{}'}]},
		{role: 'tool', content: 'ok', toolCallId: '1'},
		{role: 'assistant', content: 'xx <|reserved_token_9|> yy'},
		{role: 'assistant', content: 'resposta boa'},
	]);
	assert.deepEqual(
		cleaned.map(message => `${message.role}:${message.content}`),
		['user:oi', 'assistant:', 'tool:ok', 'assistant:resposta boa'],
	);
});

test('agente desiste depois da segunda resposta corrompida, sem guardar o lixo', async () => {
	const provider: Provider = {
		id: 'f',
		chat: async () => {
			throw new CorruptOutputError();
		},
		listModels: async () => [],
	};
	const kept: string[] = [];
	await assert.rejects(
		runTurn({provider, model: 'm', mode: 'build', history: [{role: 'user', content: 'oi'}], root: process.cwd(), signal: new AbortController().signal, approve: async () => true, onEvent: () => undefined, onMessage: message => kept.push(message.content)}),
		CorruptOutputError,
	);
	assert.deepEqual(kept, []);
});
