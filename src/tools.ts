import {spawn} from 'node:child_process';
import {mkdirSync, readdirSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {dirname, isAbsolute, join, relative, resolve, sep} from 'node:path';
import type {ToolSchema} from './types.js';

const MAX_OUTPUT = 40_000;
const MAX_FILE = 200_000;
const BASH_TIMEOUT_MS = 120_000;
const SKIPPED = new Set(['node_modules', '.git', 'dist', '.seraph']);

export type Tool = ToolSchema & {
	/** Reads never ask for permission; anything that changes the disk does. */
	mutating: boolean;
	summarize: (args: Record<string, unknown>) => string;
	run: (args: Record<string, unknown>, root: string, signal: AbortSignal) => Promise<string>;
};

function text(args: Record<string, unknown>, key: string): string {
	const value = args[key];
	if (typeof value !== 'string') throw new Error(`Falta o argumento "${key}".`);
	return value;
}

/** A path outside the working folder is refused, including ../ and absolute escapes. */
export function inside(root: string, input: string): string {
	const target = resolve(root, input);
	const rel = relative(resolve(root), target);
	if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
		throw new Error(`Caminho fora da pasta de trabalho: ${input}`);
	}
	return target;
}

export function clip(output: string): string {
	if (output.length <= MAX_OUTPUT) return output;
	return `${output.slice(0, MAX_OUTPUT)}\n\n[… cortado: ${output.length - MAX_OUTPUT} caracteres a mais]`;
}

function walk(folder: string, root: string, found: string[], limit: number): void {
	for (const entry of readdirSync(folder, {withFileTypes: true})) {
		if (found.length >= limit) return;
		if (SKIPPED.has(entry.name)) continue;
		const full = join(folder, entry.name);
		if (entry.isDirectory()) walk(full, root, found, limit);
		else found.push(relative(root, full));
	}
}

// Windows PowerShell 5.1 writes in the console code page, which turns every accent into garbage.
const POWERSHELL_PREAMBLE = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; $OutputEncoding=[Text.Encoding]::UTF8; $ProgressPreference='SilentlyContinue'; ";

