import {mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {seraphHome} from './store.js';
import {looksCorrupted, type Message} from './types.js';

export type Session = {
	id: string;
	title: string;
	cwd: string;
	updatedAt: string;
	messages: Message[];
};

function folder(): string {
	const path = join(seraphHome(), 'sessions');
	mkdirSync(path, {recursive: true});
	return path;
}

/** Ids come from a clock, never from user input, so they cannot escape the folder. */
function fileFor(id: string): string {
	if (!/^[0-9a-z-]+$/.test(id)) throw new Error(`Id de sessão inválido: ${id}`);
	return join(folder(), `${id}.json`);
}

export function newSession(cwd: string): Session {
	const now = new Date();
	const id = `${now.toISOString().replace(/[:.]/g, '-').toLowerCase()}`;
	return {id, title: 'Nova conversa', cwd, updatedAt: now.toISOString(), messages: []};
}

export function titleFrom(messages: Message[]): string {
	const first = messages.find(message => message.role === 'user')?.content.replace(/\s+/g, ' ').trim();
	if (!first) return 'Nova conversa';
	return first.length > 60 ? `${first.slice(0, 57)}…` : first;
}

export function saveSession(session: Session): void {
	const next: Session = {...session, title: titleFrom(session.messages), updatedAt: new Date().toISOString()};
	const path = fileFor(session.id);
	const temp = `${path}.tmp`;
	writeFileSync(temp, JSON.stringify(next, null, 2), 'utf8');
	renameSync(temp, path);
}

/** Corrupted assistant text (older versions saved it) would poison every later request. */
export function withoutCorrupted(messages: Message[]): Message[] {
	return messages.flatMap(message => {
		if (message.role !== 'assistant' || !looksCorrupted(message.content)) return [message];
		// Tool calls must keep their message, or their results lose the call they answer.
		return message.toolCalls?.length ? [{...message, content: ''}] : [];
	});
}

export function loadSession(id: string): Session | undefined {
	try {
		const session = JSON.parse(readFileSync(fileFor(id), 'utf8')) as Session;
		return {...session, messages: withoutCorrupted(session.messages)};
	} catch {
		return undefined;
	}
}

export function listSessions(): Session[] {
	const found: Session[] = [];
	for (const name of readdirSync(folder())) {
		if (!name.endsWith('.json')) continue;
		const session = loadSession(name.slice(0, -5));
		if (session && session.messages.length > 0) found.push(session);
	}
	return found.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function deleteSession(id: string): void {
	rmSync(fileFor(id), {force: true});
}

export function exportMarkdown(session: Session): string {
	const body = session.messages
		.filter(message => message.role === 'user' || (message.role === 'assistant' && message.content))
		.map(message => `### ${message.role === 'user' ? 'Você' : 'SERAPH'}\n\n${message.content}`)
		.join('\n\n');
	return `# ${session.title}\n\n${body}\n`;
}
