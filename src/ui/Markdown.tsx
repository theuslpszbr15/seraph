import {Box, Text} from 'ink';
import React from 'react';
import type {Theme} from '../themes.js';

type Span = {text: string; bold?: boolean; code?: boolean; italic?: boolean};

/** `**bold**`, `` `code` `` and `*italic*`; anything unbalanced stays as typed. */
export function inlineSpans(line: string): Span[] {
	const spans: Span[] = [];
	const pattern = /\*\*([^*]+)\*\*|`([^`]+)`|(?<![\w*])\*([^*\s][^*]*)\*(?![\w*])/g;
	let last = 0;
	for (const match of line.matchAll(pattern)) {
		const at = match.index ?? 0;
		if (at > last) spans.push({text: line.slice(last, at)});
		if (match[1] !== undefined) spans.push({text: match[1], bold: true});
		else if (match[2] !== undefined) spans.push({text: match[2], code: true});
		else spans.push({text: match[3] ?? '', italic: true});
		last = at + match[0].length;
	}
	if (last < line.length) spans.push({text: line.slice(last)});
	return spans;
}

function Inline({line, theme, color}: {line: string; theme: Theme; color?: string}) {
	return (
		<Text color={color ?? theme.text}>
			{inlineSpans(line).map((span, index) =>
				span.code ? (
					<Text key={index} color={theme.accent}>
						{span.text}
					</Text>
				) : (
					<Text key={index} bold={Boolean(span.bold)} italic={Boolean(span.italic)}>
						{span.text}
					</Text>
				),
			)}
		</Text>
	);
}

type Part = {kind: 'code'; lang: string; lines: string[]} | {kind: 'line'; text: string};

export function splitParts(text: string): Part[] {
	const parts: Part[] = [];
	let code: {lang: string; lines: string[]} | undefined;
	for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
		const fence = /^\s*```(.*)$/.exec(line);
		if (fence) {
			if (code) {
				parts.push({kind: 'code', ...code});
				code = undefined;
			} else code = {lang: (fence[1] ?? '').trim(), lines: []};
			continue;
		}
		if (code) code.lines.push(line);
		else parts.push({kind: 'line', text: line});
	}
	// A block still streaming has no closing fence yet.
	if (code) parts.push({kind: 'code', ...code});
	return parts;
}

export function Markdown({text, theme}: {text: string; theme: Theme}) {
	return (
		<Box flexDirection="column">
			{splitParts(text).map((part, index) => {
				if (part.kind === 'code') {
					return (
						<Box key={index} flexDirection="column" backgroundColor={theme.panel} paddingX={1} marginY={0}>
							{part.lang ? <Text color={theme.muted}>{part.lang}</Text> : null}
							{part.lines.map((line, row) => (
								<Text key={row} color={theme.text}>
									{line || ' '}
								</Text>
							))}
						</Box>
					);
				}
				const line = part.text;
				const heading = /^(#{1,6})\s+(.*)$/.exec(line);
				if (heading) {
					return (
						<Text key={index} bold color={theme.primary}>
							{heading[2]}
						</Text>
					);
				}
				const bullet = /^(\s*)[-*+]\s+(.*)$/.exec(line);
				if (bullet) {
					return (
						<Box key={index} paddingLeft={(bullet[1] ?? '').length}>
							<Text color={theme.primary}>• </Text>
							<Inline line={bullet[2] ?? ''} theme={theme} />
						</Box>
					);
				}
				const quote = /^>\s?(.*)$/.exec(line);
				if (quote) {
					return (
						<Box key={index}>
							<Text color={theme.border}>│ </Text>
							<Inline line={quote[1] ?? ''} theme={theme} color={theme.muted} />
						</Box>
					);
				}
				if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
					return (
						<Text key={index} color={theme.border}>
							{'─'.repeat(24)}
						</Text>
					);
				}
				return line.trim() ? <Inline key={index} line={line} theme={theme} /> : <Text key={index}> </Text>;
			})}
		</Box>
	);
}