export function runShell(command: string, root: string, signal: AbortSignal, timeoutMs = BASH_TIMEOUT_MS): Promise<string> {
	return new Promise(resolvePromise => {
		const isWindows = process.platform === 'win32';
		const child = spawn(
			isWindows ? 'powershell.exe' : 'sh',
			isWindows ? ['-NoProfile', '-NonInteractive', '-Command', POWERSHELL_PREAMBLE + command] : ['-c', command],
			// No stdin: a command waiting for input would otherwise hang until the timeout.
			{cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']},
		);
		let output = '';
		const append = (chunk: Buffer) => {
			if (output.length < MAX_OUTPUT * 2) output += chunk.toString('utf8');
		};
		child.stdout.on('data', append);
		child.stderr.on('data', append);

		let timedOut = false;
		const stop = () => child.kill();
		signal.addEventListener('abort', stop, {once: true});
		const timer = setTimeout(() => {
			timedOut = true;
			stop();
		}, timeoutMs);

		child.on('close', code => {
			clearTimeout(timer);
			signal.removeEventListener('abort', stop);
			const body = output.trim() || '(sem saída)';
			if (timedOut) {
				resolvePromise(
					`${body}\n[encerrado: passou de ${Math.round(timeoutMs / 1000)} s. Use um comando mais rápido, por exemplo sem -Recurse em pastas grandes, ou confira se o caminho existe.]`,
				);
			} else if (signal.aborted) resolvePromise(`${body}\n[interrompido pelo usuário]`);
			else resolvePromise(`${body}\n[código de saída ${code ?? '?'}]`);
		});
		child.on('error', error => {
			clearTimeout(timer);
			resolvePromise(`Não foi possível executar: ${error.message}`);
		});
	});
}

export const TOOLS: Tool[] = [
	{
		name: 'read_file',
		description: 'Lê um arquivo de texto da pasta de trabalho. Aceita offset e limit (em linhas) para arquivos grandes.',
		parameters: {
			type: 'object',
			properties: {
				path: {type: 'string'},
				offset: {type: 'number', description: 'Primeira linha (começa em 1).'},
				limit: {type: 'number', description: 'Quantas linhas ler.'},
			},
			required: ['path'],
		},
		mutating: false,
		summarize: args => `ler ${String(args['path'] ?? '')}`,
		async run(args, root) {
			const path = inside(root, text(args, 'path'));
			if (statSync(path).size > MAX_FILE * 5) throw new Error('Arquivo grande demais. Use offset e limit.');
			const lines = readFileSync(path, 'utf8').split('\n');
			const start = Math.max(Number(args['offset'] ?? 1), 1) - 1;
			const end = args['limit'] ? start + Number(args['limit']) : lines.length;
			return clip(
				lines
					.slice(start, end)
					.map((line, index) => `${String(start + index + 1).padStart(5)}  ${line}`)
					.join('\n'),
			);
		},
	},
	{
		name: 'list_directory',
		description: 'Lista os arquivos e pastas de uma pasta (padrão: a raiz do projeto).',
		parameters: {type: 'object', properties: {path: {type: 'string'}}},
		mutating: false,
		summarize: args => `listar ${String(args['path'] ?? '.')}`,
		async run(args, root) {
			const folder = inside(root, typeof args['path'] === 'string' ? args['path'] : '.');
			const rows = readdirSync(folder, {withFileTypes: true})
				.filter(entry => !SKIPPED.has(entry.name))
				.map(entry => `${entry.isDirectory() ? 'pasta  ' : 'arquivo'} ${entry.name}`);
			return rows.length > 0 ? rows.join('\n') : '(vazia)';
		},
	},
	{
		name: 'search_files',
		description: 'Procura um texto dentro dos arquivos do projeto e devolve arquivo:linha: trecho.',
		parameters: {
			type: 'object',
			properties: {query: {type: 'string'}, path: {type: 'string'}},
			required: ['query'],
		},
		mutating: false,
		summarize: args => `buscar "${String(args['query'] ?? '')}"`,
		async run(args, root) {
			const query = text(args, 'query').toLowerCase();
			const base = inside(root, typeof args['path'] === 'string' ? args['path'] : '.');
			const files: string[] = [];
			walk(base, root, files, 2000);
			const hits: string[] = [];
			for (const file of files) {
				if (hits.length >= 200) break;
				let content: string;
				try {
					const full = join(root, file);
					if (statSync(full).size > MAX_FILE) continue;
					content = readFileSync(full, 'utf8');
				} catch {
					continue;
				}
				if (content.includes('\u0000')) continue;
				content.split('\n').forEach((line, index) => {
					if (hits.length < 200 && line.toLowerCase().includes(query)) hits.push(`${file}:${index + 1}: ${line.trim().slice(0, 160)}`);
				});
			}
			return hits.length > 0 ? clip(hits.join('\n')) : 'Nenhum resultado.';
		},
	},
	{
		name: 'write_file',
		description: 'Cria ou substitui um arquivo inteiro.',
		parameters: {
			type: 'object',
			properties: {path: {type: 'string'}, content: {type: 'string'}},
			required: ['path', 'content'],
		},
		mutating: true,
		summarize: args => `gravar ${String(args['path'] ?? '')}`,
		async run(args, root) {
			const path = inside(root, text(args, 'path'));
			mkdirSync(dirname(path), {recursive: true});
			writeFileSync(path, text(args, 'content'), 'utf8');
			return `Gravado: ${relative(root, path)}`;
		},
	},
	{
		name: 'edit_file',
		description: 'Troca um trecho exato de um arquivo. O trecho antigo precisa aparecer uma única vez.',
		parameters: {
			type: 'object',
			properties: {path: {type: 'string'}, old: {type: 'string'}, new: {type: 'string'}},
			required: ['path', 'old', 'new'],
		},
		mutating: true,
		summarize: args => `editar ${String(args['path'] ?? '')}`,
		async run(args, root) {
			const path = inside(root, text(args, 'path'));
			const before = readFileSync(path, 'utf8');
			const old = text(args, 'old');
			const count = old ? before.split(old).length - 1 : 0;
			if (count === 0) throw new Error('O trecho antigo não foi encontrado. Releia o arquivo.');
			if (count > 1) throw new Error(`O trecho antigo aparece ${count} vezes. Inclua mais contexto.`);
			writeFileSync(path, before.replace(old, () => text(args, 'new')), 'utf8');
			return `Editado: ${relative(root, path)}`;
		},
	},
	{
		name: 'bash',
		description:
			'Executa um comando no terminal, dentro da pasta do projeto. No Windows é o Windows PowerShell 5.1 (sem &&; use ;). Comandos com mais de 120 s são encerrados: evite -Recurse em pastas grandes e confira se o caminho existe antes.',
		parameters: {type: 'object', properties: {command: {type: 'string'}}, required: ['command']},
		mutating: true,
		summarize: args => `$ ${String(args['command'] ?? '').slice(0, 80)}`,
		async run(args, root, signal) {
			return clip(await runShell(text(args, 'command'), root, signal));
		},
	},
];

export function toolsFor(mode: 'build' | 'plan'): Tool[] {
	return mode === 'plan' ? TOOLS.filter(tool => !tool.mutating) : TOOLS;
}

export function findTool(name: string): Tool | undefined {
	return TOOLS.find(tool => tool.name === name);
}
