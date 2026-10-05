import assert from 'node:assert/strict';
import {createServer, type IncomingMessage, type Server} from 'node:http';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {after, before, test} from 'node:test';
import {runTurn} from '../src/agent.ts';
import {openAiProvider} from '../src/providers/openai.ts';

type Seen = {auth: string | undefined; path: string; body: {messages: Array<{role: string; content?: string}>; model: string}};

let server: Server;
let base = '';
const seen: Seen[] = [];

const readBody = (request: IncomingMessage) =>
	new Promise<string>(resolve => {
		let data = '';
		request.on('data', chunk => (data += chunk));
		request.on('end', () => resolve(data));
	});

before(async () => {
	server = createServer(async (request, response) => {
		const url = request.url ?? '';
		if (url.endsWith('/models')) {
			response.writeHead(200, {'Content-Type': 'application/json'});
			return void response.end(JSON.stringify({data: [{id: 'modelo-a'}, {id: 'modelo-b'}]}));
		}
		const body = JSON.parse(await readBody(request)) as Seen['body'];
		seen.push({auth: request.headers.authorization, path: url, body});

		response.writeHead(200, {'Content-Type': 'text/event-stream'});
		const send = (delta: unknown) => response.write(`data: ${JSON.stringify({choices: [{delta}]})}\n\n`);
		const hasToolResult = body.messages.some(message => message.role === 'tool');
		if (!hasToolResult) {
			send({tool_calls: [{index: 0, id: 'call_1', function: {name: 'read_file', arguments: '{"path":"nota.txt"}'}}]});
		} else {
			const result = body.messages.find(message => message.role === 'tool')?.content ?? '';
			send({content: `O arquivo diz: ${result.includes('conteudo-secreto') ? 'conteudo-secreto' : '???'}`});
		}
		response.end('data: [DONE]\n\n');
	});
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
	const address = server.address();
	base = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/v1`;
});

after(() => server.close());

test('rede real: lista modelos, envia a chave e conclui um turno com ferramenta', async () => {
	const root = mkdtempSync(join(tmpdir(), 'seraph-e2e-'));
	try {
		writeFileSync(join(root, 'nota.txt'), 'conteudo-secreto', 'utf8');
		const provider = openAiProvider('local', async () => ({baseUrl: base, headers: {Authorization: 'Bearer chave-de-teste'}}));

		assert.deepEqual(await provider.listModels(new AbortController().signal), [{id: 'modelo-a'}, {id: 'modelo-b'}]);

		const streamed: string[] = [];
		const added = await runTurn({
			provider,
			model: 'modelo-a',
			mode: 'build',
			history: [{role: 'user', content: 'leia nota.txt'}],
			root,
			signal: new AbortController().signal,
			approve: async () => true,
			onEvent: event => event.type === 'text' && streamed.push(event.text),
		});

		assert.equal(seen.length, 2, 'esperava duas rodadas: pedido de ferramenta e resposta final');
		assert.ok(seen.every(request => request.auth === 'Bearer chave-de-teste'));
		assert.ok(seen.every(request => request.path === '/v1/chat/completions'));
		assert.equal(seen[1]?.body.model, 'modelo-a');
		assert.equal(seen[0]?.body.messages[0]?.role, 'system');
		assert.equal(added.at(-1)?.content, 'O arquivo diz: conteudo-secreto');
		assert.equal(streamed.join(''), 'O arquivo diz: conteudo-secreto');
	} finally {
		rmSync(root, {recursive: true, force: true});
	}
});

test('rede real: cancelar no meio interrompe o pedido', async () => {
	const slow = createServer((_request, response) => {
		response.writeHead(200, {'Content-Type': 'text/event-stream'});
		response.write('data: {"choices":[{"delta":{"content":"a"}}]}\n\n');
		// never finishes
	});
	await new Promise<void>(resolve => slow.listen(0, '127.0.0.1', resolve));
	const address = slow.address();
	const url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
	try {
		const controller = new AbortController();
		const provider = openAiProvider('slow', async () => ({baseUrl: url, headers: {}}));
		const pending = provider.chat({
			model: 'm',
			messages: [],
			tools: [],
			signal: controller.signal,
			onEvent: () => controller.abort(),
		});
		await assert.rejects(pending);
	} finally {
		slow.closeAllConnections();
		slow.close();
	}
});
