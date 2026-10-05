import {execFile} from 'node:child_process';
import {readdirSync, readFileSync, statSync} from 'node:fs';
import {join, relative, sep} from 'node:path';
import {inside} from './tools.js';

const SKIPPED = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.seraph', 'release', 'coverage']);
const MAX_FILES = 5000;
const MAX_ATTACH = 100_000;

/** Project files for @ completion, with forward slashes; a cheap walk, capped. */
export function listProjectFiles(root: string, limit = MAX_FILES): string[] {
	const found: string[] = [];
	const walk = (folder: string) => {
		let entries;
		try {
			entries = readdirSync(folder, {withFileTypes: true});
		} catch {
			return;
		}
		for (const entry of entries) {
			if (found.length >= limit) return;
			if (SKIPPED.has(entry.name)) continue;
			const full = join(folder, entry.name);
			if (entry.isDirectory()) walk(full);
			else found.push(relative(root, full).split(sep).join('/'));
		}
	};
	walk(root);
	return found;
}

/** The partial path after a trailing `@`, or undefined when the text does not end in a mention. */
export function mentionQuery(text: string): string | undefined {
	return /(?:^|\s)@([^\s@]*)$/.exec(text)?.[1];
}

export function matchFiles(files: string[], query: string, limit = 8): string[] {
	const needle = query.toLowerCase();
	const scored: [number, string][] = [];
	for (const file of files) {
		const lower = file.toLowerCase();
		const base = lower.slice(lower.lastIndexOf('/') + 1);
		const score = !needle ? 2 : base.startsWith(needle) ? 0 : lower.startsWith(needle) ? 1 : lower.includes(needle) ? 2 : -1;
		if (score >= 0) scored.push([score, file]);
	}
	return scored
		.sort((a, b) => a[0] - b[0] || a[1].length - b[1].length || a[1].localeCompare(b[1]))
		.slice(0, limit)
		.map(([, file]) => file);
}

export function completeMention(text: string, file: string): string {
	return text.replace(/@([^\s@]*)$/, `@${file} `);
}

/** Appends the content of every `@file` that exists inside the project; the visible text stays as typed. */
export function expandMentions(text: string, root: string): {prompt: string; attached: string[]} {
	const attached: string[] = [];
	const parts: string[] = [];
	for (const match of text.matchAll(/(?:^|\s)@([^\s]+)/g)) {
		const name = match[1] ?? '';
		if (attached.includes(name)) continue;
		try {
			const path = inside(root, name);
			if (!statSync(path).isFile()) continue;
			const content = readFileSync(path, 'utf8');
			const clipped = content.length > MAX_ATTACH ? `${content.slice(0, MAX_ATTACH)}\n[… arquivo cortado]` : content;
			parts.push(`<arquivo caminho="${name}">\n${clipped}\n</arquivo>`);
			attached.push(name);
		} catch {
			// Not a file in the project: leave the @word as plain text.
		}
	}
	return {prompt: parts.length > 0 ? `${text}\n\n${parts.join('\n\n')}` : text, attached};
}

export function gitBranch(cwd: string): Promise<string | undefined> {
	return new Promise(resolve => {
		execFile('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {cwd, timeout: 3000, windowsHide: true}, (error, stdout) => {
			resolve(error ? undefined : stdout.trim() || undefined);
		});
	});
}
