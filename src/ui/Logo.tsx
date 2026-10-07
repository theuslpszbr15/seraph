import {Box, Text} from 'ink';
import React from 'react';
import {artWidth, NAME, TAGLINE, wordmark} from '../art.js';
import type {Theme} from '../themes.js';

function channel(hex: string, index: number): number {
	return Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16);
}

export function blend(from: string, to: string, amount: number): string {
	const part = (index: number) =>
		Math.round(channel(from, index) + (channel(to, index) - channel(from, index)) * amount)
			.toString(16)
			.padStart(2, '0');
	return `#${part(0)}${part(1)}${part(2)}`;
}

type Props = {theme: Theme; columns: number; size?: 'full' | 'name' | 'mini'};

export function Logo({theme, columns, size = 'name'}: Props) {
	if (size === 'mini') {
		return (
			<Text>
				<Text bold color={theme.primary}>
					✦ {NAME}
				</Text>
				<Text color={theme.muted}> · {TAGLINE}</Text>
			</Text>
		);
	}

	const name = wordmark();
	const fitsName = columns >= artWidth(name) + 2;

	return (
		<Box flexDirection="column" alignItems="center">
			{fitsName ? (
				name.map((line, row) => (
					<Text key={`n${row}`} bold color={blend(theme.accent, theme.primary, row / Math.max(name.length - 1, 1))}>
						{line}
					</Text>
				))
			) : (
				<Text bold color={theme.primary}>
					{NAME}
				</Text>
			)}
			<Text color={theme.muted}>{TAGLINE}</Text>
		</Box>
	);
}
