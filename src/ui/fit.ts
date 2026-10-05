/** How many terminal rows a text takes once long lines wrap. */
export function visualRows(text: string, width: number): number {
	const usable = Math.max(width, 1);
	return text.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil([...line].length / usable)), 0);
}

/** The end of a streaming text that fits `maxRows`: Ink cannot erase what scrolled off the screen. */
export function tailFit(text: string, width: number, maxRows: number): {text: string; hidden: number} {
	const lines = text.split('\n');
	const kept: string[] = [];
	let used = 0;
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		const line = lines[index] ?? '';
		const need = visualRows(line, width);
		if (used + need > maxRows) break;
		kept.unshift(line);
		used += need;
	}
	return {text: kept.join('\n'), hidden: lines.length - kept.length};
}

export type LogoSize = 'full' | 'name' | 'mini';

/** The home screen must stay shorter than the window, with room left for the prompt and the commands list. */
export function logoSizeFor(rows: number): LogoSize {
	if (rows >= 40) return 'full';
	if (rows >= 26) return 'name';
	return 'mini';
}

export function formatElapsed(seconds: number): string {
	return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}min ${seconds % 60}s`;
}
