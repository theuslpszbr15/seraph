import {Box, Text} from 'ink';
import React from 'react';
import {angel, artWidth, NAME, TAGLINE, wordmark} from '../art.js';
import type {Theme} from '../themes.js';

function channel(hex: string, index: number): number {
	return Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16);
}

/** Blends two #rrggbb colours; the wings fade from one tone into the other. */
export function blend(from: string, to: string, amount: number): string {
	const part = (index: number) =>
		Math.round(channel(from, index) + (channel(to, index) - channel(from, index)) * amount)
			.toString(16)
			.padStart(2, '0');
	return `#${part(0)}${part(1)}${part(2)}`;
}

type Props = {theme: Theme; columns: number; size?: 'full' | 'name' | 'mini'};

export function Logo({theme, columns, size = 'full'}: Props) {
	if (size === 'mini') {
		return (
			<Text>
				<Text bold color={theme.accent}>
					✦ {NAME}
				</Text>
				<Text color={theme.dim}> · {TAGLINE}</Text>
			</Text>
		);
	}
	const art = angel();
	const name = wordmark();
	const fitsAngel = size === 'full' && columns >= artWidth(art) + 2;
	const fitsName = columns >= artWidth(name) + 2;

	return (
		<Box flexDirection="column" alignItems="center">
			{fitsAngel
				? art.map((line, row) => (
						<Text key={`a${row}`} color={blend(theme.accent, theme.soft, row / Math.max(art.length - 1, 1))}>
							{line}
						</Text>
					))
				: null}
			{fitsAngel ? <Text> </Text> : null}
			{fitsName ? (
				name.map((line, row) => (
					<Text key={`n${row}`} bold color={blend(theme.soft, theme.accent, row / Math.max(name.length - 1, 1))}>
						{line}
					</Text>
				))
			) : (
				<Text bold color={theme.accent}>
					{NAME}
				</Text>
			)}
			<Text color={theme.dim}>{TAGLINE}</Text>
		</Box>
	);
}
