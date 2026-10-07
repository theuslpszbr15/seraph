import {Box, Spacer, Text, useInput} from 'ink';
import React from 'react';
import {NAME} from '../art.js';
import type {Theme} from '../themes.js';
import type {AgentMode} from '../types.js';
import {MODE_LABEL, modeColor} from './Blocks.js';
import {formatElapsed, formatTokens, shortPath, spinnerFrame} from './fit.js';

export const EXIT_BUTTON = ' ✕ sair ';

export type SuggestionItem = {label: string; hint?: string};

export function Suggestions({theme, items, active}: {theme: Theme; items: SuggestionItem[]; active: number}) {
	if (items.length === 0) return null;
	const current = Math.min(active, items.length - 1);
	const width = Math.max(...items.map(item => item.label.length)) + 3;
	return (
		<Box flexDirection="column" backgroundColor={theme.panel} paddingX={1}>
			{items.slice(0, 8).map((item, index) => (
				<Box key={item.label} {...(index === current ? {backgroundColor: theme.primary} : {})} paddingX={1}>
					<Text color={index === current ? theme.panel : theme.text} bold={index === current}>
						{item.label.padEnd(width)}
					</Text>
					{item.hint ? (
						<Text color={index === current ? theme.panel : theme.muted} wrap="truncate-end">
							{item.hint}
						</Text>
					) : null}
				</Box>
			))}
		</Box>
	);
}

type FooterProps = {
	theme: Theme;
	selecting: boolean;
	cwd: string;
	branch: string | undefined;
	busy: boolean;
	auto: boolean;
	tokens: string | undefined;
};

/** One row: where you are on the left, what you can press on the right, and a clickable exit. */
export function Footer({theme, selecting, cwd, branch, busy, auto, tokens}: FooterProps) {
	return (
		<Box paddingX={1}>
			<Box flexShrink={1} flexGrow={1}>
				<Text color={theme.muted} wrap="truncate-start">
					{shortPath(cwd)}
					{branch ? <Text color={theme.secondary}> ⎇ {branch}</Text> : null}
				</Text>
			</Box>
			<Box flexShrink={0}>
				<Text color={theme.muted}>
					{selecting ? <Text color={theme.warn}>seleção · esc voltar · </Text> : null}
					{auto ? <Text color={theme.warn}>auto · </Text> : null}
					{tokens ? `${tokens} · ` : ''}
					{busy ? (
						<>
							<Text color={theme.text}>esc</Text> interromper ·{' '}
						</>
					) : null}
					<Text color={theme.text}>ctrl+p</Text> comandos{' '}
				</Text>
				<Text backgroundColor={theme.element} color={theme.bad} bold>
					{EXIT_BUTTON}
				</Text>
			</Box>
		</Box>
	);
}

type StatusProps = {theme: Theme; tick: number; seconds: number; thinking: string; tool: string | undefined};

export function StatusLine({theme, tick, seconds, thinking, tool}: StatusProps) {
	const label = tool ? tool : thinking ? 'raciocinando' : 'aguardando o modelo';
	const lastThought = thinking.trim().split('\n').at(-1)?.trim() ?? '';
	return (
		<Box flexDirection="column" paddingLeft={3} marginTop={1}>
			<Text color={theme.muted}>
				<Text color={theme.primary}>{spinnerFrame(tick)}</Text> {label} · {formatElapsed(seconds)}
				{seconds >= 20 && !tool ? ' · modelos de raciocínio podem demorar' : ''}
			</Text>
			{lastThought ? (
				<Text italic color={theme.muted} wrap="truncate-end">
					{'  '}∴ {lastThought}
				</Text>
			) : null}
		</Box>
	);
}

type SidebarProps = {
	theme: Theme;
	title: string;
	context: number;
	limit: number | undefined;
	total: number;
	model: string;
	provider: string;
	mode: AgentMode;
	auto: boolean;
	files: string[];
	branch: string | undefined;
	version: string;
};

function Heading({theme, children}: {theme: Theme; children: string}) {
	return (
		<Box marginTop={1}>
			<Text bold color={theme.text}>
				{children}
			</Text>
		</Box>
	);
}

export function Sidebar({theme, title, context, limit, total, model, provider, mode, auto, files, branch, version}: SidebarProps) {
	const percent = limit ? Math.min(100, Math.round((context / limit) * 100)) : undefined;
	return (
		<Box width={34} flexShrink={0} flexDirection="column" backgroundColor={theme.panel} paddingX={2} paddingY={1}>
			<Text bold color={theme.text}>
				{title}
			</Text>

			<Heading theme={theme}>Contexto</Heading>
			<Text color={theme.muted}>{formatTokens(context)} tokens</Text>
			{percent === undefined ? null : (
				<Text color={percent >= 80 ? theme.warn : theme.muted}>
					{percent}% de {formatTokens(limit ?? 0)}
				</Text>
			)}
			<Text color={theme.muted}>{formatTokens(total)} na conversa</Text>

			<Heading theme={theme}>Modelo</Heading>
			<Text color={theme.text} wrap="truncate-end">
				{model || 'nenhum'}
			</Text>
			{provider ? <Text color={theme.muted}>{provider}</Text> : null}

			<Heading theme={theme}>Modo</Heading>
			<Text>
				<Text color={modeColor(theme, mode)}>{MODE_LABEL[mode]}</Text>
				{auto ? <Text color={theme.warn}> · aprova tudo</Text> : null}
			</Text>

			<Heading theme={theme}>Arquivos alterados</Heading>
			{files.length === 0 ? <Text color={theme.muted}>nenhum</Text> : null}
			{files.slice(-8).map(file => (
				<Text key={file} color={theme.muted} wrap="truncate-start">
					{file}
				</Text>
			))}

			<Spacer />
			{branch ? <Text color={theme.secondary}>⎇ {branch}</Text> : null}
			<Text color={theme.muted}>
				<Text color={theme.primary}>✦ </Text>
				{NAME} {version}
			</Text>
		</Box>
	);
}

type ApprovalProps = {theme: Theme; name: string; summary: string; onAnswer: (allow: boolean, scope?: 'tool' | 'all') => void};

export function ApprovalBox({theme, name, summary, onAnswer}: ApprovalProps) {
	useInput((input, key) => {
		// A paste must never answer for the user.
		if (input.length > 1) return;
		if (input === 'A') return onAnswer(true, 'all');
		const letter = input.toLowerCase();
		if (letter === 's' || letter === 'y' || key.return) onAnswer(true);
		else if (letter === 'a') onAnswer(true, 'tool');
		else if (letter === 'n' || key.escape) onAnswer(false);
	});
	return (
		<Box flexDirection="column" backgroundColor={theme.panel} borderStyle="bold" borderColor={theme.warn} borderTop={false} borderRight={false} borderBottom={false} paddingX={2} paddingY={1}>
			<Text bold color={theme.warn}>
				Permitir esta ação?
			</Text>
			<Text color={theme.text}>{summary}</Text>
			<Box marginTop={1}>
				<Text color={theme.muted}>
					<Text color={theme.ok}>s</Text> sim · <Text color={theme.secondary}>a</Text> sempre {name} · <Text color={theme.warn}>A</Text> aprovar tudo · <Text color={theme.bad}>n</Text> não
				</Text>
			</Box>
		</Box>
	);
}
