import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {Box, Static, Text, useApp, useInput, useStdout} from 'ink';
import React, {useCallback, useRef, useState} from 'react';
import {runTurn, type AgentEvent} from './agent.js';
import {findCommand, parseCommand, suggest} from './commands.js';
import {
	exchangeCopilotToken,
	forgetCopilot,
	pollForGithubToken,
	saveCopilotSession,
	startDeviceFlow,
	type DeviceCode,
} from './providers/copilot.js';
import {
	allSpecs,
	buildProvider,
	config,
	connectedSpecs,
	findSpec,
	isConnected,
	removeKey,
	saveKey,
	type Config,
	type ProviderSpec,
} from './registry.js';
import {deleteSession, exportMarkdown, listSessions, newSession, saveSession, type Session} from './sessions.js';
import {THEMES, themeById} from './themes.js';
import type {Message} from './types.js';
import {BlockView, type Block, type NewBlock} from './ui/Blocks.js';
import {Input} from './ui/Input.js';
import {Logo} from './ui/Logo.js';
import {Prompt} from './ui/Prompt.js';
import {Select, type Choice} from './ui/Select.js';

export const VERSION = '0.1.0';

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

const SHORTCUTS: [string, string][] = [
	['tab', 'alternar Construir / Planejar'],
	['ctrl+p', 'paleta de comandos'],
	['esc', 'interromper o agente'],
	['ctrl+c', 'limpar o campo / sair (duas vezes)'],
	['ctrl+a / ctrl+e', 'início / fim da linha'],
	['ctrl+u', 'apagar até o início'],
];

function slug(text: string): string {
	return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);
}

