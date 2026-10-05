import {Box, Text} from 'ink';
import React, {memo} from 'react';
import type {ToolStatus} from '../agent.js';
import type {Theme} from '../themes.js';
import type {AgentMode} from '../types.js';
import {Markdown} from './Markdown.js';

export type Block =
	| {id: number; turn: number; kind: 'user'; text: string; mode: AgentMode; attached: string[]}
	| {id: number; turn: number; kind: 'assistant'; text: string}
	| {id: number; turn: number; kind: 'thinking'; text: string}
	| {id: number; turn: number; kind: 'tool'; name: string; summary: string; status: ToolStatus; output?: string}
	| {id: number; turn: number; kind: 'turn'; mode: AgentMode; model: string; seconds: number; interrupted: boolean}
	| {id: number; turn: number; kind: 'notice'; text: string; tone: 'info' | 'error' | 'ok'};

/** A block before it gets its id; Omit alone would collapse the union. */
export type NewBlock = Block extends infer B ? (B extends Block ? Omit<B, 'id' | 'turn'> : never) : never;

export const MODE_LABEL: Record<AgentMode, string> = {build: 'Construir', plan: 'Planejar'};

export function modeColor(theme: Theme, mode: AgentMode): string {
	return mode === 'build' ? theme.primary : theme.accent;
}

/** OpenCode's verbs: arrows for files, a star for search, a dollar for the shell. */
export function toolLabel(name: string, summary: string): {icon: string; text: string} {
	const target = summary.replace(/^(ler|listar|gravar|editar)\s+/, '');
	switch (name) {
		case 'read_file':
			return {icon: '→', text: `Ler ${target}`};
		case 'list_directory':
			return {icon: '→', text: `Listar ${target}`};
		case 'search_files':
			return {icon: '✱', text: summary.replace(/^buscar/, 'Buscar')};
		case 'write_file':
			return {icon: '←', text: `Gravar ${target}`};
		case 'edit_file':
			return {icon: '←', text: `Editar ${target}`};
		case 'bash':
			return {icon: '$', text: summary.replace(/^\$\s*/, '')};
		default:
			return {icon: '•', text: summary};
	}
}

function ToolView({block, theme, details}: {block: Extract<Block, {kind: 'tool'}>; theme: Theme; details: boolean}) {
	const {icon, text} = toolLabel(block.name, block.summary);
	const failed = block.status === 'error';
	const denied = block.status === 'denied';
	const lines = (block.output ?? '').split('\n').filter(line => line.trim());
	const showOutput = details && block.name === 'bash' && block.status === 'done' && lines.length > 0;
	return (
		<Box flexDirection="column" paddingLeft={3}>
			<Text color={failed ? theme.bad : denied ? theme.warn : theme.muted}>
				<Text color={failed ? theme.bad : denied ? theme.warn : theme.secondary}>{icon}</Text> {text}
				{denied ? '  (negado)' : ''}
			</Text>
			{failed
				? lines.slice(0, 3).map((line, index) => (
						<Text key={index} color={theme.bad}>
							{'  '}
							{line.slice(0, 200)}
						</Text>
					))
				: null}
			{showOutput ? (
				<Box flexDirection="column" backgroundColor={theme.panel} paddingX={1} marginLeft={2}>
					{lines.slice(0, 10).map((line, index) => (
						<Text key={index} color={theme.muted}>
							{line.slice(0, 300)}
						</Text>
					))}
					{lines.length > 10 ? <Text color={theme.muted}>… mais {lines.length - 10} linhas</Text> : null}
				</Box>
			) : null}
		</Box>
	);
}

type Props = {block: Block; theme: Theme; showThinking: boolean; details: boolean};

export const BlockView = memo(function BlockView({block, theme, showThinking, details}: Props) {
	switch (block.kind) {
		case 'user':
			return (
				<Box
					flexDirection="column"
					marginTop={1}
					backgroundColor={theme.element}
					borderStyle="bold"
					borderColor={modeColor(theme, block.mode)}
					borderTop={false}
					borderRight={false}
					borderBottom={false}
					paddingX={2}
					paddingY={1}
				>
					<Text color={theme.text}>{block.text}</Text>
					{block.attached.length > 0 ? <Text color={theme.muted}>anexado: {block.attached.join(', ')}</Text> : null}
				</Box>
			);
		case 'assistant':
			return (
				<Box marginTop={1} paddingLeft={3}>
					<Markdown text={block.text} theme={theme} />
				</Box>
			);
		case 'thinking':
			return showThinking ? (
				<Box marginTop={1} paddingLeft={3}>
					<Text italic color={theme.muted}>
						Pensando: {block.text.trim()}
					</Text>
				</Box>
			) : null;
		case 'tool':
			return <ToolView block={block} theme={theme} details={details} />;
		case 'turn':
			return (
				<Box marginTop={1} paddingLeft={3}>
					<Text color={theme.muted}>
						<Text color={modeColor(theme, block.mode)}>▣ </Text>
						{MODE_LABEL[block.mode]} · {block.model} · {block.seconds.toFixed(1)}s{block.interrupted ? ' · interrompido' : ''}
					</Text>
				</Box>
			);
		case 'notice':
			return (
				<Box marginTop={1} paddingLeft={3}>
					<Text color={block.tone === 'error' ? theme.bad : block.tone === 'ok' ? theme.ok : theme.muted}>{block.text}</Text>
				</Box>
			);
	}
});
