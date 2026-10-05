import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {seraphHome, settingsStore} from './store.js';

export type CustomCommand = {name: string; hint: string; template: string};

const NAME = /^[a-z0-9][a-z0-9_-]*$/;

/** Markdown prompts in `~/.seraph/commands` and `<projeto>/.seraph/commands`; the project wins. */
export function loadCustomCommands(cwd: string, home = seraphHome()): CustomCommand[] {
	const found = new Map<string, CustomCommand>();
	for (const folder of [join(home, 'commands'), join(cwd, '.seraph', 'commands')]) {
		let files: string[];
		try {
			files = readdirSync(folder).filter(file => file.endsWith('.md'));
		} catch {
			continue;
		}
		for (const file of files) {
			const name = file.slice(0, -3).toLowerCase();
			if (!NAME.test(name)) continue;
			try {
				found.set(name, parseCommandFile(name, readFileSync(join(folder, file), 'utf8')));
			} catch {
				// Unreadable file: skip it.
			}
		}
	}
	return [...found.values()];
}

export function parseCommandFile(name: string, raw: string): CustomCommand {
	const text = raw.replace(/\r\n?/g, '\n');
	const front = /^---\n([\s\S]*?)\n---\n?/.exec(text);
	const description = front?.[1]?.split('\n').find(line => line.startsWith('description:'))?.slice('description:'.length).trim();
	return {name, hint: description || 'comando personalizado', template: (front ? text.slice(front[0].length) : text).trim()};
}

export function splitArguments(args: string): string[] {
	return [...args.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map(match => match[1] ?? match[2] ?? match[3] ?? '');
}

/** `$ARGUMENTS` is everything typed after the name; `$1`…`$9` are single words. */
export function applyArguments(template: string, args: string): string {
	const words = splitArguments(args);
	return template.replace(/\$ARGUMENTS/g, args).replace(/\$([1-9])/g, (_, index: string) => words[Number(index) - 1] ?? '');
}

const store = settingsStore<{items: string[]}>('history.json', {items: []});
const LIMIT = 200;

export const promptHistory = {
	read(): string[] {
		return store.read().items;
	},
	push(text: string): void {
		const items = store.read().items.filter(item => item !== text);
		store.write({items: [...items, text].slice(-LIMIT)});
	},
};
