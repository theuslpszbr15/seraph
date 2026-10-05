#!/usr/bin/env node
import {resolve} from 'node:path';
import {render} from 'ink';
import React from 'react';
import {App, VERSION} from './App.js';

const args = process.argv.slice(2);

if (args.includes('--version') || args.includes('-v')) {
	console.log(VERSION);
} else if (args.includes('--help') || args.includes('-h')) {
	console.log('seraph [pasta]\n\n  Abre o SERAPH na pasta indicada (padrão: a atual).\n  Dentro dele: /connect para conectar uma API ou o GitHub Copilot, /help para os atalhos.');
} else if (!process.stdin.isTTY) {
	console.error('O SERAPH precisa de um terminal interativo.');
	process.exitCode = 1;
} else {
	render(<App cwd={resolve(args[0] ?? '.')} />, {exitOnCtrlC: false});
}
