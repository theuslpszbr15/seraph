import assert from 'node:assert/strict';
import {mkdtempSync, readdirSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {after, before, test} from 'node:test';
import {
	endpointFromToken,
	exchangeCopilotToken,
	forgetCopilot,
	normalizeDomain,
	pollForGithubToken,
	savedCopilotSession,
	saveCopilotSession,
	startDeviceFlow,
} from '../src/providers/copilot.ts';
import {allSpecs, config, findSpec, isConnected, maskKey, PRESETS, removeKey, resolveKey, saveKey} from '../src/registry.ts';
import {deleteSession, exportMarkdown, listSessions, loadSession, newSession, saveSession, titleFrom} from '../src/sessions.ts';
import {secretStore} from '../src/store.ts';

let home = '';
let previous: string | undefined;

before(() => {
	previous = process.env['SERAPH_HOME'];
	home = mkdtempSync(join(tmpdir(), 'seraph-home-'));
	process.env['SERAPH_HOME'] = home;
});

after(() => {
	if (previous === undefined) delete process.env['SERAPH_HOME'];
	else process.env['SERAPH_HOME'] = previous;
	rmSync(home, {recursive: true, force: true});
});

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {status});

test('segredos: ida e volta funciona e o arquivo não guarda o texto puro', () => {
	const store = secretStore<{token: string}>('teste.json');
	store.write({token: 'SEGREDO-MUITO-ESPECIFICO-123'});
	assert.deepEqual(store.read(), {token: 'SEGREDO-MUITO-ESPECIFICO-123'});
	assert.ok(!readFileSync(join(home, 'teste.json'), 'utf8').includes('SEGREDO-MUITO-ESPECIFICO-123'));
	store.clear();
	assert.equal(store.read(), undefined);
});

test('registro: salva, lê, mascara e a variável de ambiente tem prioridade', () => {
	const openai = findSpec('openai');
	assert.ok(openai?.envKey);
	const previousEnv = process.env[openai.envKey];
	delete process.env[openai.envKey];
	try {
		assert.equal(isConnected(openai), false);
		saveKey('openai', '  sk-abcdef123456  ');
		assert.equal(resolveKey(openai), 'sk-abcdef123456');
		assert.equal(isConnected(openai), true);
		process.env[openai.envKey] = 'sk-do-ambiente';
		assert.equal(resolveKey(openai), 'sk-do-ambiente');
		delete process.env[openai.envKey];
		removeKey('openai');
		assert.equal(resolveKey(openai), undefined);
	} finally {
		if (previousEnv !== undefined) process.env[openai.envKey] = previousEnv;
	}
	assert.equal(maskKey('sk-abcdef123456'), '••••••••3456');
	assert.equal(maskKey('curta'), '••••');
});

test('registro: servidores locais dispensam chave e provedores têm ids únicos', () => {
	assert.equal(isConnected(findSpec('ollama')!), true);
	const ids = allSpecs().map(spec => spec.id);
	assert.equal(new Set(ids).size, ids.length);
	assert.ok(PRESETS.every(spec => spec.kind === 'copilot' || spec.kind === 'anthropic' || spec.kind === 'openai'));
});

test('registro: NVIDIA aponta para o endpoint compatível e lê NVIDIA_API_KEY', () => {
	const nvidia = findSpec('nvidia');
	assert.equal(nvidia?.kind, 'openai');
	assert.equal(nvidia?.baseUrl, 'https://integrate.api.nvidia.com/v1');
	assert.equal(nvidia?.envKey, 'NVIDIA_API_KEY');
});

test('registro: configuração padrão vem completa e persiste', () => {
	assert.equal(config.read().theme, 'celestial');
	config.write({...config.read(), model: 'gpt-x'});
	assert.equal(config.read().model, 'gpt-x');
});

