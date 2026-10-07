import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {runTurn, fitHistory, type AgentEvent} from '../src/agent.ts';
import {angel, artWidth, mirror, wordmark} from '../src/art.ts';
import {findCommand, parseCommand, suggest} from '../src/commands.ts';
import {failure, openAiProvider} from '../src/providers/openai.ts';
import {sseMessages} from '../src/sse.ts';
import {clip, inside, toolsFor, TOOLS} from '../src/tools.ts';
import type {ChatRequest, ChatResult, Message, Provider} from '../src/types.ts';
import {RateLimitError} from '../src/types.ts';

const stream = (chunks: string[]) =>
	new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
			controller.close();
		},
	});

test('SSE: junta mensagens partidas no meio e ignora comentários', async () => {
	const out: string[] = [];
	for await (const message of sseMessages(stream([': oi\n\ndata: a', 'bc\n\nevent: x\ndata: 2\n\n']))) out.push(message.data);
	assert.deepEqual(out, ['abc', '2']);
});

test('OpenAI: monta texto e chamada de ferramenta que chega em pedaços', async () => {
	const body = [
		'data: {"choices":[{"delta":{"content":"Olá "}}]}\n\n',
		'data: {"choices":[{"delta":{"content":"mundo"}}]}\n\n',
		'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"read_file","arguments":"{\\"pa"}}]}}]}\n\n',
		'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"th\\":\\"a.txt\\"}"}}]}}]}\n\n',
		'data: {"usage":{"prompt_tokens":10,"completion_tokens":4},"choices":[]}\n\n',
		'data: [DONE]\n\n',
	];
	let sent: Record<string, unknown> = {};
	const provider = openAiProvider(
		't',
		async () => ({baseUrl: 'http://x/v1/', headers: {Authorization: 'Bearer k'}}),
		(async (url: string | URL | Request, init?: RequestInit) => {
			assert.equal(String(url), 'http://x/v1/chat/completions');
			sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
			return new Response(stream(body), {status: 200});
		}) as typeof fetch,
	);
	const seen: string[] = [];
	const result = await provider.chat({
		model: 'm',
		messages: [{role: 'user', content: 'oi'}],
		tools: [{name: 'read_file', description: 'd', parameters: {type: 'object'}}],
		signal: new AbortController().signal,
		onEvent: event => event.type === 'text' && seen.push(event.text),
	});
	assert.equal(result.text, 'Olá mundo');
	assert.deepEqual(seen, ['Olá ', 'mundo']);
	assert.deepEqual(result.toolCalls, [{id: 'c1', name: 'read_file', arguments: '{"path":"a.txt"}'}]);
	assert.deepEqual(result.usage, {input: 10, output: 4});
	assert.equal(sent['stream'], true);
});

test('OpenAI: erro 401 vira orientação, não JSON cru', async () => {
	const provider = openAiProvider('t', async () => ({baseUrl: 'http://x', headers: {}}), (async () => new Response('nope', {status: 401})) as typeof fetch);
	await assert.rejects(
		provider.chat({model: 'm', messages: [], tools: [], signal: new AbortController().signal, onEvent: () => undefined}),
		/Acesso negado.*\/connect/,
	);
});

test('OpenAI: 429 respeita Retry-After em segundos, data e usa pausa padrao', async () => {
	for (const [header, delay] of [['30', 30_000], [new Date(Date.now() + 120_000).toUTCString(), 120_000], ['invalido', 60_000], ['', 60_000]] as const) {
		const started = Date.now();
		const error = await failure(new Response('{"title":"Too Many Requests"}', {status: 429, headers: header ? {'Retry-After': header} : {}}));
		assert.ok(error instanceof RateLimitError);
		assert.ok(Math.abs(error.retryAt - started - delay) < 2000);
		assert.match(error.message, /429.*Aguarde.*cota/);
		assert.ok(!error.message.includes('Too Many Requests'));
	}
});