export function App({cwd}: {cwd: string}) {
	const {exit} = useApp();
	const {stdout} = useStdout();
	const columns = stdout.columns ?? 80;

	const [cfg, setCfg] = useState<Config>(() => config.read());
	const [blocks, setBlocks] = useState<Block[]>([]);
	const [live, setLive] = useState<Live>(EMPTY_LIVE);
	const [value, setValue] = useState('');
	const [busy, setBusy] = useState(false);
	const [overlay, setOverlay] = useState<Overlay | null>(null);
	const [pick, setPick] = useState(0);
	const [showThinking, setShowThinking] = useState(false);
	const [epoch, setEpoch] = useState(0);
	const [tokens, setTokens] = useState({input: 0, output: 0});
	const [draft, setDraft] = useState('');
	const [exitArmed, setExitArmed] = useState(false);

	const theme = themeById(cfg.theme);
	const history = useRef<Message[]>([]);
	const session = useRef<Session>(newSession(cwd));
	const nextId = useRef(1);
	const abort = useRef<AbortController | null>(null);
	const loginAbort = useRef<AbortController | null>(null);
	const approval = useRef<((answer: boolean) => void) | null>(null);
	const alwaysAllowed = useRef(new Set<string>());
	const liveRef = useRef<Live>(EMPTY_LIVE);

	const spec = findSpec(cfg.provider, cfg);
	const modelLabel = spec && cfg.model ? `${cfg.model} ${spec.label}` : 'nenhum modelo · /connect';
	const home = blocks.length === 0 && !busy && live.tools.length === 0;
	const suggestions = overlay ? [] : suggest(value);

	const patchLive = (next: Live) => {
		liveRef.current = next;
		setLive(next);
	};

	const add = useCallback((block: NewBlock) => {
		setBlocks(current => [...current, {...block, id: nextId.current++} as Block]);
	}, []);

	const notice = useCallback((text: string, tone: 'info' | 'error' | 'ok' = 'info') => add({kind: 'notice', text, tone}), [add]);

	const update = (patch: Partial<Config>) => {
		const next = {...cfg, ...patch};
		config.write(next);
		setCfg(next);
	};

	/** Streamed prose and reasoning become permanent lines the moment a tool starts or the turn ends. */
	const flush = useCallback(() => {
		const current = liveRef.current;
		if (current.thinking.trim() && showThinking) add({kind: 'thinking', text: current.thinking});
		if (current.text.trim()) add({kind: 'assistant', text: current.text.trim()});
		const next = {...current, text: '', thinking: ''};
		liveRef.current = next;
		setLive(next);
	}, [add, showThinking]);

	const onEvent = useCallback(
		(event: AgentEvent) => {
			if (event.type === 'text') patchLive({...liveRef.current, text: liveRef.current.text + event.text});
			else if (event.type === 'thinking') patchLive({...liveRef.current, thinking: liveRef.current.thinking + event.text});
			else if (event.type === 'usage') setTokens(total => ({input: total.input + event.usage.input, output: total.output + event.usage.output}));
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

	const reset = (loaded?: Session) => {
		history.current = loaded ? [...loaded.messages] : [];
		session.current = loaded ?? newSession(cwd);
		alwaysAllowed.current.clear();
		stdout.write('\u001b[2J\u001b[3J\u001b[H');
		nextId.current = 1;
		setBlocks(
			(loaded?.messages ?? [])
				.filter(message => (message.role === 'user' || message.role === 'assistant') && message.content.trim())
				.map(message => ({id: nextId.current++, kind: message.role as 'user' | 'assistant', text: message.content})),
		);
		patchLive(EMPTY_LIVE);
		setTokens({input: 0, output: 0});
		setEpoch(count => count + 1);
	};

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
		const results = await Promise.allSettled(
			connected.map(async item => ({item, models: await buildProvider(item).listModels(new AbortController().signal)})),
		);
		const items: Choice[] = [];
		results.forEach((result, index) => {
			const item = connected[index];
			if (!item) return;
			if (result.status === 'fulfilled') {
				for (const model of result.value.models) items.push({id: `${item.id}::${model}`, label: model, group: item.label, ...(cfg.provider === item.id && cfg.model === model ? {hint: 'atual'} : {})});
			} else if (!item.keyless) {
				// A local server that is simply not running is normal, not worth a line in the list.
				items.push({id: `${item.id}::`, label: `(não consegui listar: ${result.reason instanceof Error ? result.reason.message.slice(0, 50) : 'erro'})`, group: item.label});
			}
		});
		setOverlay(current => (current?.kind === 'models' ? {kind: 'models', items} : current));
	}

	const compact = async () => {
		if (!spec || !cfg.model || history.current.length < 2) return notice('Ainda não há o que resumir.');
		setBusy(true);
		const controller = new AbortController();
		abort.current = controller;
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
			saveSession({...session.current, messages: history.current});
			notice('Conversa resumida.', 'ok');
		} catch (error) {
			notice(controller.signal.aborted ? 'Interrompido.' : (error instanceof Error ? error.message : String(error)), 'error');
		} finally {
			setBusy(false);
			abort.current = null;
		}
	};

	const runCommand = (text: string) => {
		const {name} = parseCommand(text);
		const command = findCommand(name) ?? suggest(`/${name}`)[0];
		setValue('');
		if (!command) return notice(`Comando desconhecido: /${name}. Digite /help.`, 'error');
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
				return setOverlay({kind: 'themes'});
			case 'help':
				return setOverlay({kind: 'help'});
			case 'thinking':
				setShowThinking(current => !current);
				return notice(`Raciocínio ${showThinking ? 'oculto' : 'visível'}.`);
			case 'new':
				return reset();
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
				return exit();
		}
	};

	const send = async (raw: string) => {
		const text = raw.trim();
		if (!text || busy) return;
		if (text.startsWith('/')) {
			const typed = parseCommand(text).name;
			if (!findCommand(typed) && suggestions[pick]) return runCommand(`/${suggestions[pick].name}`);
			return runCommand(text);
		}
		if (!spec || !cfg.model || !isConnected(spec)) {
			setValue('');
			return notice('Conecte um provedor e escolha um modelo com /connect.', 'error');
		}

		setValue('');
		setDraft('');
		add({kind: 'user', text});
		const userMessage: Message = {role: 'user', content: text};
		const controller = new AbortController();
		abort.current = controller;
		setBusy(true);
		patchLive(EMPTY_LIVE);

		try {
			const added = await runTurn({
				provider: buildProvider(spec),
				model: cfg.model,
				mode: cfg.mode,
				history: history.current,
				root: cwd,
				signal: controller.signal,
				onEvent,
				approve: request =>
					alwaysAllowed.current.has(request.name)
						? Promise.resolve(true)
						: new Promise<boolean>(resolve => {
								approval.current = resolve;
								setOverlay({kind: 'approval', name: request.name, summary: request.summary});
							}),
			});
			history.current = [...history.current, userMessage, ...added];
		} catch (error) {
			history.current = [...history.current, userMessage];
			notice(controller.signal.aborted ? 'Interrompido.' : (error instanceof Error ? error.message : String(error)), controller.signal.aborted ? 'info' : 'error');
		} finally {
			flush();
			patchLive(EMPTY_LIVE);
			setBusy(false);
			abort.current = null;
			saveSession({...session.current, messages: history.current});
		}
	};

	const answerApproval = (answer: boolean, always = false) => {
		const current = overlay;
		if (current?.kind === 'approval' && always) alwaysAllowed.current.add(current.name);
		setOverlay(null);
		approval.current?.(answer);
		approval.current = null;
	};

	useInput((input, key) => {
		if (key.ctrl && input === 'c') {
			if (busy) return abort.current?.abort();
			if (overlay) return setOverlay(null);
			if (value) return setValue('');
			if (exitArmed) return exit();
			setExitArmed(true);
			notice('Aperte ctrl+c de novo para sair.');
			setTimeout(() => setExitArmed(false), 2500);
			return;
		}
		if (overlay?.kind === 'approval') return;
		if (key.escape) {
			if (overlay?.kind === 'copilot') loginAbort.current?.abort();
			if (overlay) return setOverlay(null);
			if (busy) abort.current?.abort();
			return;
		}
		if (overlay) return;
		if (key.ctrl && input === 'p') return setOverlay({kind: 'palette'});
		if (key.tab) {
			if (suggestions[pick]) return setValue(`/${suggestions[pick].name} `);
			return update({mode: cfg.mode === 'build' ? 'plan' : 'build'});
		}
		if (suggestions.length > 0 && key.upArrow) return setPick((pick - 1 + suggestions.length) % suggestions.length);
		if (suggestions.length > 0 && key.downArrow) return setPick((pick + 1) % suggestions.length);
	});

	const close = () => setOverlay(null);
	const width = Math.min(columns - 4, 76);

	const renderOverlay = () => {
		if (!overlay) return null;
		switch (overlay.kind) {
			case 'palette':
				return (
					<Select
						title="Comandos"
						theme={theme}
						choices={[
							...suggest('/').map(command => ({id: command.name, label: `/${command.name}`, hint: command.hint})),
							{id: 'mode', label: 'Alternar Construir / Planejar', hint: 'tab'},
						]}
						onCancel={close}
						onPick={choice => {
							if (choice.id === 'mode') {
								close();
								return update({mode: cfg.mode === 'build' ? 'plan' : 'build'});
							}
							close();
							runCommand(`/${choice.id}`);
						}}
					/>
				);
			case 'connect':
				return (
					<Select
						title="Conectar provedor"
						theme={theme}
						choices={[
							...allSpecs(cfg).map(item => ({id: item.id, label: item.label, hint: item.keyless ? 'local' : isConnected(item) ? '✓ conectado' : ''})),
							{id: 'custom', label: 'Outra API compatível com OpenAI', hint: 'URL + chave'},
						]}
						onCancel={close}
						onPick={choice => {
							if (choice.id === 'custom') return setOverlay({kind: 'custom', step: 'url', url: ''});
							const picked = findSpec(choice.id, cfg);
							if (!picked) return;
							if (picked.kind === 'copilot') return void loginCopilot(picked);
							if (picked.keyless) return finishConnect(picked);
							setValue('');
							setOverlay({kind: 'key', spec: picked});
						}}
					/>
				);
			case 'disconnect':
				return (
					<Select
						title="Desconectar"
						theme={theme}
						choices={allSpecs(cfg).filter(isConnected).filter(item => !item.keyless).map(item => ({id: item.id, label: item.label}))}
						empty="Nada conectado."
						onCancel={close}
						onPick={choice => {
							if (choice.id === 'copilot') forgetCopilot();
							else removeKey(choice.id);
							if (cfg.provider === choice.id) update({provider: '', model: ''});
							close();
							notice('Credenciais removidas.', 'ok');
						}}
					/>
				);
			case 'models':
				return overlay.items === null ? (
					<Box borderStyle="round" borderColor={theme.accent} paddingX={1}>
						<Text color={theme.dim}>Buscando modelos…</Text>
					</Box>
				) : (
					<Select
						title="Modelos"
						theme={theme}
						choices={overlay.items}
						empty="Nenhum modelo encontrado."
						onCancel={close}
						onPick={choice => {
							const [provider = '', model = ''] = choice.id.split('::');
							if (!model) return;
							update({provider, model});
							close();
							notice(`Modelo: ${model}`, 'ok');
						}}
					/>
				);
			case 'sessions':
				return (
					<Select
						title="Conversas"
						theme={theme}
						choices={listSessions().map(item => ({id: item.id, label: item.title, hint: item.updatedAt.slice(0, 16).replace('T', ' ')}))}
						empty="Nenhuma conversa salva."
						onCancel={close}
						onPick={choice => {
							const loaded = listSessions().find(item => item.id === choice.id);
							close();
							if (loaded) reset(loaded);
						}}
					/>
				);
			case 'themes':
				return (
					<Select
						title="Temas"
						theme={theme}
						searchable={false}
						choices={THEMES.map(item => ({id: item.id, label: item.label, hint: item.id === cfg.theme ? 'atual' : ''}))}
						onCancel={close}
						onPick={choice => {
							update({theme: choice.id});
							close();
						}}
					/>
				);
			case 'help':
				return (
					<Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
						<Text bold color={theme.accent}>
							Atalhos
						</Text>
						{SHORTCUTS.map(([keys, what]) => (
							<Text key={keys} color={theme.text}>
								<Text color={theme.soft}>{keys.padEnd(16)}</Text>
								{what}
							</Text>
						))}
						<Text bold color={theme.accent}>
							Comandos
						</Text>
						{suggest('/').map(command => (
							<Text key={command.name} color={theme.text}>
								<Text color={theme.soft}>{`/${command.name}`.padEnd(16)}</Text>
								{command.hint}
							</Text>
						))}
						<Text color={theme.dim}>esc para fechar</Text>
					</Box>
				);
			case 'key':
				return (
					<Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
						<Text bold color={theme.accent}>
							Chave de {overlay.spec.label}
						</Text>
						<Text color={theme.dim}>
							Cole a chave. Ela fica criptografada neste computador{overlay.spec.envKey ? ` (ou use a variável ${overlay.spec.envKey})` : ''}.
						</Text>
						<Input
							mask
							value={draft}
							onChange={setDraft}
							dim={theme.dim}
							color={theme.text}
							placeholder="sk-…"
							onSubmit={text => {
								if (!text.trim()) return;
								saveKey(overlay.spec.id, text);
								setDraft('');
								finishConnect(overlay.spec);
							}}
						/>
						<Text color={theme.dim}>enter salvar · esc cancelar</Text>
					</Box>
				);
			case 'custom':
				return (
					<Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
						<Text bold color={theme.accent}>
							{overlay.step === 'url' ? 'Endereço da API' : 'Chave (opcional)'}
						</Text>
						<Text color={theme.dim}>
							{overlay.step === 'url' ? 'Ex.: https://meu-servidor.com/v1 (precisa ser compatível com OpenAI)' : `Para ${overlay.url}. Deixe vazio se não precisa.`}
						</Text>
						<Input
							mask={overlay.step === 'key'}
							value={draft}
							onChange={setDraft}
							dim={theme.dim}
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
								config.write({...cfg, custom: [...cfg.custom.filter(item => item.id !== custom.id), custom]});
								setCfg(config.read());
								setDraft('');
								finishConnect(custom);
							}}
						/>
						<Text color={theme.dim}>enter continuar · esc cancelar</Text>
					</Box>
				);
			case 'copilot':
				return (
					<Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={1}>
						<Text bold color={theme.accent}>
							GitHub Copilot
						</Text>
						{overlay.device ? (
							<>
								<Text color={theme.text}>1. Abra {overlay.device.verificationUri}</Text>
								<Text color={theme.text}>
									2. Digite o código: <Text bold color={theme.accent}>{overlay.device.userCode}</Text>
								</Text>
								<Text color={theme.dim}>Aguardando você autorizar… (esc cancela)</Text>
							</>
						) : (
							<Text color={theme.dim}>Pedindo um código ao GitHub…</Text>
						)}
					</Box>
				);
			case 'approval':
				return <ApprovalBox theme={theme} name={overlay.name} summary={overlay.summary} onAnswer={answerApproval} />;
		}
	};

	return (
		<Box flexDirection="column" width={columns}>
			<Static items={blocks} key={epoch}>
				{block => (
					<Box key={block.id} flexDirection="column">
						<BlockView block={block} theme={theme} showThinking={showThinking} />
					</Box>
				)}
			</Static>

			{home ? (
				<Box flexDirection="column" alignItems="center" marginTop={1}>
					<Logo theme={theme} columns={columns} />
					<Box marginTop={1} flexDirection="column" width={width}>
						{overlay ? (
							renderOverlay()
						) : (
							<>
								<Prompt theme={theme} value={value} onChange={setValue} onSubmit={text => void send(text)} mode={cfg.mode} modelLabel={modelLabel} busy={busy} focus width={width} />
								<Suggestions theme={theme} items={suggestions} active={pick} />
								<Box justifyContent="flex-end">
									<Text color={theme.text}>tab </Text>
									<Text color={theme.dim}>agentes </Text>
									<Text color={theme.text}> ctrl+p </Text>
									<Text color={theme.dim}>comandos</Text>
								</Box>
							</>
						)}
					</Box>
				</Box>
			) : (
				<Box flexDirection="column">
					{live.thinking && showThinking ? (
						<Box marginLeft={2}>
							<Text italic color={theme.dim}>
								{live.thinking.trim().split('\n').slice(-3).join('\n')}
							</Text>
						</Box>
					) : null}
					{live.text ? (
						<Box marginTop={1} marginLeft={2}>
							<Text color={theme.text}>{live.text}</Text>
						</Box>
					) : null}
					{live.tools.map(tool => (
						<Box key={tool.callId} marginLeft={2}>
							<Text color={theme.accent}>◐ <Text color={theme.dim}>{tool.summary}</Text></Text>
						</Box>
					))}
					{busy && !live.text && live.tools.length === 0 ? (
						<Box marginLeft={2}>
							<Text color={theme.dim}>pensando…</Text>
						</Box>
					) : null}
					<Box marginTop={1} flexDirection="column">
						{overlay ? (
							renderOverlay()
						) : (
							<>
								<Prompt theme={theme} value={value} onChange={setValue} onSubmit={text => void send(text)} mode={cfg.mode} modelLabel={modelLabel} busy={busy} focus />
								<Suggestions theme={theme} items={suggestions} active={pick} />
							</>
						)}
					</Box>
				</Box>
			)}

			<Box justifyContent="space-between" paddingX={1}>
				<Text color={theme.dim}>{cwd}</Text>
				<Text color={theme.dim}>
					{tokens.input + tokens.output > 0 ? `${tokens.input + tokens.output} tokens · ` : ''}
					{VERSION}
				</Text>
			</Box>
		</Box>
	);
}

