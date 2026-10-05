import {Box, Text, useInput} from 'ink';
import React, {useState} from 'react';
import type {Theme} from '../themes.js';

export type Choice = {id: string; label: string; hint?: string; group?: string};

type Props = {
	title: string;
	choices: Choice[];
	theme: Theme;
	onPick: (choice: Choice) => void;
	onCancel: () => void;
	searchable?: boolean;
	/** Shown instead of the list when nothing matches. */
	empty?: string;
	rows?: number;
};

export function filterChoices(choices: Choice[], query: string): Choice[] {
	const needle = query.trim().toLowerCase();
	if (!needle) return choices;
	return choices.filter(choice => `${choice.label} ${choice.hint ?? ''} ${choice.group ?? ''}`.toLowerCase().includes(needle));
}

export function Select({title, choices, theme, onPick, onCancel, searchable = true, empty = 'Nada por aqui.', rows = 9}: Props) {
	const [query, setQuery] = useState('');
	const [index, setIndex] = useState(0);
	const visible = filterChoices(choices, query);
	const active = Math.min(index, Math.max(visible.length - 1, 0));

	useInput((input, key) => {
		if (key.escape) return onCancel();
		if (key.return) {
			const picked = visible[active];
			if (picked) onPick(picked);
			return;
		}
		if (key.upArrow) return setIndex(visible.length === 0 ? 0 : (active - 1 + visible.length) % visible.length);
		if (key.downArrow) return setIndex(visible.length === 0 ? 0 : (active + 1) % visible.length);
		if (!searchable) return;
		if (key.backspace || key.delete) {
			setQuery(query.slice(0, -1));
			return setIndex(0);
		}
		if (input && !key.ctrl && !key.meta && !key.tab) {
			setQuery(query + input.replace(/[\r\n]/g, ''));
			setIndex(0);
		}
	});

	const start = Math.max(0, Math.min(active - Math.floor(rows / 2), visible.length - rows));
	const window = visible.slice(start, start + rows);

	return (
		<Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
			<Box justifyContent="space-between">
				<Text bold color={theme.accent}>
					{title}
				</Text>
				<Text color={theme.dim}>esc</Text>
			</Box>
			{searchable ? (
				<Text color={theme.dim}>
					{query ? query : 'digite para filtrar'}
					<Text inverse> </Text>
				</Text>
			) : null}
			{visible.length === 0 ? <Text color={theme.dim}>{empty}</Text> : null}
			{window.map((choice, position) => {
				const selected = start + position === active;
				const newGroup = choice.group && choice.group !== window[position - 1]?.group;
				return (
					<Box key={choice.id} flexDirection="column">
						{newGroup ? (
							<Text bold color={theme.soft}>
								{choice.group}
							</Text>
						) : null}
						<Box justifyContent="space-between">
							<Text {...(selected ? {color: theme.accent, bold: true} : {color: theme.text})}>
								{selected ? '› ' : '  '}
								{choice.label}
							</Text>
							{choice.hint ? <Text color={theme.dim}>{choice.hint}</Text> : null}
						</Box>
					</Box>
				);
			})}
			<Text color={theme.dim}>↑↓ mover · enter escolher</Text>
		</Box>
	);
}
