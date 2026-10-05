import {secretStore} from '../store.js';
import type {FetchLike} from '../types.js';

/** Public client id used by GitHub Copilot Chat for the device flow. */
const CLIENT_ID = 'Iv1.b507a08c87ecfe98';
const REFRESH_SKEW_MS = 5 * 60 * 1000;

export const COPILOT_HEADERS = {
	'User-Agent': 'GitHubCopilotChat/0.35.0',
	'Editor-Version': 'vscode/1.107.0',
	'Editor-Plugin-Version': 'copilot-chat/0.35.0',
	'Copilot-Integration-Id': 'vscode-chat',
} as const;

export type CopilotSession = {
	githubToken: string;
	copilotToken: string;
	expiresAt: number;
	endpoint: string;
	enterpriseDomain?: string;
};

export type DeviceCode = {
	deviceCode: string;
	userCode: string;
	verificationUri: string;
	intervalSeconds: number;
	expiresInSeconds: number;
};

const store = secretStore<CopilotSession>('copilot.json');

export function savedCopilotSession(): CopilotSession | undefined {
	return store.read();
}

export function forgetCopilot(): void {
	store.clear();
}

export function normalizeDomain(input: string): string | undefined {
	const trimmed = input.trim();
	if (!trimmed) return undefined;
	try {
		return new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`).hostname;
	} catch {
		return undefined;
	}
}

/** The Copilot token carries its own account-specific host: `proxy-ep=proxy.individual...`. */
export function endpointFromToken(token: string, enterpriseDomain?: string): string {
	for (const part of token.split(';')) {
		const [key, value] = part.split('=');
		if (key?.trim() === 'proxy-ep' && value) return `https://${value.trim().replace(/^proxy\./, 'api.')}`;
	}
	if (enterpriseDomain) return `https://copilot-api.${enterpriseDomain}`;
	return 'https://api.individual.githubcopilot.com';
}

async function json(response: Response): Promise<Record<string, unknown>> {
	const text = await response.text();
	if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 300)}`);
	const parsed: unknown = text ? JSON.parse(text) : {};
	if (typeof parsed !== 'object' || parsed === null) throw new Error('Resposta inválida do GitHub');
	return parsed as Record<string, unknown>;
}

export async function startDeviceFlow(
	domain: string,
	signal: AbortSignal,
	fetchImpl: FetchLike = fetch,
): Promise<DeviceCode> {
	const data = await json(
		await fetchImpl(`https://${domain}/login/device/code`, {
			method: 'POST',
			headers: {Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': COPILOT_HEADERS['User-Agent']},
			body: new URLSearchParams({client_id: CLIENT_ID, scope: 'read:user'}),
			signal,
		}),
	);

	const {device_code: deviceCode, user_code: userCode, verification_uri: uri, interval, expires_in: expiresIn} = data;
	if (typeof deviceCode !== 'string' || typeof userCode !== 'string' || typeof uri !== 'string' || typeof expiresIn !== 'number') {
		throw new Error('Resposta de código de dispositivo inválida');
	}
	// A hostile response must not send the user to a non-HTTPS page to type a code.
	if (new URL(uri).protocol !== 'https:') throw new Error('Endereço de verificação não confiável');

	return {
		deviceCode,
		userCode,
		verificationUri: uri,
		intervalSeconds: typeof interval === 'number' ? interval : 5,
		expiresInSeconds: expiresIn,
	};
}

const wait = (ms: number, signal: AbortSignal) =>
	new Promise<void>((resolve, reject) => {
		const timer = setTimeout(() => {
			signal.removeEventListener('abort', onAbort);
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timer);
			reject(new Error('Login cancelado'));
		};
		signal.addEventListener('abort', onAbort, {once: true});
	});

export async function pollForGithubToken(
	domain: string,
	device: DeviceCode,
	signal: AbortSignal,
	fetchImpl: FetchLike = fetch,
	sleep: (ms: number, signal: AbortSignal) => Promise<void> = wait,
): Promise<string> {
	const deadline = Date.now() + device.expiresInSeconds * 1000;
	let intervalMs = device.intervalSeconds * 1000;

	while (Date.now() < deadline) {
		await sleep(intervalMs, signal);
		const data = await json(
			await fetchImpl(`https://${domain}/login/oauth/access_token`, {
				method: 'POST',
				headers: {Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': COPILOT_HEADERS['User-Agent']},
				body: new URLSearchParams({
					client_id: CLIENT_ID,
					device_code: device.deviceCode,
					grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
				}),
				signal,
			}),
		);

		if (typeof data['access_token'] === 'string') return data['access_token'];
		const error = data['error'];
		if (error === 'authorization_pending') continue;
		if (error === 'slow_down') {
			intervalMs = typeof data['interval'] === 'number' ? data['interval'] * 1000 : intervalMs + 5000;
			continue;
		}
		if (error === 'access_denied') throw new Error('Você recusou o acesso no GitHub.');
		throw new Error(`Falha no login: ${String(error ?? 'erro desconhecido')}`);
	}
	throw new Error('O código expirou. Rode /connect de novo.');
}

export async function exchangeCopilotToken(
	githubToken: string,
	enterpriseDomain: string | undefined,
	signal: AbortSignal,
	fetchImpl: FetchLike = fetch,
): Promise<CopilotSession> {
	const domain = enterpriseDomain ?? 'github.com';
	const data = await json(
		await fetchImpl(`https://api.${domain}/copilot_internal/v2/token`, {
			headers: {Accept: 'application/json', Authorization: `Bearer ${githubToken}`, ...COPILOT_HEADERS},
			signal,
		}),
	);
	const token = data['token'];
	const expiresAt = data['expires_at'];
	if (typeof token !== 'string' || typeof expiresAt !== 'number') {
		throw new Error('Esta conta do GitHub não tem acesso ao Copilot.');
	}
	return {
		githubToken,
		copilotToken: token,
		expiresAt: expiresAt * 1000 - REFRESH_SKEW_MS,
		endpoint: endpointFromToken(token, enterpriseDomain),
		...(enterpriseDomain ? {enterpriseDomain} : {}),
	};
}

export function saveCopilotSession(session: CopilotSession): void {
	store.write(session);
}

/** A usable Copilot session, refreshed on demand; undefined when never signed in. */
export async function currentCopilot(signal: AbortSignal, fetchImpl: FetchLike = fetch): Promise<CopilotSession | undefined> {
	const saved = store.read();
	if (!saved?.githubToken) return undefined;
	if (Date.now() < saved.expiresAt) return saved;
	const fresh = await exchangeCopilotToken(saved.githubToken, saved.enterpriseDomain, signal, fetchImpl);
	store.write(fresh);
	return fresh;
}
