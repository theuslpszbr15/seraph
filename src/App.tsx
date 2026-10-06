import {existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {Box, measureElement, Text, useApp, useInput, useStdout, type DOMElement} from 'ink';
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {runTurn, type AgentEvent} from './agent.js';
import {COMMANDS, findCommand, parseCommand, suggest, type Command} from './commands.js';
import {applyArguments, loadCustomCommands, promptHistory} from './customCommands.js';
import {writeClipboard} from './clipboard.js';
import {completeMention, expandMentions, gitBranch, listProjectFiles, matchFiles, mentionQuery} from './files.js';
import {exchangeCopilotToken, forgetCopilot, pollForGithubToken, saveCopilotSession, startDeviceFlow, type DeviceCode} from './providers/copilot.js';
import {
	allSpecs,
	buildProvider,
	config,
	connectedSpecs,
	contextFor,
	findSpec,
	isConnected,
	keyWarning,
	removeKey,
	saveKey,
	type Config,
	type ProviderSpec,
} from './registry.js';
import {deleteSession, exportMarkdown, listSessions, newSession, saveSession, titleFrom, type Session} from './sessions.js';
import {allThemes, themeById} from './themes.js';
import {findTool} from './tools.js';
import type {Message} from './types.js';
import {CorruptOutputError} from './types.js';
import {BlockView, type Block, type NewBlock} from './ui/Blocks.js';
import {ApprovalBox, EXIT_BUTTON, Footer, Sidebar, StatusLine, Suggestions, type SuggestionItem} from './ui/Chrome.js';
import {formatTokens, logoSizeFor, relativeTime, relativeTo} from './ui/fit.js';
import {Input} from './ui/Input.js';
import {Logo} from './ui/Logo.js';
import {Markdown} from './ui/Markdown.js';
import {Prompt} from './ui/Prompt.js';
import {Select, type Choice} from './ui/Select.js';
import {mouseClick, mouseWheel, useTerminalSize} from './ui/terminal.js';

export const VERSION = '0.2.0';

export type ExitResult = {sessionId?: string};

type Overlay =
	| {kind: 'palette'}
	| {kind: 'connect'}
	| {kind: 'disconnect'}
	| {kind: 'models'; items: Choice[] | null}
	| {kind: 'sessions'}
	| {kind: 'themes'}
	| {kind: 'help'}
	| {kind: 'key'; spec: ProviderSpec}
	| {kind: 'custom'; step: 'url' | 'key'; url: string}
	| {kind: 'copilot'; device: DeviceCode | null}
	| {kind: 'approval'; name: string; summary: string};

type Live = {text: string; thinking: string; tools: {callId: string; summary: string}[]};
const EMPTY_LIVE: Live = {text: '', thinking: '', tools: []};

type UndoEntry = {turn: number; historyLength: number; prompt: string; files: Map<string, string | null>};

const MAX_BLOCKS = 300;
const SIDEBAR_MIN_COLUMNS = 110;
const COMPACT_AT = 0.8;
const RUNS_WHILE_BUSY = new Set(['themes', 'help', 'thinking', 'details', 'auto', 'export', 'copy', 'exit']);

const SHORTCUTS: [string, string][] = [
	['enter', 'enviar (durante uma resposta, entra na fila)'],
	['ctrl+j', 'nova linha'],
	['ctrl+v', 'colar'],
	['tab', 'alternar Construir / Planejar'],
	['ctrl+p', 'paleta de comandos'],
	['↑ ↓', 'mensagens anteriores'],
	['PgUp PgDn', 'rolar a conversa (ou a roda do mouse)'],
	['shift+arrastar', 'selecionar texto para copiar'],
	['@arquivo', 'anexar um arquivo do projeto'],
	['!comando', 'rodar direto no terminal'],
	['esc', 'interromper o agente'],
	['ctrl+c', 'limpar o campo; vazio, sai'],
];

const TIPS = [
	'Digite @ para anexar um arquivo do projeto',
	'Comece com ! para rodar um comando no terminal',
	'tab alterna entre Construir e Planejar',
	'/themes troca o tema com prévia ao vivo',
	'/undo desfaz a última resposta e os arquivos que ela mudou',
	'ctrl+p mostra todos os comandos',
	'Crie seus comandos em .seraph/commands/*.md',
	'/init cria um AGENTS.md para este projeto',
];

const INIT_PROMPT =
	'Analise este projeto (estrutura, como instalar, rodar e testar, convenções de código) e crie ou atualize o arquivo AGENTS.md na raiz com instruções curtas e práticas para agentes de código. Escreva em português.';

function slug(text: string): string {
	return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
}

/** Rebuilds what the screen shows from a saved conversation. */
export function blocksFromMessages(messages: Message[]): NewBlock[] {
	const shown: NewBlock[] = [];
	for (const message of messages) {
		if (message.role === 'user' && message.content.trim()) shown.push({kind: 'user', text: message.content.split('\n\n<arquivo ')[0] ?? message.content, mode: 'build', attached: []});
		if (message.role !== 'assistant') continue;
		if (message.content.trim()) shown.push({kind: 'assistant', text: message.content.trim()});
		for (const call of message.toolCalls ?? []) {
			let summary = call.name;
			try {
				summary = findTool(call.name)?.summarize(JSON.parse(call.arguments || '{}') as Record<string, unknown>) ?? call.name;
			} catch {
				// Keep the bare name.
			}
			shown.push({kind: 'tool', name: call.name, summary, status: 'done'});
		}
	}
	return shown;
}

type Props = {cwd: string; initialSession?: Session};

export function App({cwd, initialSession}: Props) {
	const {exit} = useApp();
	const {stdout} = useStdout();
	const {columns, rows} = useTerminalSize(stdout);

	const [cfg, setCfg] = useState<Config>(() => config.read());
	const [blocks, setBlocks] = useState<Block[]>([]);
	const [live, setLive] = useState<Live>(EMPTY_LIVE);
	const [value, setValue] = useState('');
	const [busy, setBusy] = useState(false);
	const [overlay, setOverlay] = useState<Overlay | null>(null);
	const [pick, setPick] = useState(0);
	const [showThinking, setShowThinking] = useState(false);
	const [details, setDetails] = useState(true);
	const [usage, setUsage] = useState({total: 0, context: 0});
	const [draft, setDraft] = useState('');
	const [scroll, setScroll] = useState(0);
	const [preview, setPreview] = useState<string | null>(null);
	const [auto, setAuto] = useState(false);
	const [branch, setBranch] = useState<string | undefined>();
	const [tick, setTick] = useState(0);
	const [changed, setChanged] = useState<string[]>([]);
	const [tip] = useState(() => TIPS[Math.floor(Math.random() * TIPS.length)] ?? '');
	const [customs, setCustoms] = useState(() => loadCustomCommands(cwd));
	const [queued, setQueued] = useState<string[]>([]);

	const theme = themeById(preview ?? cfg.theme);
	const history = useRef<Message[]>([]);
	const session = useRef<Session>(newSession(cwd));
	const nextId = useRef(1);
	const turn = useRef(0);
	const abort = useRef<AbortController | null>(null);
	const loginAbort = useRef<AbortController | null>(null);
	const approval = useRef<((answer: boolean) => void) | null>(null);
	const alwaysAllowed = useRef(new Set<string>());
	const autoRef = useRef(false);
	const liveRef = useRef<Live>(EMPTY_LIVE);
	const undoStack = useRef<UndoEntry[]>([]);
	const started = useRef(0);
	const historyIndex = useRef(-1);
	const savedDraft = useRef('');
	const files = useRef<{at: number; list: string[]}>({at: 0, list: []});
	const viewport = useRef<DOMElement>(null);
	const content = useRef<DOMElement>(null);
	const metrics = useRef({viewport: 0, content: 0});
	const quitting = useRef(false);
	const showThinkingRef = useRef(showThinking);
	showThinkingRef.current = showThinking;

	const spec = findSpec(cfg.provider, cfg);
	const limit = contextFor(cfg);
	const home = blocks.length === 0 && !busy;
	const sidebar = !home && columns >= SIDEBAR_MIN_COLUMNS;
	const customCommands: Command[] = useMemo(() => customs.map(item => ({name: item.name, hint: item.hint})), [customs]);

	const mention = overlay ? undefined : mentionQuery(value);
	const mentionItems = useMemo(() => {
		if (mention === undefined) return [];
		if (Date.now() - files.current.at > 30_000) files.current = {at: Date.now(), list: listProjectFiles(cwd)};
		return matchFiles(files.current.list, mention);
	}, [mention, cwd]);
	const slashItems = overlay ? [] : suggest(value, customCommands);
	const suggestionItems: SuggestionItem[] =
		mentionItems.length > 0 ? mentionItems.map(file => ({label: file})) : slashItems.map(command => ({label: `/${command.name}`, hint: command.hint}));
	const active = Math.min(pick, Math.max(suggestionItems.length - 1, 0));

	useEffect(() => setPick(0), [value]);

	useEffect(() => {
		if (initialSession) reset(initialSession);
	}, []);

	useEffect(() => {
		if (busy) return;
		void gitBranch(cwd).then(setBranch);
	}, [busy, cwd]);

	useEffect(() => {
		if (!busy) return;
		const timer = setInterval(() => setTick(count => count + 1), 120);
		return () => clearInterval(timer);
	}, [busy]);

	// Keeps the view still while the user reads older lines and new ones arrive below.
	useEffect(() => {
		if (!viewport.current || !content.current) return;
		const viewHeight = measureElement(viewport.current).height;
		const contentHeight = measureElement(content.current).height;
		const grew = contentHeight - metrics.current.content;
		metrics.current = {viewport: viewHeight, content: contentHeight};
		const max = Math.max(0, contentHeight - viewHeight);
		if (scroll > 0 && grew > 0) setScroll(Math.min(scroll + grew, max));
		else if (scroll > max) setScroll(max);
	});

	const scrollBy = (delta: number) => {
		const max = Math.max(0, metrics.current.content - metrics.current.viewport);
		setScroll(current => Math.max(0, Math.min(current + delta, max)));
	};

	const patchLive = (next: Live) => {
		liveRef.current = next;
		setLive(next);
	};

	const add = useCallback((block: NewBlock) => {
		setBlocks(current => [...current, {...block, id: nextId.current++, turn: turn.current} as Block]);
	}, []);

	const notice = useCallback((text: string, tone: 'info' | 'error' | 'ok' = 'info') => add({kind: 'notice', text, tone}), [add]);

	const update = (patch: Partial<Config>) => {
		setCfg(previous => {
			const next = {...previous, ...patch};
			config.write(next);
			return next;
		});
	};

	/** Streamed prose and reasoning become permanent blocks the moment a tool starts or the turn ends. */
	const flush = useCallback(() => {
		const current = liveRef.current;
		if (current.thinking.trim() && showThinkingRef.current) add({kind: 'thinking', text: current.thinking});
		if (current.text.trim()) add({kind: 'assistant', text: current.text.trim()});
		patchLive({...current, text: '', thinking: ''});
	}, [add]);

	const onEvent = useCallback(
		(event: AgentEvent) => {
			if (event.type === 'text') patchLive({...liveRef.current, text: liveRef.current.text + event.text});
			else if (event.type === 'thinking') patchLive({...liveRef.current, thinking: liveRef.current.thinking + event.text});
			else if (event.type === 'usage') setUsage(total => ({total: total.total + event.usage.input + event.usage.output, context: event.usage.input + event.usage.output}));
			else if (event.type === 'retry') {
				patchLive({...liveRef.current, text: '', thinking: ''});
				add({kind: 'notice', text: event.reason, tone: 'error'});
			}
			else {
				flush();
				if (event.status === 'running') {
					patchLive({...liveRef.current, tools: [...liveRef.current.tools, {callId: event.id, summary: event.summary}]});
				} else {
					patchLive({...liveRef.current, tools: liveRef.current.tools.filter(tool => tool.callId !== event.id)});
					add({kind: 'tool', name: event.name, summary: event.summary, status: event.status, ...(event.output ? {output: event.output} : {})});
				}
			}
		},
		[add, flush],
	);

	const save = () => {
		if (history.current.length > 0) saveSession({...session.current, messages: history.current});
	};

	/** What was already streamed when a turn stops early, so the next message keeps the context. */
	const partialAnswer = (): Message | undefined => {
		const text = liveRef.current.text.trim();
		return text ? {role: 'assistant', content: `${text}\n\n[resposta interrompida]`} : undefined;
	};

	/** Stops the turn; a pending approval is answered "no" so the agent can finish instead of waiting forever. */
	const interrupt = () => {
		abort.current?.abort();
		if (approval.current) {
			approval.current(false);
			approval.current = null;
			setOverlay(null);
		}
	};

	const quit = () => {
		quitting.current = true;
		const partial = partialAnswer();
		interrupt();
		loginAbort.current?.abort();
		if (partial) history.current = [...history.current, partial];
		save();
		exit(history.current.length > 0 ? {sessionId: session.current.id} : {});
	};

	function reset(loaded?: Session) {
		abort.current?.abort();
		history.current = loaded ? [...loaded.messages] : [];
		session.current = loaded ?? newSession(cwd);
		alwaysAllowed.current.clear();
		undoStack.current = [];
		turn.current = 0;
		nextId.current = 1;
		setBlocks(blocksFromMessages(history.current).map(block => ({...block, id: nextId.current++, turn: 0}) as Block));
		patchLive(EMPTY_LIVE);
		setUsage({total: 0, context: 0});
		setChanged([]);
		setScroll(0);
		setCustoms(loadCustomCommands(cwd));
	}

	const finishConnect = (connected: ProviderSpec) => {
		const keepModel = cfg.provider === connected.id && cfg.model;
		const model = keepModel ? cfg.model : (connected.defaultModel ?? '');
		update({provider: connected.id, model});
		setOverlay(null);
		notice(`${connected.label} conectado.`, 'ok');
		if (!model) void openModels();
	};

	const loginCopilot = async (copilot: ProviderSpec) => {
		const controller = new AbortController();
		loginAbort.current = controller;
		setOverlay({kind: 'copilot', device: null});
		try {
			const device = await startDeviceFlow('github.com', controller.signal);
			void writeClipboard(device.userCode);
			setOverlay({kind: 'copilot', device});
			const githubToken = await pollForGithubToken('github.com', device, controller.signal);
			saveCopilotSession(await exchangeCopilotToken(githubToken, undefined, controller.signal));
			finishConnect(copilot);
		} catch (error) {
			if (controller.signal.aborted) return;
			setOverlay(null);
			notice(error instanceof Error ? error.message : String(error), 'error');
		} finally {
			loginAbort.current = null;
		}
	};

	async function openModels(): Promise<void> {
		setOverlay({kind: 'models', items: null});
		const connected = connectedSpecs(cfg);
		const results = await Promise.allSettled(connected.map(async item => ({item, models: await buildProvider(item).listModels(AbortSignal.timeout(20_000))})));
		const items: Choice[] = [];
		const learned: Record<string, number> = {};
		results.forEach((result, index) => {
			const item = connected[index];
			if (!item) return;
			if (result.status === 'fulfilled') {
				for (const model of result.value.models) {
					if (model.context) learned[`${item.id}::${model.id}`] = model.context;
					const current = cfg.provider === item.id && cfg.model === model.id;
					const hint = [model.context ? formatTokens(model.context) : '', current ? 'atual' : ''].filter(Boolean).join(' · ');
					items.push({id: `${item.id}::${model.id}`, label: model.id, group: item.label, ...(hint ? {hint} : {})});
				}
			} else if (!item.keyless) {
				// A local server that is simply not running is normal, not worth a line in the list.
				items.push({id: `${item.id}::`, label: `(não consegui listar: ${result.reason instanceof Error ? result.reason.message.slice(0, 50) : 'erro'})`, group: item.label});
			}
		});
		setCfg(previous => {
			const next = {...previous, contexts: {...previous.contexts, ...learned}};
			config.write(next);
			return next;
		});
		setOverlay(current => (current?.kind === 'models' ? {kind: 'models', items} : current));
	}

	const compact = async (automatic = false) => {
		if (!spec || !cfg.model || history.current.length < 2) {
			if (!automatic) notice('Ainda não há o que resumir.');
			return;
		}
		const controller = new AbortController();
		abort.current = controller;
		setBusy(true);
		started.current = Date.now();
		try {
			const transcript = history.current
				.filter(message => message.role === 'user' || (message.role === 'assistant' && message.content))
				.map(message => `${message.role === 'user' ? 'Usuário' : 'Assistente'}: ${message.content}`)
				.join('\n\n');
			const result = await buildProvider(spec).chat({
				model: cfg.model,
				messages: [
					{role: 'system', content: 'Resuma a conversa a seguir em tópicos curtos, preservando decisões, arquivos tocados e pendências.'},
					{role: 'user', content: transcript.slice(-120_000)},
				],
				tools: [],
				signal: controller.signal,
				onEvent: () => undefined,
			});
			history.current = [{role: 'user', content: `Resumo da conversa até aqui:\n${result.text}`}];
			setUsage(current => ({...current, context: 0}));
			save();
			notice(automatic ? 'O contexto estava quase cheio: resumi a conversa para continuar.' : 'Conversa resumida.', 'ok');
		} catch (error) {
			notice(controller.signal.aborted ? 'Interrompido.' : error instanceof Error ? error.message : String(error), 'error');
		} finally {
			setBusy(false);
			abort.current = null;
		}
	};

	const undo = () => {
		const entry = undoStack.current.pop();
		if (!entry) return notice('Nada para desfazer.');
		for (const [path, before] of entry.files) {
			if (before === null) rmSync(path, {force: true});
			else writeFileSync(path, before, 'utf8');
		}
		history.current = history.current.slice(0, entry.historyLength);
		setBlocks(current => current.filter(block => block.turn < entry.turn));
		setValue(entry.prompt);
		save();
		const restored = entry.files.size;
		notice(restored > 0 ? `Desfeito. ${restored} arquivo(s) voltaram ao estado anterior.` : 'Desfeito.', 'ok');
	};

	const ask = async (shown: string, prompt?: string) => {
		if (!spec || !cfg.model || !isConnected(spec)) return notice('Conecte um provedor e escolha um modelo com /connect.', 'error');
		if (limit && usage.context > limit * COMPACT_AT) await compact(true);

		const {prompt: expanded, attached} = expandMentions(prompt ?? shown, cwd);
		turn.current += 1;
		const entry: UndoEntry = {turn: turn.current, historyLength: history.current.length, prompt: shown, files: new Map()};
		undoStack.current = [...undoStack.current.slice(-19), entry];
		add({kind: 'user', text: shown, mode: cfg.mode, attached});
		setScroll(0);

		const userMessage: Message = {role: 'user', content: expanded};
		// Saved before the model answers: an interruption or a closed window keeps what was asked.
		history.current = [...history.current, userMessage];
		save();
		const controller = new AbortController();
		abort.current = controller;
		started.current = Date.now();
		setBusy(true);
		patchLive(EMPTY_LIVE);

		try {
			await runTurn({
				provider: buildProvider(spec),
				model: cfg.model,
				mode: cfg.mode,
				history: history.current,
				root: cwd,
				signal: controller.signal,
				onEvent,
				onMessage: message => {
					history.current = [...history.current, message];
					save();
				},
				onBeforeWrite: path => {
					if (!entry.files.has(path)) entry.files.set(path, existsSync(path) ? readFileSync(path, 'utf8') : null);
					const shownPath = relativeTo(cwd, path);
					setChanged(current => (current.includes(shownPath) ? current : [...current, shownPath]));
				},
				approve: request =>
					autoRef.current || alwaysAllowed.current.has(request.name)
						? Promise.resolve(true)
						: new Promise<boolean>(resolve => {
								approval.current = resolve;
								setOverlay({kind: 'approval', name: request.name, summary: request.summary});
							}),
			});
		} catch (error) {
			const corrupted = error instanceof CorruptOutputError;
			if (corrupted) patchLive({...liveRef.current, text: '', thinking: ''});
			const partial = quitting.current || corrupted ? undefined : partialAnswer();
			if (partial) history.current = [...history.current, partial];
			if (!controller.signal.aborted) notice(error instanceof Error ? error.message : String(error), 'error');
		} finally {
			flush();
			patchLive(EMPTY_LIVE);
			add({kind: 'turn', mode: cfg.mode, model: cfg.model, seconds: (Date.now() - started.current) / 1000, interrupted: controller.signal.aborted});
			setBusy(false);
			abort.current = null;
			save();
		}
	};

	const runShell = async (command: string) => {
		const bash = findTool('bash');
		if (!command.trim() || !bash) return;
		turn.current += 1;
		const controller = new AbortController();
		abort.current = controller;
		started.current = Date.now();
		setBusy(true);
		setScroll(0);
		patchLive({...EMPTY_LIVE, tools: [{callId: 'shell', summary: `$ ${command}`}]});
		try {
			const output = await bash.run({command}, cwd, controller.signal);
			add({kind: 'tool', name: 'bash', summary: `$ ${command}`, status: 'done', output});
			history.current = [...history.current, {role: 'user', content: `Executei no terminal: \`${command}\`\n\nSaída:\n\`\`\`\n${output}\n\`\`\``}];
			save();
		} finally {
			patchLive(EMPTY_LIVE);
			setBusy(false);
			abort.current = null;
		}
	};

	const runCommand = (text: string) => {
		const {name, args} = parseCommand(text);
		const command = findCommand(name, customCommands) ?? suggest(`/${name}`, customCommands)[0];
		setValue('');
		if (!command) return notice(`Comando desconhecido: /${name}. Digite /help.`, 'error');
		const custom = customs.find(item => item.name === command.name);
		if (custom && !COMMANDS.some(builtin => builtin.name === command.name)) return void ask(text, applyArguments(custom.template, args));
		switch (command.name) {
			case 'connect':
				return setOverlay({kind: 'connect'});
			case 'disconnect':
				return setOverlay({kind: 'disconnect'});
			case 'models':
				return connectedSpecs(cfg).length === 0 ? notice('Nenhum provedor conectado. Use /connect.', 'error') : void openModels();
			case 'sessions':
				return setOverlay({kind: 'sessions'});
			case 'themes':
				allThemes(true);
				return setOverlay({kind: 'themes'});
			case 'help':
				return setOverlay({kind: 'help'});
			case 'copy': {
				const last = [...history.current].reverse().find(message => message.role === 'assistant' && message.content.trim());
				if (!last) return notice('Ainda não há resposta para copiar.');
				void writeClipboard(last.content).then(ok => notice(ok ? 'Última resposta copiada.' : 'Não consegui acessar a área de transferência.', ok ? 'ok' : 'error'));
				return;
			}
			case 'thinking':
				setShowThinking(current => !current);
				return notice(`Raciocínio ${showThinking ? 'oculto' : 'visível'}.`);
			case 'details':
				setDetails(current => !current);
				return notice(`Saída dos comandos ${details ? 'oculta' : 'visível'}.`);
			case 'auto':
				autoRef.current = !autoRef.current;
				setAuto(autoRef.current);
				return notice(autoRef.current ? 'Aprovação automática ligada: nada mais vai perguntar.' : 'Aprovação automática desligada.', autoRef.current ? 'info' : 'ok');
			case 'new':
				return reset();
			case 'undo':
				return undo();
			case 'init':
				if (cfg.mode === 'plan') return notice('O /init grava o AGENTS.md: mude para Construir com tab.', 'error');
				return void ask('/init', INIT_PROMPT);
			case 'compact':
				return void compact();
			case 'export': {
				if (history.current.length === 0) return notice('Nada para exportar.');
				const file = join(cwd, `seraph-${session.current.id.slice(0, 19)}.md`);
				mkdirSync(cwd, {recursive: true});
				writeFileSync(file, exportMarkdown({...session.current, messages: history.current}), 'utf8');
				return notice(`Exportado: ${file}`, 'ok');
			}
			case 'exit':
				return quit();
		}
	};

	const dispatch = (text: string) => {
		if (text.startsWith('/')) return runCommand(text);
		if (text.startsWith('!')) return void runShell(text.slice(1).trim());
		void ask(text);
	};

	const send = (raw: string) => {
		if (mentionItems.length > 0) {
			const file = mentionItems[active];
			if (file) return setValue(completeMention(value, file));
		}
		const text = raw.trim();
		if (!text) return;
		promptHistory.push(text);
		historyIndex.current = -1;
		setValue('');
		let resolved = text;
		if (text.startsWith('/')) {
			const picked = slashItems[active];
			if (!findCommand(parseCommand(text).name, customCommands) && picked) resolved = `/${picked.name}`;
		}
		const command = resolved.startsWith('/') ? findCommand(parseCommand(resolved).name, customCommands)?.name : undefined;
		// Screen-only commands run at once; anything that talks to the model or changes the conversation waits its turn.
		if (busy && !(command && RUNS_WHILE_BUSY.has(command))) return setQueued(current => [...current, resolved]);
		dispatch(resolved);
	};

	useEffect(() => {
		if (busy || queued.length === 0) return;
		const [next, ...rest] = queued;
		setQueued(rest);
		if (next) dispatch(next);
	}, [busy, queued]);

	const answerApproval = (answer: boolean, scope?: 'tool' | 'all') => {
		const current = overlay;
		if (current?.kind === 'approval' && scope === 'tool') alwaysAllowed.current.add(current.name);
		if (scope === 'all') {
			autoRef.current = true;
			setAuto(true);
		}
		setOverlay(null);
		approval.current?.(answer);
		approval.current = null;
	};

	const closeOverlay = () => {
		if (overlay?.kind === 'copilot') loginAbort.current?.abort();
		setPreview(null);
		setOverlay(null);
	};

	const browseHistory = (direction: 1 | -1) => {
		const items = promptHistory.read();
		const next = historyIndex.current + direction;
		if (next < -1 || next >= items.length) return;
		if (historyIndex.current === -1) savedDraft.current = value;
		historyIndex.current = next;
		setValue(next === -1 ? savedDraft.current : (items[items.length - 1 - next] ?? ''));
	};

	useInput((input, key) => {
		const wheel = mouseWheel(input);
		if (wheel !== undefined) {
			if (!home && !overlay) scrollBy(wheel * 3);
			return;
		}
		const click = mouseClick(input);
		if (click) {
			// The exit button is the last thing on the bottom row.
			if (click.y >= rows - 1 && click.x >= columns - EXIT_BUTTON.length - 2) quit();
			return;
		}
		if (key.ctrl && input === 'c') {
			if (busy) return interrupt();
			if (overlay && overlay.kind !== 'approval') return closeOverlay();
			if (value) return setValue('');
			return quit();
		}
		if (key.ctrl && input === 'd' && !value && !overlay) return quit();
		if (overlay?.kind === 'approval') return;
		if (key.escape) {
			if (overlay) return closeOverlay();
			if (busy) interrupt();
			return;
		}
		if (overlay) return;
		if (key.ctrl && input === 'p') return setOverlay({kind: 'palette'});
		if (key.pageUp) return scrollBy(Math.max(metrics.current.viewport - 2, 1));
		if (key.pageDown) return scrollBy(-Math.max(metrics.current.viewport - 2, 1));
		if (key.home && !value) return scrollBy(Number.MAX_SAFE_INTEGER);
		if (key.end && !value) return setScroll(0);
		if (key.tab) {
			const mentioned = mentionItems[active];
			if (mentioned) return setValue(completeMention(value, mentioned));
			const command = slashItems[active];
			if (command) return setValue(`/${command.name} `);
			return update({mode: cfg.mode === 'build' ? 'plan' : 'build'});
		}
		if (suggestionItems.length > 0 && key.upArrow) return setPick((active - 1 + suggestionItems.length) % suggestionItems.length);
		if (suggestionItems.length > 0 && key.downArrow) return setPick((active + 1) % suggestionItems.length);
		if (!value.includes('\n') && key.upArrow) return browseHistory(1);
		if (!value.includes('\n') && key.downArrow) return browseHistory(-1);
	});

	const renderOverlay = () => {
		if (!overlay) return null;
		// Dialogs must fit under the compact logo and above the footer, whatever the window height.
		const dialog = {theme, onCancel: closeOverlay, rows: Math.max(3, rows - 16)};
		switch (overlay.kind) {
			case 'palette':
				return (
					<Select
						{...dialog}
						title="Comandos"
						choices={[
							...suggest('/', customCommands).map(command => ({id: command.name, label: `/${command.name}`, hint: command.hint})),
							{id: '#mode', label: 'Alternar Construir / Planejar', hint: 'tab'},
						]}
						onPick={choice => {
							setOverlay(null);
							if (choice.id === '#mode') return update({mode: cfg.mode === 'build' ? 'plan' : 'build'});
							runCommand(`/${choice.id}`);
						}}
					/>
				);
			case 'connect':
				return (
					<Select
						{...dialog}
						title="Conectar provedor"
						choices={[
							...allSpecs(cfg).map(item => ({id: item.id, label: item.label, hint: item.keyless ? 'local' : isConnected(item) ? '✓ conectado' : ''})),
							{id: 'custom', label: 'Outra API compatível com OpenAI', hint: 'URL + chave'},
						]}
						onPick={choice => {
							if (choice.id === 'custom') return setOverlay({kind: 'custom', step: 'url', url: ''});
							const picked = findSpec(choice.id, cfg);
							if (!picked) return;
							if (picked.kind === 'copilot') return void loginCopilot(picked);
							if (picked.keyless) return finishConnect(picked);
							setDraft('');
							setOverlay({kind: 'key', spec: picked});
						}}
					/>
				);
			case 'disconnect':
				return (
					<Select
						{...dialog}
						title="Desconectar"
						choices={allSpecs(cfg)
							.filter(isConnected)
							.filter(item => !item.keyless)
							.map(item => ({id: item.id, label: item.label}))}
						empty="Nada conectado."
						onPick={choice => {
							if (choice.id === 'copilot') forgetCopilot();
							else removeKey(choice.id);
							if (cfg.provider === choice.id) update({provider: '', model: ''});
							setOverlay(null);
							notice('Credenciais removidas.', 'ok');
						}}
					/>
				);
			case 'models':
				return overlay.items === null ? (
					<Box backgroundColor={theme.panel} paddingX={2} paddingY={1}>
						<Text color={theme.muted}>Buscando modelos…</Text>
					</Box>
				) : (
					<Select
						{...dialog}
						title="Modelos"
						choices={overlay.items}
						initial={`${cfg.provider}::${cfg.model}`}
						empty="Nenhum modelo encontrado."
						onPick={choice => {
							const [provider = '', model = ''] = choice.id.split('::');
							if (!model) return;
							update({provider, model});
							setOverlay(null);
							notice(`Modelo: ${model}`, 'ok');
						}}
					/>
				);
			case 'sessions':
				return (
					<Select
						{...dialog}
						title="Conversas"
						choices={listSessions().map(item => ({id: item.id, label: item.title, hint: `${relativeTime(item.updatedAt)} · ${item.messages.filter(message => message.role === 'user').length} msgs`}))}
						empty="Nenhuma conversa salva."
						onDelete={choice => {
							deleteSession(choice.id);
							if (choice.id === session.current.id) reset();
							setOverlay({kind: 'sessions'});
						}}
						onPick={choice => {
							const loaded = listSessions().find(item => item.id === choice.id);
							setOverlay(null);
							if (loaded) reset(loaded);
						}}
					/>
				);
			case 'themes':
				return (
					<Select
						{...dialog}
						title="Temas"
						initial={cfg.theme}
						choices={allThemes().map(item => ({id: item.id, label: item.label, hint: item.id === cfg.theme ? 'atual' : ''}))}
						onHighlight={choice => setPreview(choice.id)}
						onPick={choice => {
							update({theme: choice.id});
							setPreview(null);
							setOverlay(null);
						}}
					/>
				);
			case 'help':
				return (
					<Select
						{...dialog}
						title="Ajuda"
						choices={[
							...SHORTCUTS.map(([keys, what], index) => ({id: `#${index}`, label: keys, hint: what, group: 'Atalhos'})),
							...suggest('/', customCommands).map(command => ({id: command.name, label: `/${command.name}`, hint: command.hint, group: 'Comandos'})),
						]}
						onPick={choice => {
							if (choice.id.startsWith('#')) return;
							setOverlay(null);
							runCommand(`/${choice.id}`);
						}}
					/>
				);
			case 'key':
				return (
					<Box flexDirection="column" backgroundColor={theme.panel} paddingX={2} paddingY={1}>
						<Text bold color={theme.text}>
							Chave de {overlay.spec.label}
						</Text>
						<Text color={theme.muted}>
							Cole a chave. Ela fica criptografada neste computador{overlay.spec.envKey ? ` (ou use a variável ${overlay.spec.envKey})` : ''}.
						</Text>
						<Box marginY={1} backgroundColor={theme.element} paddingX={1}>
							<Input
								mask
								value={draft}
								onChange={setDraft}
								dim={theme.muted}
								color={theme.text}
								placeholder="cole aqui"
								onSubmit={text => {
									if (!text.trim()) return;
									saveKey(overlay.spec.id, text);
									setDraft('');
									finishConnect(overlay.spec);
									const warning = keyWarning(overlay.spec, text);
									if (warning) notice(warning, 'error');
								}}
							/>
						</Box>
						<Text color={theme.muted}>enter salvar · esc cancelar</Text>
					</Box>
				);
			case 'custom':
				return (
					<Box flexDirection="column" backgroundColor={theme.panel} paddingX={2} paddingY={1}>
						<Text bold color={theme.text}>
							{overlay.step === 'url' ? 'Endereço da API' : 'Chave (opcional)'}
						</Text>
						<Text color={theme.muted}>
							{overlay.step === 'url' ? 'Ex.: https://meu-servidor.com/v1 (precisa ser compatível com OpenAI)' : `Para ${overlay.url}. Deixe vazio se não precisa.`}
						</Text>
						<Box marginY={1} backgroundColor={theme.element} paddingX={1}>
							<Input
								mask={overlay.step === 'key'}
								value={draft}
								onChange={setDraft}
								dim={theme.muted}
								color={theme.text}
								placeholder={overlay.step === 'url' ? 'https://…' : 'chave'}
								onSubmit={text => {
									if (overlay.step === 'url') {
										try {
											const url = new URL(text.trim());
											if (!/^https?:$/.test(url.protocol)) throw new Error('protocolo');
											setDraft('');
											return setOverlay({kind: 'custom', step: 'key', url: text.trim().replace(/\/+$/, '')});
										} catch {
											return notice('Endereço inválido. Use http:// ou https://.', 'error');
										}
									}
									const host = new URL(overlay.url).host;
									const custom: ProviderSpec = {id: `custom-${slug(host)}`, label: host, kind: 'openai', baseUrl: overlay.url, keyless: !text.trim()};
									if (text.trim()) saveKey(custom.id, text);
									update({custom: [...cfg.custom.filter(item => item.id !== custom.id), custom]});
									setDraft('');
									finishConnect(custom);
								}}
							/>
						</Box>
						<Text color={theme.muted}>enter continuar · esc cancelar</Text>
					</Box>
				);
			case 'copilot':
				return (
					<Box flexDirection="column" backgroundColor={theme.panel} paddingX={2} paddingY={1}>
						<Text bold color={theme.text}>
							GitHub Copilot
						</Text>
						{overlay.device ? (
							<>
								<Text color={theme.text}>1. Abra {overlay.device.verificationUri}</Text>
								<Text color={theme.text}>
									2. Digite o código:{' '}
									<Text bold color={theme.primary}>
										{overlay.device.userCode}
									</Text>
									<Text color={theme.muted}> (já copiado: é só colar)</Text>
								</Text>
								<Text color={theme.muted}>Aguardando você autorizar… (esc cancela)</Text>
							</>
						) : (
							<Text color={theme.muted}>Pedindo um código ao GitHub…</Text>
						)}
					</Box>
				);
			case 'approval':
				return <ApprovalBox theme={theme} name={overlay.name} summary={overlay.summary} onAnswer={answerApproval} />;
		}
	};

	const prompt = (
		<Prompt
			theme={theme}
			value={value}
			onChange={setValue}
			onSubmit={send}
			mode={cfg.mode}
			model={spec && cfg.model ? cfg.model : ''}
			provider={spec?.label ?? ''}
			busy={busy}
			focus={!overlay}
		/>
	);
	// Ink wraps a Box in a context provider only while it has a background, so toggling it would remount
	// the whole screen (losing dialog and input state); "none" is a truthy value Ink leaves uncoloured.
	const background = {backgroundColor: theme.bg ?? 'none'};
	const promptWidth = Math.min(columns - 4, 80);
	const hidden = Math.max(0, blocks.length - MAX_BLOCKS);
	const runningTool = live.tools.at(-1)?.summary;

	return (
		<Box width={columns} height={Math.max(rows - 1, 8)} flexDirection="column" overflow="hidden" {...background}>
			{home ? (
				<Box flexGrow={1} flexDirection="column" alignItems="center" justifyContent="center">
					<Logo theme={theme} columns={columns} size={overlay ? 'mini' : logoSizeFor(rows)} />
					<Box marginTop={1} width={promptWidth} flexDirection="column">
						{overlay ? (
							renderOverlay()
						) : (
							<>
								{prompt}
								<Suggestions theme={theme} items={suggestionItems} active={active} />
								<Box justifyContent="flex-end" marginTop={1}>
									<Text color={theme.text}>tab </Text>
									<Text color={theme.muted}>agentes </Text>
									<Text color={theme.text}> ctrl+p </Text>
									<Text color={theme.muted}>comandos</Text>
								</Box>
							</>
						)}
					</Box>
					{!overlay && rows >= 20 ? (
						<Box marginTop={1} width={promptWidth}>
							<Text color={theme.warn}>● </Text>
							<Text color={theme.muted}>Dica: {tip}</Text>
						</Box>
					) : null}
				</Box>
			) : (
				<Box flexGrow={1} flexDirection="row">
					<Box flexGrow={1} flexDirection="column" paddingX={2} paddingTop={1}>
						<Box ref={viewport} flexGrow={1} flexDirection="column" overflow="hidden" justifyContent="flex-end">
							<Box ref={content} flexDirection="column" flexShrink={0} marginBottom={-scroll}>
								{hidden > 0 ? <Text color={theme.muted}>… {hidden} mensagens antigas fora da tela (use /export para ver tudo)</Text> : null}
								{blocks.slice(hidden).map(block => (
									<BlockView key={block.id} block={block} theme={theme} showThinking={showThinking} details={details} />
								))}
								{live.thinking && showThinking ? (
									<Box marginTop={1} paddingLeft={3}>
										<Text italic color={theme.muted}>
											Pensando: {live.thinking.trim()}
										</Text>
									</Box>
								) : null}
								{live.text ? (
									<Box marginTop={1} paddingLeft={3}>
										<Markdown text={live.text} theme={theme} />
									</Box>
								) : null}
							</Box>
						</Box>
						{scroll > 0 ? (
							<Text color={theme.muted}>
								↓ {scroll} linhas abaixo · <Text color={theme.text}>End</Text> volta ao fim
							</Text>
						) : null}
						{busy ? <StatusLine theme={theme} tick={tick} seconds={Math.floor((Date.now() - started.current) / 1000)} thinking={showThinking ? '' : live.thinking} tool={runningTool} /> : null}
						{queued.map((item, index) => (
							<Box key={`${index}-${item}`} paddingLeft={3}>
								<Text color={theme.muted} wrap="truncate-end">
									↳ na fila: {item.split('\n')[0]}
								</Text>
							</Box>
						))}
						<Box marginTop={1} flexDirection="column">
							{overlay ? (
								renderOverlay()
							) : (
								<>
									{prompt}
									<Suggestions theme={theme} items={suggestionItems} active={active} />
								</>
							)}
						</Box>
					</Box>
					{sidebar ? (
						<Sidebar
							theme={theme}
							title={titleFrom(history.current)}
							context={usage.context}
							limit={limit}
							total={usage.total}
							model={spec && cfg.model ? cfg.model : ''}
							provider={spec?.label ?? ''}
							mode={cfg.mode}
							auto={auto}
							files={changed}
							branch={branch}
							version={VERSION}
						/>
					) : null}
				</Box>
			)}
			<Footer
				theme={theme}
				cwd={cwd}
				branch={sidebar ? undefined : branch}
				busy={busy}
				auto={auto}
				tokens={!sidebar && usage.context > 0 ? `${formatTokens(usage.context)}${limit ? ` (${Math.round((usage.context / limit) * 100)}%)` : ''} tokens` : undefined}
			/>
		</Box>
	);
}