test('ferramentas: caminho fora da pasta é recusado, inclusive ../ e absoluto', () => {
	const root = mkdtempSync(join(tmpdir(), 'seraph-'));
	try {
		assert.throws(() => inside(root, '../fora.txt'), /fora da pasta/);
		assert.throws(() => inside(root, join(root, '..', 'x')), /fora da pasta/);
		assert.throws(() => inside(root, 'C:\\Windows\\win.ini'.replace('C:\\', process.platform === 'win32' ? 'C:\\' : '/')), /fora da pasta/);
		assert.ok(inside(root, 'a/b.txt').startsWith(root));
	} finally {
		rmSync(root, {recursive: true, force: true});
	}
});

test('ferramentas: modo plano só enxerga leitura', () => {
	const names = toolsFor('plan').map(tool => tool.name);
	assert.ok(names.includes('read_file'));
	assert.ok(!names.includes('bash') && !names.includes('write_file') && !names.includes('edit_file'));
	assert.equal(toolsFor('build').length, TOOLS.length);
});

test('ferramentas: edit_file recusa trecho ausente e ambíguo', async () => {
	const root = mkdtempSync(join(tmpdir(), 'seraph-'));
	const edit = TOOLS.find(tool => tool.name === 'edit_file');
	assert.ok(edit);
	try {
		writeFileSync(join(root, 'a.txt'), 'x y x', 'utf8');
		const signal = new AbortController().signal;
		await assert.rejects(edit.run({path: 'a.txt', old: 'zzz', new: '1'}, root, signal), /não foi encontrado/);
		await assert.rejects(edit.run({path: 'a.txt', old: 'x', new: '1'}, root, signal), /2 vezes/);
		await edit.run({path: 'a.txt', old: 'y', new: 'Y'}, root, signal);
		assert.equal(readFileSync(join(root, 'a.txt'), 'utf8'), 'x Y x');
	} finally {
		rmSync(root, {recursive: true, force: true});
	}
});

test('clip: corta saída enorme e avisa', () => {
	assert.ok(clip('a'.repeat(100_000)).includes('cortado'));
	assert.equal(clip('curto'), 'curto');
});

/** A scripted model: each call returns the next prepared result. */
function scripted(results: ChatResult[], seen: ChatRequest[] = []): Provider {
	let step = 0;
	return {
		id: 'fake',
		async chat(request) {
			seen.push(request);
			return results[step++] ?? {text: 'fim', toolCalls: []};
		},
		async listModels() {
			return [];
		},
	};
}

test('agente: negar a aprovação impede a escrita e o modelo é avisado', async () => {
	const root = mkdtempSync(join(tmpdir(), 'seraph-'));
	try {
		const events: AgentEvent[] = [];
		const added = await runTurn({
			provider: scripted([
				{text: '', toolCalls: [{id: 'c1', name: 'write_file', arguments: JSON.stringify({path: 'novo.txt', content: 'oi'})}]},
				{text: 'Ok, não escrevi.', toolCalls: []},
			]),
			model: 'm',
			mode: 'build',
			history: [{role: 'user', content: 'crie'}],
			root,
			signal: new AbortController().signal,
			approve: async () => false,
			onEvent: event => events.push(event),
		});
		assert.throws(() => readFileSync(join(root, 'novo.txt')));
		assert.ok(events.some(event => event.type === 'tool' && event.status === 'denied'));
		assert.equal(added.at(-1)?.content, 'Ok, não escrevi.');
		assert.match(added.find(message => message.role === 'tool')?.content ?? '', /negou/);
	} finally {
		rmSync(root, {recursive: true, force: true});
	}
});

