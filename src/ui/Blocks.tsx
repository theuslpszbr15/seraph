import {Box, Text} from 'ink';
import React from 'react';
import type {ToolStatus} from '../agent.js';
import type {Theme} from '../themes.js';

export type Block =
	| {id: number; kind: 'user'; text: string}
	| {id: number; kind: 'assistant'; text: string}
	| {id: number; kind: 'thinking'; text: string}
	| {id: number; kind: 'tool'; name: string; summary: string; status: ToolStatus; output?: string}
	| {id: number; kind: 'notice'; text: string; tone: 'info' | 'error' | 'ok'};

const ICON: Record<ToolStatus, string> = {running: '◐', done: '✓', error: '✗', denied: '⊘'};

/** A block before it gets its id; Omit alone would collapse the union. */
export type NewBlock = Block extends infer B ? (B extends Block ? Omit<B, 'id'> : never) : never;

/** Fenced code reads as a different voice from prose, even without a highlighter. */
export function Markdownish({text, theme}: {text: string; theme: Theme}) {
	let inFence = false;
	return (
		<Box flexDirection="column">
			{text.split('\n').map((line, index) => {
				if (line.trimStart().startsWith('```')) {
					inFence = !inFence;
					return (
						<Text key={index} color={theme.dim}>
							{line}
						</Text>
					);
				}
				return (
					<Text key={index} color={inFence ? theme.soft : theme.text}>
						{line || ' '}
					</Text>
				);
			})}
		</Box>
	);
}

export function ToolLine({block, theme}: {block: Extract<Block, {kind: 'tool'}>; theme: Theme}) {
	const color = block.status === 'error' ? theme.bad : block.status === 'denied' ? theme.warn : block.status === 'done' ? theme.ok : theme.accent;
	const preview = block.output?.split('\n').filter(Boolean).slice(0, 3);
	return (
		<Box flexDirection="column" marginLeft={2}>
			<Text color={color}>
				{ICON[block.status]} <Text color={theme.dim}>{block.summary}</Text>
			</Text>
			{block.status === 'error' && preview
				? preview.map((line, index) => (
						<Text key={index} color={theme.bad}>
							  {line.slice(0, 120)}
						</Text>
					))
				: null}
		</Box>
	);
}

export function BlockView({block, theme, showThinking}: {block: Block; theme: Theme; showThinking: boolean}) {
	switch (block.kind) {
		case 'user':
			return (
				<Box borderStyle="bold" borderColor={theme.soft} borderTop={false} borderRight={false} borderBottom={false} paddingLeft={1} marginTop={1}>
					<Text color={theme.text}>{block.text}</Text>
				</Box>
			);
		case 'assistant':
			return (
				<Box marginTop={1} marginLeft={2}>
					<Markdownish text={block.text} theme={theme} />
				</Box>
			);
		case 'thinking':
			return showThinking ? (
				<Box marginLeft={2}>
					<Text italic color={theme.dim}>
						{block.text.trim()}
					</Text>
				</Box>
			) : null;
		case 'tool':
			return <ToolLine block={block} theme={theme} />;
		case 'notice':
			return (
				<Box marginLeft={2} marginTop={1}>
					<Text color={block.tone === 'error' ? theme.bad : block.tone === 'ok' ? theme.ok : theme.dim}>{block.text}</Text>
				</Box>
			);
	}
}
