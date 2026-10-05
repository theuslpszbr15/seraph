import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach, beforeEach, test} from 'node:test';
import {render} from 'ink-testing-library';
import React from 'react';
import {App} from '../src/App.tsx';

let home = '';
const previous = process.env['SERAPH_HOME'];

// A fresh folder per test: settings such as the mode persist, and must not leak between tests.
beforeEach(() => {
	home = mkdtempSync(join(tmpdir(), 'seraph-ui-'));
	process.env['SERAPH_HOME'] = home;
});

afterEach(() => {
	if (previous === undefined) delete process.env['SERAPH_HOME'];
	else process.env['SERAPH_HOME'] = previous;
	rmSync(home, {recursive: true, force: true});
});

const settle = () => new Promise(resolve => setTimeout(resolve, 60));
const PROJECT = 'C:\\projeto';

test('tela inicial: anjo, nome, prompt e dicas', async () => {
	const app = render(<App cwd={PROJECT} />);
	await settle();
	const frame = app.lastFrame() ?? '';
	assert.ok(frame.includes('███████╗'), 'wordmark SERAPH ausente');
	assert.ok(frame.includes('▄▄▀▀▀'), 'anjo ausente');
	assert.match(frame, /Construir/);
	assert.match(frame, /nenhum modelo/);
	assert.match(frame, /ctrl\+p/);
	assert.ok(frame.includes(PROJECT));
	app.unmount();
});

test('digitar "/" mostra os comandos e "/mo" filtra', async () => {
	const app = render(<App cwd="C:\\p" />);
	await settle();
	app.stdin.write('/');
	await settle();
	assert.match(app.lastFrame() ?? '', /conectar provedor/);
	app.stdin.write('mo');
	await settle();
	const frame = app.lastFrame() ?? '';
	assert.match(frame, /escolher o modelo/);
	assert.ok(!frame.includes('conectar provedor'));
	app.unmount();
});

test('tab alterna Construir e Planejar', async () => {
	const app = render(<App cwd="C:\\p" />);
	await settle();
	assert.match(app.lastFrame() ?? '', /Construir/);
	app.stdin.write('\t');
	await settle();
	assert.match(app.lastFrame() ?? '', /Planejar/);
	app.unmount();
});

test('mensagem sem provedor conectado orienta para /connect em vez de falhar', async () => {
	const app = render(<App cwd="C:\\p" />);
	await settle();
	app.stdin.write('oi');
	await settle();
	app.stdin.write('\r');
	await settle();
	assert.match(app.lastFrame() ?? '', /\/connect/);
	app.unmount();
});

test('esc fecha a lista de provedores e devolve o prompt', async () => {
	const app = render(<App cwd={PROJECT} />);
	await settle();
	app.stdin.write('/connect');
	await settle();
	app.stdin.write('\r');
	await settle();
	assert.match(app.lastFrame() ?? '', /Conectar provedor/);
	app.stdin.write('\u001b');
	await new Promise(resolve => setTimeout(resolve, 200));
	const frame = app.lastFrame() ?? '';
	assert.ok(!frame.includes('Conectar provedor'));
	assert.match(frame, /Construir/);
	app.unmount();
});

test('/connect: servidores locais aparecem como "local", não como "conectado"', async () => {
	const app = render(<App cwd={PROJECT} />);
	await settle();
	app.stdin.write('/connect');
	await settle();
	app.stdin.write('\r');
	await settle();
	const frame = app.lastFrame() ?? '';
	assert.match(frame, /Ollama \(local\)\s+local/);
	assert.ok(!/Ollama[^\n]*conectado/.test(frame));
	app.unmount();
});

test('/connect abre a lista e a chave colada fica mascarada', async () => {
	const app = render(<App cwd="C:\\p" />);
	await settle();
	app.stdin.write('/connect');
	await settle();
	app.stdin.write('\r');
	await settle();
	assert.match(app.lastFrame() ?? '', /Conectar provedor/);
	assert.match(app.lastFrame() ?? '', /GitHub Copilot/);
	app.stdin.write('anthropic');
	await settle();
	app.stdin.write('\r');
	await settle();
	app.stdin.write('sk-ant-SEGREDO-0000');
	await settle();
	const frame = app.lastFrame() ?? '';
	assert.match(frame, /Chave de Anthropic/);
	assert.ok(!frame.includes('SEGREDO'), 'a chave apareceu em texto puro');
	assert.ok(frame.includes('•'));
	app.unmount();
});