test('agente: aprovando, grava; leitura nunca pede aprovação', async () => {
	const root = mkdtempSync(join(tmpdir(), 'seraph-'));
	try {
		writeFileSync(join(root, 'l.txt'), 'linha', 'utf8');
		let asked = 0;
		await runTurn({
			provider: scripted([
				{
					text: '',
					toolCalls: [
						{id: 'a', name: 'read_file', arguments: '{"path":"l.txt"}'},
						{id: 'b', name: 'write_file', arguments: JSON.stringify({path: 'n.txt', content: 'ok'})},
					],
				},
			]),
			model: 'm',
			mode: 'build',
			history: [],
			root,
			signal: new AbortController().signal,
			approve: async () => {
				asked += 1;
				return true;
			},
			onEvent: () => undefined,
		});
		assert.equal(asked, 1);
		assert.equal(readFileSync(join(root, 'n.txt'), 'utf8'), 'ok');
	} finally {
		rmSync(root, {recursive: true, force: true});
	}
});

test('agente: no modo plano, escrita é bloqueada mesmo que o modelo peça', async () => {
	const root = mkdtempSync(join(tmpdir(), 'seraph-'));
	try {
		let asked = 0;
		const added = await runTurn({
			provider: scripted([
				{text: '', toolCalls: [{id: 'c', name: 'bash', arguments: '{"command":"echo oi > x.txt"}'}]},
				{text: 'ok', toolCalls: []},
			]),
			model: 'm',
			mode: 'plan',
			history: [],
			root,
			signal: new AbortController().signal,
			approve: async () => {
				asked += 1;
				return true;
			},
			onEvent: () => undefined,
		});
		assert.equal(asked, 0);
		assert.throws(() => readFileSync(join(root, 'x.txt')));
		assert.match(added.find(message => message.role === 'tool')?.content ?? '', /modo plano/);
	} finally {
		rmSync(root, {recursive: true, force: true});
	}
});

test('agente: argumentos quebrados viram erro para o modelo, sem derrubar o turno', async () => {
	const added = await runTurn({
		provider: scripted([
			{text: '', toolCalls: [{id: 'c', name: 'read_file', arguments: '{quebrado'}]},
			{text: 'certo', toolCalls: []},
		]),
		model: 'm',
		mode: 'build',
		history: [],
		root: tmpdir(),
		signal: new AbortController().signal,
		approve: async () => true,
		onEvent: () => undefined,
	});
	assert.match(added.find(message => message.role === 'tool')?.content ?? '', /Argumentos inválidos/);
	assert.equal(added.at(-1)?.content, 'certo');
});

test('histórico: saída antiga de ferramenta é cortada, a recente não', () => {
	const big = 'x'.repeat(50_000);
	const messages: Message[] = [
		{role: 'tool', content: big, toolCallId: '1'},
		...Array.from({length: 8}, (): Message => ({role: 'user', content: 'a'})),
		{role: 'tool', content: big, toolCallId: '2'},
	];
	const fitted = fitHistory(messages, 60_000);
	assert.ok((fitted[0]?.content.length ?? 0) < 2_000);
	assert.equal(fitted.at(-1)?.content.length, 50_000);
});

test('arte: anjo é simétrico e as linhas têm a mesma largura', () => {
	const rows = angel();
	const width = artWidth(rows);
	for (const row of rows) {
		assert.equal([...row].length, width);
		assert.equal(mirror(row), row, `linha assimétrica: ${row}`);
	}
	const name = wordmark();
	assert.equal(new Set(name.map(line => [...line].length)).size, 1);
	assert.ok(artWidth(rows) <= 76 && artWidth(name) <= 76);
});

test('comandos: sugere por prefixo e resolve apelidos', () => {
	assert.deepEqual(suggest('/mo').map(command => command.name), ['models']);
	assert.equal(findCommand('quit')?.name, 'exit');
	assert.equal(findCommand('clear')?.name, 'new');
	assert.deepEqual(suggest('texto'), []);
	assert.deepEqual(suggest('/connect algo'), []);
	assert.deepEqual(parseCommand('/Connect  a b'), {name: 'connect', args: 'a b'});
});
