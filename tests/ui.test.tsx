import assert from 'node:assert/strict';
import {createServer, type Server} from 'node:http';
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {after, afterEach, before, beforeEach, test} from 'node:test';
import {render} from 'ink-testing-library';
import React from 'react';
import {App} from '../src/App.tsx';
import {config, DEFAULT_CONFIG} from '../src/registry.ts';
import {themeById} from '../src/themes.ts';
import {Logo} from '../src/ui/Logo.tsx';

let home = '';
let root = '';
let projects = '';
const previous = process.env['SERAPH_HOME'];

// The app starts git and shell children in the project folder; Windows keeps it locked until they end,
// so project folders are removed once, after every test has finished.
before(() => {
	projects = mkdtempSync(join(tmpdir(), 'seraph-proj-'));
});

after(async () => {
	await sleep(500);
	rmSync(projects, {recursive: true, force: true, maxRetries: 20, retryDelay: 100});
});

// A fresh folder per test: settings such as the mode persist, and must not leak between tests.
beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), 'seraph-ui-'));
	root = mkdtempSync(join(projects, 'p-'));
	process.env['SERAPH_HOME'] = home;
});

afterEach(() => {
	if (previous === undefined) delete process.env['SERAPH_HOME'];
	else process.env['SERAPH_HOME'] = previous;
	rmSync(home, {recursive: true, force: true, maxRetries: 20, retryDelay: 50});
});

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const settle = () => sleep(80);

type Rendered = ReturnType<typeof render>;

async function waitFor(app: Rendered, predicate: (frame: string) => boolean, ms = 10_000): Promise<string> {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		const frame = app.lastFrame() ?? '';
		if (predicate(frame)) return frame;
		await sleep(40);
	}
	throw new Error(`Tempo esgotado. Última tela:\n${app.lastFrame()}`);
}

async function type(app: Rendered, text: string) {
	app.stdin.write(text);
	await settle();
}

test('tela inicial cabe na janela: nome, prompt, dica e botão de sair', async () => {
	const app = render(<App cwd={root} />);
	await settle();
	const frame = app.lastFrame() ?? '';
	assert.ok(frame.includes('███████╗'), 'wordmark SERAPH ausente');
	assert.ok(!frame.includes('▄▄▀▀▀'), 'o anjo não cabe em 30 linhas');
	assert.ok(frame.split('\n').length <= 29, `a tela tem ${frame.split('\n').length} linhas`);
	assert.match(frame, /Construir/);
	assert.match(frame, /nenhum modelo/);
	assert.match(frame, /Dica:/);
	assert.match(frame, /✕ sair/);
	app.unmount();
});

test('logo completo: o anjo aparece quando há altura', () => {
	const app = render(<Logo theme={themeById('seraph')} columns={100} size="full" />);
	const frame = app.lastFrame() ?? '';
	assert.ok(frame.includes('▄▄▀▀▀'), 'anjo ausente');
	assert.ok(frame.includes('███████╗'));
	app.unmount();
});

test('"/" lista comandos, "/mo" filtra e tab completa', async () => {
	const app = render(<App cwd={root} />);
	await settle();
	await type(app, '/');
	assert.match(app.lastFrame() ?? '', /conectar provedor/);
	await type(app, 'mo');
	const frame = app.lastFrame() ?? '';
	assert.match(frame, /escolher o modelo/);
	assert.ok(!frame.includes('conectar provedor'));
	await type(app, '\t');
	const completed = app.lastFrame() ?? '';
	assert.match(completed, /┃\s+\/models/);
	assert.ok(!completed.includes('escolher o modelo'), 'as sugestões deviam sumir depois de completar');
	app.unmount();
});

test('tab alterna Construir e Planejar e a escolha fica salva', async () => {
	const app = render(<App cwd={root} />);
	await settle();
	await type(app, '\t');
	assert.match(app.lastFrame() ?? '', /Planejar/);
	assert.equal(config.read().mode, 'plan');
	app.unmount();
});

test('sem provedor, a mensagem orienta para /connect; ↑ traz a mensagem de volta', async () => {
	const app = render(<App cwd={root} />);
	await settle();
	await type(app, 'oi seraph');
	await type(app, '\r');
	assert.match(app.lastFrame() ?? '', /\/connect/);
	await type(app, '\u001b[A');
	assert.match(app.lastFrame() ?? '', /oi seraph/);
	app.unmount();
});

test('texto e Enter no mesmo pedaço enviam a mensagem, não quebram linha', async () => {
	const app = render(<App cwd={root} />);
	await settle();
	await type(app, 'oi junto\r');
	const frame = app.lastFrame() ?? '';
	assert.match(frame, /\/connect/, 'não enviou');
	assert.match(frame, /Pergunte qualquer coisa/, 'o campo devia ficar vazio');
	app.unmount();
});

test('roda do mouse não vira texto no campo', async () => {
	const app = render(<App cwd={root} />);
	await settle();
	await type(app, '\u001b[<64;10;5M');
	const frame = app.lastFrame() ?? '';
	assert.ok(!frame.includes('[<64'), 'a sequência do mouse foi digitada');
	assert.match(frame, /Pergunte qualquer coisa/);
	app.unmount();
});

