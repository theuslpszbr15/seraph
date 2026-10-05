#!/usr/bin/env node
import {resolve} from 'node:path';
import {render} from 'ink';
import React from 'react';
import {App, VERSION, type ExitResult} from './App.js';
import {parseArgs} from './args.js';
import {listSessions, loadSession, type Session} from './sessions.js';

const HELP = `seraph [pasta] [opções]

  Abre o SERAPH na pasta indicada (padrão: a atual).

  -c, --continue        retoma a última conversa desta pasta
  -s, --session <id>    retoma uma conversa específica
  -v, --version         mostra a versão
  -h, --help            mostra esta ajuda

  Dentro dele: /connect conecta uma API ou o GitHub Copilot, /help mostra os atalhos.`;

// Alternate screen (like OpenCode): the shell's history stays untouched underneath and comes back on exit.
const ENTER = '\u001b[?1049h\u001b[2J\u001b[H\u001b[?1000h\u001b[?1006h';
const LEAVE = '\u001b[?1000l\u001b[?1006l\u001b[?1049l\u001b[?25h';

const rgb = (hex: string) => `\u001b[38;2;${Number.parseInt(hex.slice(1, 3), 16)};${Number.parseInt(hex.slice(3, 5), 16)};${Number.parseInt(hex.slice(5, 7), 16)}m`;
const RESET = '\u001b[0m';

async function main(): Promise<void> {
	const options = parseArgs(process.argv.slice(2));
	if (options.version) return void console.log(VERSION);
	if (options.help) return void console.log(HELP);
	if (options.error) {
		console.error(`${options.error}\n\n${HELP}`);
		process.exitCode = 1;
		return;
	}
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		console.error('O SERAPH precisa de um terminal interativo.');
		process.exitCode = 1;
		return;
	}

	const cwd = resolve(options.folder ?? '.');
	let initial: Session | undefined;
	if (options.session) {
		initial = loadSession(options.session);
		if (!initial) {
			console.error(`Conversa não encontrada: ${options.session}`);
			process.exitCode = 1;
			return;
		}
	} else if (options.continue) {
		initial = listSessions().find(item => item.cwd === cwd);
		if (!initial) console.error('Nenhuma conversa anterior nesta pasta; começando uma nova.');
	}

	let restored = false;
	const restore = () => {
		if (restored) return;
		restored = true;
		process.stdout.write(LEAVE);
	};
	process.on('exit', restore);
	process.stdout.write(ENTER);

	// Incremental rendering left stale rows behind when the screen switched from home to chat; full redraws
	// are already flicker-free because Ink wraps each frame in synchronized output.
	const app = render(<App cwd={cwd} {...(initial ? {initialSession: initial} : {})} />, {exitOnCtrlC: false});
	try {
		const result = (await app.waitUntilExit()) as ExitResult | undefined;
		restore();
		const gold = rgb('#fab283');
		const muted = rgb('#808080');
		console.log(`\n  ${gold}✦ SERAPH${RESET} ${muted}até a próxima.${RESET}`);
		if (result?.sessionId) console.log(`  ${muted}Continuar esta conversa:${RESET} seraph -c ${muted}ou${RESET} seraph -s ${result.sessionId}\n`);
		else console.log('');
	} catch (error) {
		restore();
		console.error(error instanceof Error ? error.stack ?? error.message : String(error));
		process.exitCode = 1;
	}
}

await main();
