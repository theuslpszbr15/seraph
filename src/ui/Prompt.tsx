import {Box, Text} from 'ink';
import React from 'react';
import type {Theme} from '../themes.js';
import type {AgentMode} from '../types.js';
import {MODE_LABEL, modeColor} from './Blocks.js';
import {Input} from './Input.js';

type Props = {
	theme: Theme;
	value: string;
	onChange: (value: string) => void;
	onSubmit: (value: string) => void;
	mode: AgentMode;
	model: string;
	provider: string;
	busy: boolean;
	focus: boolean;
};

/** The OpenCode prompt: a raised box with a heavy bar in the mode's colour, mode and model underneath. */
export function Prompt({theme, value, onChange, onSubmit, mode, model, provider, busy, focus}: Props) {
	const color = modeColor(theme, mode);
	return (
		<Box
			flexDirection="column"
			backgroundColor={theme.element}
			borderStyle="bold"
			borderColor={color}
			borderTop={false}
			borderRight={false}
			borderBottom={false}
			paddingX={2}
			paddingTop={1}
		>
			<Input
				value={value}
				onChange={onChange}
				onSubmit={onSubmit}
				focus={focus}
				color={theme.text}
				dim={theme.muted}
				placeholder={busy ? 'Trabalhando… escreva a próxima mensagem' : 'Pergunte qualquer coisa… "@" anexa arquivo, "!" roda no terminal'}
			/>
			<Text> </Text>
			<Text>
				<Text bold color={color}>
					{MODE_LABEL[mode]}
				</Text>
				{model ? (
					<>
						<Text color={theme.text}> {model}</Text>
						<Text color={theme.muted}> {provider}</Text>
					</>
				) : (
					<Text color={theme.muted}> · nenhum modelo · /connect</Text>
				)}
			</Text>
		</Box>
	);
}
