import {Text, useInput} from 'ink';
import React, {useReducer, useRef} from 'react';

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
	return input.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').replace(/\r\n?/g, '\n');
}

export function Input({value, onChange, onSubmit, placeholder, mask, focus = true, color, dim = 'gray'}: Props) {
	// Refs are the source of truth between renders, so two fast keystrokes never read stale text.
	const text = useRef(value);
	const cursor = useRef(value.length);
	const [, repaint] = useReducer((n: number) => n + 1, 0);

	// An outside change (clearing after submit) wins over what was typed.
	if (value !== text.current) {
		text.current = value;
		cursor.current = value.length === 0 ? 0 : Math.min(cursor.current, value.length);
	}

	const commit = (next: string, position: number) => {
		text.current = next;
		cursor.current = position;
		onChange(next);
		repaint();
	};

	useInput(
		(input, key) => {
			const current = text.current;
			const at = cursor.current;
			if (key.return) return onSubmit(current);
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
				else return;
				return repaint();
			}
			if (key.meta || key.tab || key.escape || key.upArrow || key.downArrow || key.pageUp || key.pageDown || !input) return;

			const pasted = cleanPaste(input);
			commit(current.slice(0, at) + pasted + current.slice(at), at + pasted.length);
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
