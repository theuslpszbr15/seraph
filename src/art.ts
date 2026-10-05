/** Swapping a glyph for its reflection is what lets one half of the art draw both. */
const MIRROR: Record<string, string> = {
	'/': '\\', '\\': '/', '(': ')', ')': '(', '<': '>', '>': '<',
	'╱': '╲', '╲': '╱', '▌': '▐', '▐': '▌', '▖': '▗', '▗': '▖',
	'▘': '▝', '▝': '▘', '▙': '▟', '▟': '▙', '▛': '▜', '▜': '▛',
	'◢': '◣', '◣': '◢', '◤': '◥', '◥': '◤', '╔': '╗', '╗': '╔',
	'╚': '╝', '╝': '╚', '┌': '┐', '┐': '┌', '└': '┘', '┘': '└',
	'{': '}', '}': '{', '[': ']', ']': '[',
};

export function mirror(text: string): string {
	return [...text].reverse().map(char => MIRROR[char] ?? char).join('');
}

/** A row is its left half plus the single column on the axis; the right half is the reflection. */
type Half = [left: string, axis: string];

const HALF_WIDTH = 28;

// Halo, face, six wings (the seraph's pairs), robe. Each left half hugs the axis.
const ANGEL: Half[] = [
	['▄▄▀▀▀▀▀▀', '▀'],
	['▀▄▄     ', ' '],
	['  ▀▀▀▀▀▀', '▀'],
	['      ▄▄██', '█'],
	['  ▄▄    █▀ ', '▀'],
	['▄▀▀▄ ▀▄▄ ▀█', '▄'],
	['█▄▄ ▀▄▄ ▀▄▄▄██', '█'],
	[' ▀█▄▄ ▀█▄▄  ████', '█'],
	['   ▀▀█▄▄ ▀█▄ ███', '█'],
	['      ▀▀█▄▄ ▀██', '█'],
	['         ▀▀▀▄▄ ▀█', '█'],
	['             ▀▀▄ ▀', '█'],
	['                 ▀▄', '█'],
	['                  ▀', '▀'],
];

export function angel(): string[] {
	return ANGEL.map(([left, axis]) => {
		const half = left.padStart(HALF_WIDTH, ' ').slice(-HALF_WIDTH);
		return `${half}${axis}${mirror(half)}`;
	});
}

const LETTERS: Record<string, string[]> = {
	S: ['███████╗', '██╔════╝', '███████╗', '╚════██║', '███████║', '╚══════╝'],
	E: ['███████╗', '██╔════╝', '█████╗  ', '██╔══╝  ', '███████╗', '╚══════╝'],
	R: ['██████╗ ', '██╔══██╗', '██████╔╝', '██╔══██╗', '██║  ██║', '╚═╝  ╚═╝'],
	A: [' █████╗ ', '██╔══██╗', '███████║', '██╔══██║', '██║  ██║', '╚═╝  ╚═╝'],
	P: ['██████╗ ', '██╔══██╗', '██████╔╝', '██╔═══╝ ', '██║     ', '╚═╝     '],
	H: ['██╗  ██╗', '██║  ██║', '███████║', '██╔══██║', '██║  ██║', '╚═╝  ╚═╝'],
};

export const NAME = 'SERAPH';
export const TAGLINE = 'o harness que voa';

export function wordmark(): string[] {
	return Array.from({length: 6}, (_, row) => [...NAME].map(letter => LETTERS[letter]?.[row] ?? '').join(' '));
}

export function artWidth(lines: string[]): number {
	return Math.max(0, ...lines.map(line => [...line].length));
}
