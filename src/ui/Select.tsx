import {Box, Text, useInput} from 'ink';
import React, {useEffect, useState} from 'react';
import type {Theme} from '../themes.js';
import {isMouse} from './terminal.js';

export type Choice = {id: string; label: string; hint?: string; group?: string};

type Props = {
	title: string;
	choices: Choice[];
	theme: Theme;
	onPick: (choice: Choice) => void;
	onCancel: () => void;
	/** Fired as the selection moves, for live previews. */
	onHighlight?: (choice: Choice) => void;
	/** ctrl+d on the selected row. */
	onDelete?: (choice: Choice) => void;
	searchable?: boolean;
	empty?: string;
	rows?: number;
	initial?: string;
};

export function filterChoices(choices: Choice[], query: string): Choice[] {
	const needle = query.trim().toLowerCase();
	if (!needle) return choices;
	return choices.filter(choice => `${choice.label} ${choice.hint ?? ''} ${choice.group ?? ''}`.toLowerCase().includes(needle));
}

export function Select({title, choices, theme, onPick, onCancel, onHighlight, onDelete, searchable = true, empty = 'Nada por aqui.', rows = 10, initial}: Props) {
	const [query, setQuery] = useState('');
	const [index, setIndex] = useState(() => Math.max(choices.findIndex(choice => choice.id === initial), 0));
	const visible = filterChoices(choices, query);
	const active = Math.min(index, Math.max(visible.length - 1, 0));
	const current = visible[active];

	useEffect(() => {
		if (current) onHighlight?.(current);
	}, [current?.id]);

	useInput((input, key) => {
		if (isMouse(input) || input === '[200~' || input === '[201~') return;
		if (key.escape) return onCancel();
		if (key.return) {
			if (current) onPick(current);
			return;
		}
		if (key.ctrl && input === 'd') {
			if (current && onDelete) onDelete(current);
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
			const typed = query + input.replace(/[\r\n]/g, '');
			// Text and Enter in one chunk: filter, then pick the first match.
			if (input.length > 1 && input.endsWith('\r')) {
				const first = filterChoices(choices, typed)[0];
				if (first) return onPick(first);
			}
			setQuery(typed);
			setIndex(0);
		}
	});

	const start = Math.max(0, Math.min(active - Math.floor(rows / 2), visible.length - rows));
	const window = visible.slice(start, start + rows);

	return (
		<Box flexDirection="column" backgroundColor={theme.panel} paddingX={2} paddingY={1}>
			<Box justifyContent="space-between">
				<Text bold color={theme.text}>
					{title}
				</Text>
				<Text color={theme.muted}>esc</Text>
			</Box>
			{searchable ? (
				<Box marginY={1}>
					<Text color={query ? theme.text : theme.muted}>
						{query || 'Buscar'}
						<Text inverse> </Text>
					</Text>
				</Box>
			) : (
				<Text> </Text>
			)}
			{visible.length === 0 ? <Text color={theme.muted}>{empty}</Text> : null}
			{window.map((choice, position) => {
				const selected = start + position === active;
				const newGroup = choice.group && choice.group !== window[position - 1]?.group;
				return (
					<Box key={choice.id} flexDirection="column">
						{newGroup ? (
							<Box marginTop={position === 0 ? 0 : 1}>
								<Text bold color={theme.accent}>
									{choice.group}
								</Text>
							</Box>
						) : null}
						<Box justifyContent="space-between" paddingX={1} {...(selected ? {backgroundColor: theme.primary} : {})}>
							<Text color={selected ? theme.panel : theme.text} bold={selected} wrap="truncate-end">
								{choice.label}
							</Text>
							{choice.hint ? <Text color={selected ? theme.panel : theme.muted}> {choice.hint}</Text> : null}
						</Box>
					</Box>
				);
			})}
			<Box marginTop={1}>
				<Text color={theme.muted}>↑↓ mover · enter escolher{onDelete ? ' · ctrl+d apagar' : ''}</Text>
			</Box>
		</Box>
	);
}
