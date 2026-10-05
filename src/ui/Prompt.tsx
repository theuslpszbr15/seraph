import {Box, Text} from 'ink';
import React from 'react';
import type {AgentMode} from '../types.js';
import type {Theme} from '../themes.js';
import {Input} from './Input.js';

type Props = {
	theme: Theme;
	value: string;
	onChange: (value: string) => void;
	onSubmit: (value: string) => void;
	mode: AgentMode;
	modelLabel: string;
	busy: boolean;
	focus: boolean;
	width?: number;
};

export const MODE_LABEL: Record<AgentMode, string> = {build: 'Construir', plan: 'Planejar'};

export function modeColor(theme: Theme, mode: AgentMode): string {
	return mode === 'build' ? theme.accent : theme.soft;
}

/** The OpenCode prompt: a heavy bar on the left, the mode and model underneath. */
export function Prompt({theme, value, onChange, onSubmit, mode, modelLabel, busy, focus, width}: Props) {
	const color = modeColor(theme, mode);
	return (
		<Box
			flexDirection="column"
			borderStyle="bold"
			borderColor={color}
			borderTop={false}
			borderRight={false}
			borderBottom={false}
			paddingLeft={1}
			{...(width ? {width} : {})}
		>
			<Input
				value={value}
				onChange={onChange}
				onSubmit={onSubmit}
				focus={focus}
				color={theme.text}
				dim={theme.dim}
				placeholder={busy ? 'Trabalhando… (esc interrompe)' : 'Pergunte qualquer coisa…'}
			/>
			<Text> </Text>
			<Text>
				<Text bold color={color}>
					{MODE_LABEL[mode]}
				</Text>
				<Text color={theme.dim}> · {modelLabel}</Text>
			</Text>
		</Box>
	);
}
