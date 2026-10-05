import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {runTurn} from '../src/agent.ts';
import {blocksFromMessages} from '../src/App.tsx';
import {parseArgs} from '../src/args.ts';
import {applyArguments, loadCustomCommands, parseCommandFile} from '../src/customCommands.ts';
import {completeMention, expandMentions, matchFiles, mentionQuery} from '../src/files.ts';
import {contextOf} from '../src/providers/openai.ts';
import {customThemes, THEMES} from '../src/themes.ts';
import {toolLabel} from '../src/ui/Blocks.tsx';
import {formatElapsed, formatTokens, logoSizeFor, relativeTime, shortPath} from '../src/ui/fit.ts';
import {inlineSpans, splitParts} from '../src/ui/Markdown.tsx';
import {mouseClick, mouseWheel} from '../src/ui/terminal.ts';
import type {ChatResult, Provider} from '../src/types.ts';

const temp = (prefix: string) => mkdtempSync(join(tmpdir(), prefix));

test('temas: ids únicos e todas as cores em #rrggbb', () => {
	const ids = THEMES.map(theme => theme.id);
	assert.equal(new Set(ids).size, ids.length);
	assert.equal(THEMES[0]?.id, 'seraph');
	for (const theme of THEMES) {
		for (const [key, value] of Object.entries(theme)) {
			if (key === 'id' || key === 'label' || (key === 'bg' && value === undefined)) continue;
			assert.match(String(value), /^#[0-9a-f]{6}$/i, `${theme.id}.${key}`);
		}
	}
});

test('temas: arquivo do usuário completa o que falta e ignora cor inválida', () => {
	const home = temp('seraph-theme-');
	try {
		mkdirSync(join(home, 'themes'));
		writeFileSync(join(home, 'themes', 'Meu.json'), JSON.stringify({label: 'Meu', primary: '#123456', bg: 'vermelho'}));
		writeFileSync(join(home, 'themes', 'quebrado.json'), '{');
		const [mine] = customThemes(home);
		assert.equal(mine?.id, 'meu');
		assert.equal(mine?.primary, '#123456');
		assert.equal(mine?.bg, '#0a0a0a');
	} finally {
		rmSync(home, {recursive: true, force: true});
	}
});

test('markdown: negrito, código e itálico; bloco de código ainda aberto', () => {
	assert.deepEqual(inlineSpans('use **npm** e `test` *já*'), [
		{text: 'use '},
		{text: 'npm', bold: true},
		{text: ' e '},
		{text: 'test', code: true},
		{text: ' '},
		{text: 'já', italic: true},
	]);
	assert.deepEqual(inlineSpans('2 * 3 * 4'), [{text: '2 * 3 * 4'}]);
	const parts = splitParts('antes\n```ts\nconst a = 1;\n');
	assert.deepEqual(parts.at(-1), {kind: 'code', lang: 'ts', lines: ['const a = 1;', '']});
});

test('arquivos: @ no fim do texto, ranking por nome e anexo só dentro do projeto', () => {
	assert.equal(mentionQuery('leia @src/ap'), 'src/ap');
	assert.equal(mentionQuery('email@dominio'), undefined);
	assert.equal(mentionQuery('fim @a b'), undefined);
	assert.deepEqual(matchFiles(['docs/app.md', 'src/app.ts', 'src/happy.ts'], 'app'), ['src/app.ts', 'docs/app.md', 'src/happy.ts']);
	assert.equal(completeMention('leia @sr', 'src/app.ts'), 'leia @src/app.ts ');

	const root = temp('seraph-mention-');
	try {
		writeFileSync(join(root, 'a.txt'), 'conteudo A', 'utf8');
		const {prompt, attached} = expandMentions('veja @a.txt e @../fora.txt e @nao-existe', root);
		assert.deepEqual(attached, ['a.txt']);
		assert.match(prompt, /<arquivo caminho="a.txt">\nconteudo A\n<\/arquivo>/);
		assert.ok(prompt.startsWith('veja @a.txt'));
	} finally {
		rmSync(root, {recursive: true, force: true});
	}
});

test('comandos personalizados: descrição, argumentos e o projeto sobrepõe o global', () => {
	const command = parseCommandFile('revisar', '---\ndescription: revisa um arquivo\n---\nRevise $1 com foco em $ARGUMENTS\n');
	assert.equal(command.hint, 'revisa um arquivo');
	assert.equal(applyArguments(command.template, '"src/a b.ts" bugs'), 'Revise src/a b.ts com foco em "src/a b.ts" bugs');

	const home = temp('seraph-cmd-home-');
	const project = temp('seraph-cmd-proj-');
	try {
		mkdirSync(join(home, 'commands'));
		mkdirSync(join(project, '.seraph', 'commands'), {recursive: true});
		writeFileSync(join(home, 'commands', 'oi.md'), 'global');
		writeFileSync(join(project, '.seraph', 'commands', 'oi.md'), 'do projeto');
		writeFileSync(join(home, 'commands', 'Nome Invalido.md'), 'x');
		assert.deepEqual(
			loadCustomCommands(project, home).map(item => [item.name, item.template]),
			[['oi', 'do projeto']],
		);
	} finally {
		rmSync(home, {recursive: true, force: true});
		rmSync(project, {recursive: true, force: true});
	}
});

test('mouse: roda para cima/baixo, clique e texto comum', () => {
	assert.equal(mouseWheel('[<64;10;5M'), 1);
	assert.equal(mouseWheel('\u001b[<65;1;1M\u001b[<65;1;1M'), -2);
	assert.equal(mouseWheel('[<0;3;4M'), 0);
	assert.equal(mouseWheel('oi'), undefined);
	assert.deepEqual(mouseClick('[<0;95;29M'), {x: 95, y: 29});
	assert.equal(mouseClick('[<0;95;29m'), undefined);
});

test('formatação: tempo, tokens, caminho e datas relativas', () => {
	assert.equal(formatElapsed(75), '1min 15s');
	assert.equal(formatTokens(950), '950');
	assert.equal(formatTokens(12_345), '12k');
	assert.equal(formatTokens(1_500), '1.5k');
	assert.equal(shortPath('C:\\Users\\eu\\proj', 'C:\\Users\\eu'), '~\\proj');
	assert.equal(relativeTime(new Date(Date.now() - 3 * 3600_000).toISOString()), '3 h');
	assert.equal(logoSizeFor(50), 'full');
	assert.equal(logoSizeFor(30), 'name');
	assert.equal(logoSizeFor(15), 'mini');
});

test('argumentos da linha de comando', () => {
	assert.deepEqual(parseArgs(['pasta', '-c']), {folder: 'pasta', continue: true, version: false, help: false});
	assert.equal(parseArgs(['-s', 'abc']).session, 'abc');
	assert.match(parseArgs(['-s']).error ?? '', /Falta o id/);
	assert.match(parseArgs(['--xyz']).error ?? '', /desconhecida/);
});

test('contexto do modelo vem do campo que cada servidor usa', () => {
	assert.equal(contextOf({id: 'a', capabilities: {limits: {max_context_window_tokens: 128_000}}}), 128_000);
	assert.equal(contextOf({id: 'b', context_length: 32_768}), 32_768);
	assert.equal(contextOf({id: 'c'}), undefined);
});

test('linhas de ferramenta no estilo do OpenCode', () => {
	assert.deepEqual(toolLabel('read_file', 'ler src/a.ts'), {icon: '→', text: 'Ler src/a.ts'});
	assert.deepEqual(toolLabel('edit_file', 'editar b.ts'), {icon: '←', text: 'Editar b.ts'});
	assert.deepEqual(toolLabel('bash', '$ npm test'), {icon: '$', text: 'npm test'});
});

test('conversa salva vira blocos na tela, sem o conteúdo dos anexos', () => {
	const blocks = blocksFromMessages([
		{role: 'user', content: 'veja @a.txt\n\n<arquivo caminho="a.txt">\nsegredo\n</arquivo>'},
		{role: 'assistant', content: '', toolCalls: [{id: '1', name: 'read_file', arguments: '{"path":"a.txt"}'}]},
		{role: 'tool', content: 'saída', toolCallId: '1'},
		{role: 'assistant', content: 'feito'},
	]);
	assert.deepEqual(
		blocks.map(block => block.kind),
		['user', 'tool', 'assistant'],
	);
	assert.equal(blocks[0]?.kind === 'user' ? blocks[0].text : '', 'veja @a.txt');
});

test('agente avisa o caminho antes de gravar, para o /undo guardar o original', async () => {
	const root = temp('seraph-undo-');
	try {
		writeFileSync(join(root, 'x.txt'), 'original', 'utf8');
		const results: ChatResult[] = [
			{text: '', toolCalls: [{id: 'a', name: 'edit_file', arguments: JSON.stringify({path: 'x.txt', old: 'original', new: 'novo'})}]},
			{text: 'ok', toolCalls: []},
		];
		let step = 0;
		const provider: Provider = {id: 'f', chat: async () => results[step++] ?? {text: '', toolCalls: []}, listModels: async () => []};
		const seen: string[] = [];
		await runTurn({
			provider,
			model: 'm',
			mode: 'build',
			history: [],
			root,
			signal: new AbortController().signal,
			approve: async () => true,
			onEvent: () => undefined,
			onBeforeWrite: path => seen.push(path),
		});
		assert.deepEqual(seen, [join(root, 'x.txt')]);
	} finally {
		rmSync(root, {recursive: true, force: true});
	}
});