test('sessões: salva, lista, carrega, exporta e rejeita id com caminho', () => {
	const session = newSession('C:\\proj');
	session.messages = [
		{role: 'user', content: 'Como faço X?'},
		{role: 'assistant', content: 'Assim.'},
	];
	saveSession(session);
	const listed = listSessions();
	assert.equal(listed.length, 1);
	assert.equal(listed[0]?.title, 'Como faço X?');
	assert.equal(loadSession(session.id)?.messages.length, 2);
	assert.match(exportMarkdown(session), /### Você[\s\S]*### SERAPH/);
	assert.equal(loadSession('../../etc/passwd'), undefined);
	deleteSession(session.id);
	assert.equal(listSessions().length, 0);
	assert.equal(titleFrom([]), 'Nova conversa');
	assert.ok(titleFrom([{role: 'user', content: 'a'.repeat(200)}]).length <= 60);
	assert.deepEqual(readdirSync(join(home, 'sessions')).filter(name => name.endsWith('.tmp')), []);
});

test('copilot: normaliza domínio e deduz o endpoint do próprio token', () => {
	assert.equal(normalizeDomain('https://empresa.ghe.com/path'), 'empresa.ghe.com');
	assert.equal(normalizeDomain('  '), undefined);
	assert.equal(endpointFromToken('tid=1;proxy-ep=proxy.individual.githubcopilot.com;x=2'), 'https://api.individual.githubcopilot.com');
	assert.equal(endpointFromToken('sem-proxy', 'ghe.com'), 'https://copilot-api.ghe.com');
	assert.equal(endpointFromToken('sem-proxy'), 'https://api.individual.githubcopilot.com');
});

test('copilot: login completo — código, espera pela autorização, troca de token e gravação', async () => {
	const calls: string[] = [];
	let polls = 0;
	const fake = (async (url: string | URL | Request) => {
		const address = String(url);
		calls.push(address);
		if (address.endsWith('/login/device/code')) {
			return reply({device_code: 'dc', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', interval: 5, expires_in: 900});
		}
		if (address.endsWith('/login/oauth/access_token')) {
			polls += 1;
			return reply(polls < 3 ? {error: 'authorization_pending'} : {access_token: 'gho_abc'});
		}
		if (address.endsWith('/copilot_internal/v2/token')) {
			return reply({token: 'tid=1;proxy-ep=proxy.individual.githubcopilot.com', expires_at: Math.floor(Date.now() / 1000) + 1800});
		}
		throw new Error(`url inesperada: ${address}`);
	}) as typeof fetch;

	const signal = new AbortController().signal;
	const device = await startDeviceFlow('github.com', signal, fake);
	assert.equal(device.userCode, 'ABCD-1234');
	const waits: number[] = [];
	const githubToken = await pollForGithubToken('github.com', device, signal, fake, async ms => void waits.push(ms));
	assert.equal(githubToken, 'gho_abc');
	assert.equal(polls, 3);
	assert.deepEqual(waits, [5000, 5000, 5000]);

	const session = await exchangeCopilotToken(githubToken, undefined, signal, fake);
	assert.equal(session.endpoint, 'https://api.individual.githubcopilot.com');
	assert.ok(session.expiresAt > Date.now());
	saveCopilotSession(session);
	assert.equal(savedCopilotSession()?.githubToken, 'gho_abc');
	assert.ok(!readFileSync(join(home, 'copilot.json'), 'utf8').includes('gho_abc'));
	assert.equal(isConnected(findSpec('copilot')!), true);
	forgetCopilot();
	assert.equal(savedCopilotSession(), undefined);
	assert.equal(isConnected(findSpec('copilot')!), false);
});

test('copilot: recusar no GitHub e endereço não-HTTPS são erros claros', async () => {
	const signal = new AbortController().signal;
	const denied = (async () => reply({error: 'access_denied'})) as typeof fetch;
	await assert.rejects(
		pollForGithubToken('github.com', {deviceCode: 'x', userCode: 'u', verificationUri: 'https://github.com/login/device', intervalSeconds: 1, expiresInSeconds: 60}, signal, denied, async () => undefined),
		/recusou/,
	);
	const insecure = (async () => reply({device_code: 'd', user_code: 'u', verification_uri: 'http://evil.example/x', expires_in: 60})) as typeof fetch;
	await assert.rejects(startDeviceFlow('github.com', signal, insecure), /não confiável/);
});

test('copilot: conta sem acesso ao Copilot explica o motivo', async () => {
	const noAccess = (async () => reply({message: 'sem plano'})) as typeof fetch;
	await assert.rejects(exchangeCopilotToken('gho', undefined, new AbortController().signal, noAccess), /não tem acesso ao Copilot/);
});