function Suggestions({theme, items, active}: {theme: ReturnType<typeof themeById>; items: ReturnType<typeof suggest>; active: number}) {
	if (items.length === 0) return null;
	const current = Math.min(active, items.length - 1);
	return (
		<Box flexDirection="column" paddingLeft={2}>
			{items.slice(0, 6).map((command, index) => (
				<Text key={command.name} {...(index === current ? {color: theme.accent, bold: true} : {color: theme.dim})}>
					{`/${command.name}`.padEnd(14)}
					{command.hint}
				</Text>
			))}
		</Box>
	);
}

function ApprovalBox({theme, name, summary, onAnswer}: {theme: ReturnType<typeof themeById>; name: string; summary: string; onAnswer: (allow: boolean, always?: boolean) => void}) {
	useInput((input, key) => {
		const letter = input.toLowerCase();
		if (letter === 's' || letter === 'y' || key.return) onAnswer(true);
		else if (letter === 'a') onAnswer(true, true);
		else if (letter === 'n' || key.escape) onAnswer(false);
	});
	return (
		<Box flexDirection="column" borderStyle="round" borderColor={theme.warn} paddingX={1}>
			<Text bold color={theme.warn}>
				Permitir esta ação?
			</Text>
			<Text color={theme.text}>{summary}</Text>
			<Text color={theme.dim}>
				<Text color={theme.ok}>s</Text>/enter sim · <Text color={theme.soft}>a</Text> sempre ({name}) · <Text color={theme.bad}>n</Text>/esc não
			</Text>
		</Box>
	);
}
