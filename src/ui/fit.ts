import {homedir} from 'node:os';
import {sep} from 'node:path';

export type LogoSize = 'full' | 'name' | 'mini';

/** The home screen must fit the window together with the prompt, hints and footer. */
export function logoSizeFor(rows: number): LogoSize {
	if (rows >= 36) return 'full';
	if (rows >= 20) return 'name';
	return 'mini';
}

export function formatElapsed(seconds: number): string {
	return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}min ${seconds % 60}s`;
}

export function formatTokens(count: number): string {
	if (count < 1000) return String(count);
	if (count < 1_000_000) return `${(count / 1000).toFixed(count < 10_000 ? 1 : 0)}k`;
	return `${(count / 1_000_000).toFixed(1)}M`;
}

export function shortPath(path: string, home = homedir()): string {
	return path.toLowerCase().startsWith(home.toLowerCase()) ? `~${path.slice(home.length)}` || '~' : path;
}

export function relativeTime(iso: string, now = Date.now()): string {
	const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
	if (seconds < 60) return 'agora';
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes} min`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours} h`;
	const days = Math.round(hours / 24);
	return days === 1 ? 'ontem' : `${days} dias`;
}

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function spinnerFrame(tick: number): string {
	return SPINNER[tick % SPINNER.length] ?? '⠋';
}

export function relativeTo(root: string, path: string): string {
	const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
	return path.startsWith(prefix) ? path.slice(prefix.length).split(sep).join('/') : path;
}
