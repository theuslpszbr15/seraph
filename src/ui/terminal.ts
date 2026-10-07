import {useEffect, useState} from 'react';

/** Mouse reports (SGR, mode 1006) arrive through useInput as `[<b;x;yM`, sometimes several at once. */
const REPORT = /\u001b?\[<(\d+);\d+;\d+[Mm]/g;

export function mouseWheel(input: string): number | undefined {
	const reports = [...input.matchAll(REPORT)];
	if (reports.length === 0 || input.replace(REPORT, '') !== '') return undefined;
	let delta = 0;
	for (const report of reports) {
		const button = Number(report[1]);
		if (button === 64) delta += 1;
		else if (button === 65) delta -= 1;
		else return undefined;
	}
	return delta;
}

export function isMouse(input: string): boolean {
	return [...input.matchAll(REPORT)].length > 0 && input.replace(REPORT, '') === '';
}

/** A left-button press, 1-based column and row; undefined for anything else. */
export function mouseClick(input: string): {x: number; y: number} | undefined {
	const match = /^\u001b?\[<0;(\d+);(\d+)M$/.exec(input);
	return match ? {x: Number(match[1]), y: Number(match[2])} : undefined;
}

type Sized = NodeJS.WriteStream | {columns?: number; rows?: number; on?: (event: 'resize', listener: () => void) => unknown; off?: (event: 'resize', listener: () => void) => unknown};

export function useTerminalSize(stdout: Sized): {columns: number; rows: number} {
	const read = () => ({columns: stdout.columns || 100, rows: stdout.rows || 30});
	const [size, setSize] = useState(read);
	useEffect(() => {
		const update = () => setSize(read());
		stdout.on?.('resize', update);
		return () => {
			stdout.off?.('resize', update);
		};
	}, [stdout]);
	return size;
}
