import {Text, useInput} from 'ink';
import React, {useReducer, useRef} from 'react';
import {readClipboard} from '../clipboard.js';
import {isMouse} from './terminal.js';

type Props = {
	value: string;
	onChange: (value: string) => void;
	onSubmit: (value: string) => void;
	placeholder?: string;
	/** Characters are shown as bullets: used for API keys. */
	mask?: boolean;
	focus?: boolean;
	color?: string;
	dim?: string;
};

/** Pasted text arrives as one chunk, so a line ending inside it must not submit. */
export function cleanPaste(input: string): string {
	return input
		.replace(/\u001b?\[20[01]~/g, '')
		.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
		.replace(/\r\n?/g, '\n')
		.replace(/\t/g, '  ');
}

/** Bracketed paste markers, sent by the terminal around pasted text (ESC already stripped by Ink). */
export const PASTE_START = '[200~';
export const PASTE_END = '[201~';

export function Input({value, onChange, onSubmit, placeholder, mask, focus = true, color, dim = 'gray'}: Props) {
	// Refs are the source of truth between renders, so two fast keystrokes never read stale text.
	const text = useRef(value);
	const cursor = useRef(value.length);
	const [, repaint] = useReducer((n: number) => n + 1, 0);

	// An outside change (clearing after submit) wins over what was typed.
	if (value !== text.current) {
		text.current = value;
		cursor.current = value.length;
	}

	const commit = (next: string, position: number) => {
		text.current = next;
		cursor.current = position;
		onChange(next);
		repaint();
	};

	const insert = (raw: string) => {
		const pasted = cleanPaste(raw);
		const current = text.current;
		const at = cursor.current;
		commit(current.slice(0, at) + pasted + current.slice(at), at + pasted.length);
	};

	const pasting = useRef(false);

	useInput(
		(input, key) => {
			const current = text.current;
			const at = cursor.current;

			// Inside a bracketed paste every key is text: Enter is a line break, never a submit.
			if (input === PASTE_START) {
				pasting.current = true;
				return;
			}
			if (input === PASTE_END) {
				pasting.current = false;
				if (cursor.current === text.current.length && /\n+$/.test(text.current)) {
					const trimmed = text.current.replace(/\n+$/, '');
					commit(trimmed, trimmed.length);
				}
				return;
			}
			if (pasting.current) {
				if (key.return) insert('\n');
				else if (key.tab) insert('  ');
				else if (input) insert(input);
				return;
			}

			// Terminals that do not paste on ctrl+v send the raw key instead.
			if (key.ctrl && input === 'v') {
				void readClipboard().then(clip => {
					if (clip) insert(clip.replace(/\r?\n$/, ''));
				});
				return;
			}
			if (key.return) return onSubmit(current);
			if (key.home) {
				cursor.current = 0;
				return repaint();
			}
			if (key.end) {
				cursor.current = current.length;
				return repaint();
			}
			if (key.leftArrow) {
				cursor.current = Math.max(at - 1, 0);
				return repaint();
			}
			if (key.rightArrow) {
				cursor.current = Math.min(at + 1, current.length);
				return repaint();
			}
			if (key.backspace || key.delete) {
				if (at === 0) return;
				return commit(current.slice(0, at - 1) + current.slice(at), at - 1);
			}
			if (key.ctrl) {
				if (input === 'a') cursor.current = 0;
				else if (input === 'e') cursor.current = current.length;
				else if (input === 'u') return commit(current.slice(at), 0);
				else if (input === 'w') {
					const start = current.slice(0, at).replace(/\S+\s*$/, '').length;
					return commit(current.slice(0, start) + current.slice(at), start);
				} else return;
				return repaint();
			}
			if (key.meta || key.tab || key.escape || key.upArrow || key.downArrow || key.pageUp || key.pageDown || !input || isMouse(input)) return;

			// Text and Enter can arrive in one chunk (fast typing, remote shells): that is a submit, not a line break.
			if (input.length > 1 && input.endsWith('\r') && !input.slice(0, -1).includes('\r')) {
				const typed = cleanPaste(input.slice(0, -1));
				const next = current.slice(0, at) + typed + current.slice(at);
				commit(next, at + typed.length);
				return onSubmit(next);
			}

			insert(input);
		},
		{isActive: focus},
	);

	const shown = mask ? '•'.repeat(text.current.length) : text.current;
	if (shown.length === 0) {
		return (
			<Text>
				{focus ? <Text inverse> </Text> : null}
				<Text color={dim}>{placeholder ?? ''}</Text>
			</Text>
		);
	}

	const at = Math.min(cursor.current, shown.length);
	const current = shown[at] ?? ' ';
	return (
		<Text {...(color ? {color} : {})}>
			{shown.slice(0, at)}
			{focus ? <Text inverse>{current === '\n' ? ' \n' : current}</Text> : current}
			{shown.slice(at + 1)}
		</Text>
	);
}
