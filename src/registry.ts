import {secretStore, settingsStore} from './store.js';
import {anthropicProvider} from './providers/anthropic.js';
import {COPILOT_HEADERS, currentCopilot, savedCopilotSession} from './providers/copilot.js';
import {openAiProvider} from './providers/openai.js';
import type {FetchLike, Provider} from './types.js';

export type ProviderKind = 'openai' | 'anthropic' | 'copilot';

export type ProviderSpec = {
	id: string;
	label: string;
	kind: ProviderKind;
	baseUrl: string;
	/** Environment variable that can supply the key instead of the saved one. */
	envKey?: string;
	/** Local servers need no key at all. */
	keyless?: boolean;
	defaultModel?: string;
};

/** Ready-made entries: pick one in /connect and paste the key. */
export const PRESETS: ProviderSpec[] = [
	{id: 'copilot', label: 'GitHub Copilot', kind: 'copilot', baseUrl: '', defaultModel: 'gpt-4.1'},
	{id: 'openai', label: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1', envKey: 'OPENAI_API_KEY', defaultModel: 'gpt-4.1'},
	{id: 'anthropic', label: 'Anthropic', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', envKey: 'ANTHROPIC_API_KEY', defaultModel: 'claude-sonnet-4-5'},
	{id: 'openrouter', label: 'OpenRouter', kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1', envKey: 'OPENROUTER_API_KEY'},
	{id: 'groq', label: 'Groq', kind: 'openai', baseUrl: 'https://api.groq.com/openai/v1', envKey: 'GROQ_API_KEY'},
	{id: 'deepseek', label: 'DeepSeek', kind: 'openai', baseUrl: 'https://api.deepseek.com/v1', envKey: 'DEEPSEEK_API_KEY'},
	{id: 'gemini', label: 'Google Gemini', kind: 'openai', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', envKey: 'GEMINI_API_KEY'},
	{id: 'ollama', label: 'Ollama (local)', kind: 'openai', baseUrl: 'http://localhost:11434/v1', keyless: true},
	{id: 'lmstudio', label: 'LM Studio (local)', kind: 'openai', baseUrl: 'http://localhost:1234/v1', keyless: true},
	{id: 'custom', label: 'Outra API compatível com OpenAI', kind: 'openai', baseUrl: ''},
];

export type Config = {
	provider: string;
	model: string;
	mode: 'build' | 'plan';
	theme: string;
	/** Custom endpoints added by the user, on top of PRESETS. */
	custom: ProviderSpec[];
};

export const DEFAULT_CONFIG: Config = {provider: '', model: '', mode: 'build', theme: 'celestial', custom: []};

export const config = settingsStore<Config>('config.json', DEFAULT_CONFIG);
const keys = secretStore<Record<string, string>>('keys.json');

export function allSpecs(cfg: Config = config.read()): ProviderSpec[] {
	const custom = cfg.custom.filter(spec => !PRESETS.some(preset => preset.id === spec.id));
	return [...PRESETS.filter(preset => preset.id !== 'custom'), ...custom];
}

export function findSpec(id: string, cfg: Config = config.read()): ProviderSpec | undefined {
	return allSpecs(cfg).find(spec => spec.id === id);
}

export function saveKey(id: string, key: string): void {
	keys.write({...(keys.read() ?? {}), [id]: key.trim()});
}

export function removeKey(id: string): void {
	const all = {...(keys.read() ?? {})};
	delete all[id];
	keys.write(all);
}

/** Environment first, so a CI or a one-off shell can override without touching disk. */
export function resolveKey(spec: ProviderSpec): string | undefined {
	if (spec.envKey && process.env[spec.envKey]) return process.env[spec.envKey];
	return keys.read()?.[spec.id];
}

export function isConnected(spec: ProviderSpec): boolean {
	if (spec.kind === 'copilot') return Boolean(savedCopilotSession());
	if (spec.keyless) return true;
	return Boolean(resolveKey(spec));
}

export function connectedSpecs(cfg: Config = config.read()): ProviderSpec[] {
	return allSpecs(cfg).filter(isConnected);
}

/** Never throws for a missing key: the first request reports it in plain words. */
export function buildProvider(spec: ProviderSpec, fetchImpl: FetchLike = fetch): Provider {
	if (spec.kind === 'copilot') {
		return openAiProvider(
			spec.id,
			async () => {
				const session = await currentCopilot(new AbortController().signal, fetchImpl);
				if (!session) throw new Error('Você ainda não entrou no GitHub Copilot. Use /connect.');
				return {
					baseUrl: session.endpoint,
					headers: {Authorization: `Bearer ${session.copilotToken}`, ...COPILOT_HEADERS, 'openai-intent': 'conversation-panel'},
				};
			},
			fetchImpl,
		);
	}

	const auth = async () => {
		const key = resolveKey(spec);
		if (!key && !spec.keyless) throw new Error(`Falta a chave de ${spec.label}. Use /connect.`);
		const headers: Record<string, string> =
			spec.kind === 'anthropic' ? (key ? {'x-api-key': key} : {}) : key ? {Authorization: `Bearer ${key}`} : {};
		return {baseUrl: spec.baseUrl, headers};
	};
	return spec.kind === 'anthropic' ? anthropicProvider(spec.id, auth, fetchImpl) : openAiProvider(spec.id, auth, fetchImpl);
}

/** Hides everything but the last four characters, for showing a key back to its owner. */
export function maskKey(key: string): string {
	if (key.length <= 8) return '••••';
	return `${'•'.repeat(8)}${key.slice(-4)}`;
}