test('@ sugere arquivos do projeto e tab completa o caminho', async () => {
	writeFileSync(join(root, 'nota-importante.txt'), 'x', 'utf8');
	const app = render(<App cwd={root} />);
	await settle();
	await type(app, 'leia @nota');
	assert.match(app.lastFrame() ?? '', /nota-importante\.txt/);
	await type(app, '\t');
	assert.match(app.lastFrame() ?? '', /leia @nota-importante\.txt/);
	app.unmount();
});

test('!comando roda no terminal e mostra a saída', async () => {
	const app = render(<App cwd={root} />);
	await settle();
	await type(app, '!echo ola-do-terminal');
	await type(app, '\r');
	const frame = await waitFor(app, screen => screen.includes('ola-do-terminal') && !screen.includes('!echo'));
	assert.match(frame, /\$ echo ola-do-terminal/);
	app.unmount();
});

test('esc fecha a lista de provedores; servidores locais aparecem como "local"', async () => {
	const app = render(<App cwd={root} />);
	await settle();
	await type(app, '/connect');
	await type(app, '\r');
	const frame = app.lastFrame() ?? '';
	assert.match(frame, /Conectar provedor/);
	assert.match(frame, /Ollama \(local\)\s+local/);
	assert.match(frame, /NVIDIA/);
	app.stdin.write('\u001b');
	await sleep(200);
	assert.ok(!(app.lastFrame() ?? '').includes('Conectar provedor'));
	app.unmount();
});

test('a chave colada fica mascarada', async () => {
	const app = render(<App cwd={root} />);
	await settle();
	await type(app, '/connect');
	await type(app, '\r');
	await type(app, 'anthropic');
	await type(app, '\r');
	await type(app, 'sk-ant-SEGREDO-0000');
	const frame = app.lastFrame() ?? '';
	assert.match(frame, /Chave de Anthropic/);
	assert.ok(!frame.includes('SEGREDO'), 'a chave apareceu em texto puro');
	assert.ok(frame.includes('•'));
	app.unmount();
});

test('/themes escolhe o tema e salva', async () => {
	const app = render(<App cwd={root} />);
	await settle();
	await type(app, '/themes');
	await type(app, '\r');
	assert.match(app.lastFrame() ?? '', /Temas/);
	await type(app, '\u001b[B');
	await type(app, '\r');
	assert.equal(config.read().theme, 'terminal');
	app.unmount();
});

/** A model on a real local HTTP server: first asks to write a file, then answers. */
async function fakeModel(): Promise<{server: Server; url: string}> {
	const server = createServer((request, response) => {
		let body = '';
		request.on('data', chunk => (body += chunk));
		request.on('end', () => {
			response.writeHead(200, {'Content-Type': 'text/event-stream'});
			const send = (delta: unknown) => response.write(`data: ${JSON.stringify({choices: [{delta}]})}\n\n`);
			const parsed = JSON.parse(body || '{}') as {messages?: Array<{role: string}>};
			if (!parsed.messages?.some(message => message.role === 'tool')) {
				send({tool_calls: [{index: 0, id: 'c1', function: {name: 'write_file', arguments: JSON.stringify({path: 'novo.txt', content: 'criado pelo agente'})}}]});
			} else {
				send({content: 'Pronto, **arquivo criado**.'});
			}
			response.end('data: [DONE]\n\n');
		});
	});
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
	const address = server.address();
	return {server, url: `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/v1`};
}

test('de ponta a ponta: pede aprovação, grava, responde e /undo desfaz o arquivo', async () => {
	const {server, url} = await fakeModel();
	try {
		config.write({...DEFAULT_CONFIG, provider: 'custom-teste', model: 'modelo-falso', custom: [{id: 'custom-teste', label: 'Teste', kind: 'openai', baseUrl: url, keyless: true}]});
		const app = render(<App cwd={root} />);
		await settle();
		await type(app, 'crie novo.txt');
		await type(app, '\r');

		await waitFor(app, frame => frame.includes('Permitir esta ação?'));
		assert.ok(!existsSync(join(root, 'novo.txt')), 'gravou antes da aprovação');
		await type(app, 's');

		const frame = await waitFor(app, screen => screen.includes('arquivo criado') && screen.includes('▣'));
		assert.equal(readFileSync(join(root, 'novo.txt'), 'utf8'), 'criado pelo agente');
		assert.match(frame, /← Gravar novo\.txt/);
		assert.match(frame, /▣ Construir · modelo-falso/);
		assert.ok(!frame.includes('**'), 'o markdown não foi interpretado');

		await type(app, '/undo');
		await type(app, '\r');
		await waitFor(app, screen => screen.includes('Desfeito'));
		assert.ok(!existsSync(join(root, 'novo.txt')), '/undo não removeu o arquivo criado');
		assert.match(app.lastFrame() ?? '', /crie novo\.txt/);
		app.unmount();
	} finally {
		server.close();
	}
});
