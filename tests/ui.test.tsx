import assert from 'node:assert/strict';
import {createServer, type Server} from 'node:http';
import {existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {after, afterEach, before, beforeEach, test} from 'node:test';
import {render} from 'ink-testing-library';
import React from 'react';
import {App} from '../src/App.tsx';
import {config, DEFAULT_CONFIG} from '../src/registry.ts';
import {newSession} from '../src/sessions.ts';
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

async function waitFor(app: Rendered, predicate: (frame: string) => boolean, ms = 20_000): Promise<string> {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		const frame = app.lastFrame() ?? '';
		if (predicate(frame)) {
			// A dialog draws before its key listener subscribes; typing at once could be lost.
			await settle();
			return frame;
		}
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

test('logo completo mostra somente o nome, sem anjo', () => {
	const app = render(<Logo theme={themeById('seraph')} columns={100} size="full" />);
	const frame = app.lastFrame() ?? '';
	assert.ok(!frame.includes('▄▄▀▀▀'), 'o anjo nao deve aparecer');
	assert.ok(frame.includes('███████╗'));
	app.unmount();
});

test('ampliar a janela mantem apenas o nome e nao corta o prompt', async () => {
	const app = render(<App cwd={root} />);
	await settle();
	Object.defineProperty(app.stdout, 'rows', {value: 50, configurable: true});
	app.stdout.emit('resize');
	await settle();
	let frame = app.lastFrame() ?? '';
	assert.ok(!/[\u2801-\u28ff]/.test(frame));
	assert.ok(!frame.includes('▄▄▀▀▀'));
	assert.match(frame, /Pergunte qualquer coisa/);
	assert.ok(frame.split('\n').length <= 49);
	Object.defineProperty(app.stdout, 'rows', {value: 30, configurable: true});
	app.stdout.emit('resize');
	await settle();
	frame = app.lastFrame() ?? '';
	assert.ok(!/[\u2801-\u28ff]/.test(frame));
	assert.match(frame, /Pergunte qualquer coisa/);
	assert.ok(frame.split('\n').length <= 29);
	app.unmount();
});

test('logo usa nome simples quando a janela e estreita', () => {
	const app = render(<Logo theme={themeById('seraph')} columns={30} size="full" />);
	const frame = app.lastFrame() ?? '';
	assert.ok(!/[\u2801-\u28ff]/.test(frame));
	assert.ok(!frame.includes('▄▄▀▀▀'));
	assert.match(frame, /SERAPH/);
	app.unmount();
});

test('conversa longa mantém o campo visível e aceita digitação', async () => {
	const session = newSession(root);
	session.messages = Array.from({length: 50}, (_, index) => ({role: 'assistant' as const, content: `Resposta ${index}: ${'texto da conversa '.repeat(20)}`}));
	const app = render(<App cwd={root} initialSession={session} />);
	await settle();
	assert.match(app.lastFrame() ?? '', /Pergunte qualquer coisa/);
	await type(app, 'posso escrever aqui');
	assert.match(app.lastFrame() ?? '', /posso escrever aqui/);
	assert.ok((app.lastFrame() ?? '').split('\n').length <= 29);
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

test('ctrl+s libera selecao nativa, congela a tela e esc restaura o mouse', async () => {
	const app = render(<App cwd={root} />);
	await settle();
	await type(app, '\u0013');
	assert.ok(app.frames.some(frame => frame.includes('\u001b[?1000l\u001b[?1006l')));
	const frame = app.lastFrame();
	await type(app, 'nao digitar durante selecao');
	assert.equal(app.lastFrame(), frame);
	app.stdin.write('\u001b');
	await sleep(200);
	assert.ok(app.frames.some(frame => frame.includes('\u001b[?1000h\u001b[?1006h')));
	await type(app, 'digitacao restaurada');
	assert.match(app.lastFrame() ?? '', /digitacao restaurada/);
	app.unmount();
});

test('clicar em sair encerra a interface; clicar fora nao encerra', async () => {
	let exited = false;
	function ExitProbe() {
		React.useEffect(() => () => { exited = true; }, []);
		return null;
	}
	const app = render(<><App cwd={root} /><ExitProbe /></>);
	await settle();
	await type(app, '\u001b[<0;10;29M');
	assert.equal(exited, false);
	await type(app, '\u001b[<0;95;29M');
	assert.equal(exited, true, 'o clique no botao nao encerrou o aplicativo');
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

type Sent = {role: string; content?: string | null};
type Reply = {send: (delta: unknown) => void; end: () => void; rateLimit: () => void};

/** A model on a real local HTTP server; each test scripts what it answers and sees what it received. */
async function fakeServer(answer: (messages: Sent[], reply: Reply, call: number) => void | Promise<void>): Promise<{server: Server; url: string; received: Sent[][]}> {
	const received: Sent[][] = [];
	const server = createServer((request, response) => {
		let body = '';
		request.on('data', chunk => (body += chunk));
		request.on('end', () => {
			const messages = ((JSON.parse(body || '{}') as {messages?: Sent[]}).messages ?? []).map(message => ({role: message.role, content: message.content}));
			received.push(messages);
			response.setHeader('Content-Type', 'text/event-stream');
			const reply: Reply = {
				send: delta => response.write(`data: ${JSON.stringify({choices: [{delta}]})}\n\n`),
				end: () => response.end('data: [DONE]\n\n'),
				rateLimit: () => {
					response.writeHead(429, {'Content-Type': 'application/json', 'Retry-After': '60'});
					response.end('{"title":"Too Many Requests"}');
				},
			};
			void answer(messages, reply, received.length);
		});
	});
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
	const address = server.address();
	return {server, url: `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/v1`, received};
}

function useServer(url: string) {
	config.write({...DEFAULT_CONFIG, provider: 'custom-teste', model: 'modelo-falso', custom: [{id: 'custom-teste', label: 'Teste', kind: 'openai', baseUrl: url, keyless: true}]});
}

function savedSessions(): Array<{messages: Sent[]}> {
	const folder = join(home, 'sessions');
	if (!existsSync(folder)) return [];
	return readdirSync(folder)
		.filter(name => name.endsWith('.json'))
		.map(name => JSON.parse(readFileSync(join(folder, name), 'utf8')) as {messages: Sent[]});
}

/** First asks to write a file, then answers. */
const writesThenAnswers = (messages: Sent[], reply: Reply) => {
	if (!messages.some(message => message.role === 'tool')) {
		reply.send({tool_calls: [{index: 0, id: 'c1', function: {name: 'write_file', arguments: JSON.stringify({path: 'novo.txt', content: 'criado pelo agente'})}}]});
	} else {
		reply.send({content: 'Pronto, **arquivo criado**.'});
	}
	reply.end();
};

test('de ponta a ponta: o modelo recebe a mensagem, pede aprovação, grava, responde, salva e /undo desfaz', async () => {
	const {server, url, received} = await fakeServer(writesThenAnswers);
	try {
		useServer(url);
		const app = render(<App cwd={root} />);
		await settle();
		await type(app, 'crie novo.txt');
		await type(app, '\r');

		await waitFor(app, frame => frame.includes('Permitir esta ação?'));
		assert.deepEqual(
			received[0]?.filter(message => message.role === 'user').map(message => message.content),
			['crie novo.txt'],
			'a mensagem digitada não chegou ao modelo',
		);
		assert.ok(!existsSync(join(root, 'novo.txt')), 'gravou antes da aprovação');
		await type(app, 's');

		const frame = await waitFor(app, screen => screen.includes('arquivo criado') && screen.includes('▣'));
		assert.equal(readFileSync(join(root, 'novo.txt'), 'utf8'), 'criado pelo agente');
		assert.match(frame, /← Gravar novo\.txt/);
		assert.match(frame, /▣ Construir · modelo-falso/);
		assert.ok(!frame.includes('**'), 'o markdown não foi interpretado');
		assert.deepEqual(
			savedSessions()[0]?.messages.map(message => message.role),
			['user', 'assistant', 'tool', 'assistant'],
			'a conversa não ficou salva completa',
		);

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

test('a segunda mensagem leva a primeira conversa junto', async () => {
	const {server, url, received} = await fakeServer((_messages, reply, call) => {
		reply.send({content: `resposta ${call}`});
		reply.end();
	});
	try {
		useServer(url);
		const app = render(<App cwd={root} />);
		await settle();
		await type(app, 'primeira');
		await type(app, '\r');
		await waitFor(app, screen => screen.includes('resposta 1'));
		await type(app, 'segunda');
		await type(app, '\r');
		await waitFor(app, screen => screen.includes('resposta 2'));
		assert.deepEqual(
			received[1]?.filter(message => message.role !== 'system').map(message => `${message.role}:${message.content}`),
			['user:primeira', 'assistant:resposta 1', 'user:segunda'],
		);
		app.unmount();
	} finally {
		server.close();
	}
});

test('esc no meio da resposta: o que já veio fica salvo e entra no contexto da próxima', async () => {
	const {server, url, received} = await fakeServer((_messages, reply, call) => {
		if (call === 1) return reply.send({content: 'metade da resposta'});
		reply.send({content: 'ok'});
		reply.end();
	});
	try {
		useServer(url);
		const app = render(<App cwd={root} />);
		await settle();
		await type(app, 'conte uma história');
		await type(app, '\r');
		await waitFor(app, screen => screen.includes('metade da resposta'));
		app.stdin.write('\u001b');
		await waitFor(app, screen => screen.includes('interrompido'));
		const saved = savedSessions()[0]?.messages ?? [];
		assert.equal(saved[0]?.content, 'conte uma história');
		assert.match(saved[1]?.content ?? '', /metade da resposta[\s\S]*\[resposta interrompida\]/);

		await type(app, 'continue');
		await type(app, '\r');
		await waitFor(app, screen => /▣[^\n]*\n[\s\S]*▣/.test(screen));
		assert.ok(received[1]?.some(message => message.content?.includes('metade da resposta')), 'a parte interrompida sumiu do contexto');
		app.unmount();
	} finally {
		server.closeAllConnections();
		server.close();
	}
});

test('ctrl+c durante o pedido de aprovação encerra o turno em vez de travar', async () => {
	const {server, url} = await fakeServer(writesThenAnswers);
	try {
		useServer(url);
		const app = render(<App cwd={root} />);
		await settle();
		await type(app, 'crie novo.txt');
		await type(app, '\r');
		await waitFor(app, frame => frame.includes('Permitir esta ação?'));
		app.stdin.write('\u0003');
		const frame = await waitFor(app, screen => screen.includes('interrompido'));
		assert.ok(!frame.includes('Permitir esta ação?'));
		assert.match(frame, /Pergunte qualquer coisa/, 'o campo de mensagem não voltou');
		assert.ok(!existsSync(join(root, 'novo.txt')));
		app.unmount();
	} finally {
		server.close();
	}
});

test('mensagem enviada durante uma resposta entra na fila e vai depois', async () => {
	let finishFirst: (() => void) | undefined;
	const {server, url, received} = await fakeServer((_messages, reply, call) => {
		if (call === 1) {
			reply.send({content: 'primeira resposta'});
			finishFirst = () => reply.end();
			return;
		}
		reply.send({content: 'segunda resposta'});
		reply.end();
	});
	try {
		useServer(url);
		const session = newSession(root);
		session.messages = Array.from({length: 50}, (_, index) => ({role: 'assistant' as const, content: `Resposta anterior ${index}: ${'texto '.repeat(40)}`}));
		const app = render(<App cwd={root} initialSession={session} />);
		await settle();
		await type(app, 'um');
		await type(app, '\r');
		await waitFor(app, screen => screen.includes('primeira resposta'));
		assert.match(app.lastFrame() ?? '', /escreva a próxima mensagem/);
		await type(app, 'dois');
		await type(app, '\r');
		assert.match(app.lastFrame() ?? '', /na fila: dois/);
		assert.equal(received.length, 1, 'enviou antes da hora');
		finishFirst?.();
		await waitFor(app, screen => screen.includes('segunda resposta'));
		assert.ok(!(app.lastFrame() ?? '').includes('na fila'));
		app.unmount();
	} finally {
		server.close();
	}
});

test('429 pausa a fila sem apagar mensagens e bloqueia nova chamada durante a espera', async () => {
	let rejectFirst: (() => void) | undefined;
	const {server, url, received} = await fakeServer((_messages, reply) => { rejectFirst = reply.rateLimit; });
	try {
		useServer(url);
		const app = render(<App cwd={root} />);
		await settle();
		await type(app, 'primeira\r');
		await waitFor(app, () => received.length === 1);
		await type(app, 'segunda\r');
		assert.match(app.lastFrame() ?? '', /na fila: segunda/);
		rejectFirst?.();
		await waitFor(app, frame => frame.includes('Fila pausada por 429'));
		assert.match(app.lastFrame() ?? '', /na fila: segunda/);
		await type(app, 'tentar de novo\r');
		assert.equal(received.length, 1);
		assert.match(app.lastFrame() ?? '', /Provedor em pausa por 429/);
		assert.match(app.lastFrame() ?? '', /tentar de novo/);
		app.unmount();
	} finally {
		server.closeAllConnections();
		server.close();
	}
});

test('colar várias linhas (bracketed paste) não envia; o texto fica no campo', async () => {
	const app = render(<App cwd={root} />);
	await settle();
	await type(app, '\u001b[200~linha um\rlinha dois\r\u001b[201~');
	const frame = app.lastFrame() ?? '';
	assert.match(frame, /linha um/);
	assert.match(frame, /linha dois/);
	// Sending anything (even a "connect first" notice) leaves the home screen.
	assert.match(frame, /o harness que voa/, 'a colagem foi enviada como mensagem');
	app.unmount();
});

test('/help cabe na janela e filtra', async () => {
	const app = render(<App cwd={root} />);
	await settle();
	await type(app, '/help');
	await type(app, '\r');
	let frame = app.lastFrame() ?? '';
	assert.match(frame, /Ajuda/);
	assert.ok(frame.split('\n').length <= 29, `a ajuda tem ${frame.split('\n').length} linhas`);
	await type(app, 'undo');
	frame = app.lastFrame() ?? '';
	assert.match(frame, /\/undo/);
	assert.ok(!frame.includes('/connect'));
	app.unmount();
});

test('numa lista, texto e Enter no mesmo pedaço escolhem o primeiro resultado', async () => {
	const app = render(<App cwd={root} />);
	await settle();
	await type(app, '/help');
	await type(app, '\r');
	await type(app, 'undo\r');
	assert.match(app.lastFrame() ?? '', /Nada para desfazer/);
	app.unmount();
});
