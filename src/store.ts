import {execFileSync} from 'node:child_process';
import {chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, join} from 'node:path';

/** Everything SERAPH keeps about the user lives here, never inside a project. */
export function seraphHome(): string {
	return process.env['SERAPH_HOME'] ?? join(homedir(), '.seraph');
}

const protectScript =
	"Add-Type -AssemblyName System.Security;$v=[Console]::In.ReadToEnd();$b=[Text.Encoding]::UTF8.GetBytes($v);[Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Protect($b,$null,'CurrentUser'))";
const unprotectScript =
	"Add-Type -AssemblyName System.Security;$v=[Console]::In.ReadToEnd();$b=[Convert]::FromBase64String($v);[Text.Encoding]::UTF8.GetString([System.Security.Cryptography.ProtectedData]::Unprotect($b,$null,'CurrentUser'))";

type Sealed = {version: 1; protection: 'dpapi' | 'none'; data: string};

function powershell(script: string, input: string): string {
	return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
		input,
		encoding: 'utf8',
		windowsHide: true,
	}).trim();
}

/** Windows seals the file to the current user; elsewhere it is kept at mode 0600. */
function seal(json: string): Sealed {
	if (process.platform === 'win32') return {version: 1, protection: 'dpapi', data: powershell(protectScript, json)};
	return {version: 1, protection: 'none', data: Buffer.from(json, 'utf8').toString('base64')};
}

function unseal(sealed: Sealed): string {
	if (sealed.protection === 'dpapi') {
		if (process.platform !== 'win32') throw new Error('Credenciais protegidas pelo Windows não abrem aqui.');
		return powershell(unprotectScript, sealed.data);
	}
	return Buffer.from(sealed.data, 'base64').toString('utf8');
}

/** An encrypted JSON store: used for API keys and the Copilot session. */
export function secretStore<T>(name: string) {
	// Resolved per call: a path frozen at import time ignores SERAPH_HOME set later.
	const file = () => join(seraphHome(), name);
	return {
		get path() {
			return file();
		},
		read(): T | undefined {
			const path = file();
			if (!existsSync(path)) return undefined;
			try {
				const sealed = JSON.parse(readFileSync(path, 'utf8')) as Sealed;
				return JSON.parse(unseal(sealed)) as T;
			} catch {
				return undefined;
			}
		},
		write(value: T): void {
			const path = file();
			mkdirSync(dirname(path), {recursive: true, mode: 0o700});
			// Write then rename, so a crash never leaves a half-written secrets file.
			const temp = `${path}.tmp`;
			writeFileSync(temp, JSON.stringify(seal(JSON.stringify(value)), null, 2), {encoding: 'utf8', mode: 0o600});
			renameSync(temp, path);
			if (process.platform !== 'win32') chmodSync(path, 0o600);
		},
		clear(): void {
			rmSync(file(), {force: true});
		},
	};
}

/** Plain, shareable settings: no secrets in here. */
export function settingsStore<T extends object>(name: string, defaults: T) {
	const file = () => join(seraphHome(), name);
	return {
		get path() {
			return file();
		},
		read(): T {
			try {
				return {...defaults, ...(JSON.parse(readFileSync(file(), 'utf8')) as Partial<T>)};
			} catch {
				return {...defaults};
			}
		},
		write(value: T): void {
			mkdirSync(dirname(file()), {recursive: true});
			writeFileSync(file(), `${JSON.stringify(value, null, 2)}\n`, 'utf8');
		},
	};
}
