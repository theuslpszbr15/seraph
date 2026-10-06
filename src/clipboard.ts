import {execFile, spawn} from 'node:child_process';

const WINDOWS_READ = "[Console]::OutputEncoding=[Text.Encoding]::UTF8; $t = Get-Clipboard -Raw; if ($t) { [Console]::Out.Write($t) }";
const WINDOWS_WRITE = '[Console]::InputEncoding=[Text.Encoding]::UTF8; Set-Clipboard -Value ([Console]::In.ReadToEnd())';

/** The system clipboard as text, or undefined when it is empty or unreachable. */
export function readClipboard(): Promise<string | undefined> {
	const [command, args]: [string, string[]] =
		process.platform === 'win32'
			? ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_READ]]
			: process.platform === 'darwin'
				? ['pbpaste', []]
				: ['sh', ['-c', 'wl-paste -n 2>/dev/null || xclip -selection clipboard -o 2>/dev/null || xsel -b -o']];
	return new Promise(resolve => {
		execFile(command, args, {encoding: 'utf8', windowsHide: true, timeout: 5000, maxBuffer: 10 * 1024 * 1024}, (error, stdout) => {
			resolve(error || !stdout ? undefined : stdout);
		});
	});
}

export function writeClipboard(text: string): Promise<boolean> {
	const [command, args]: [string, string[]] =
		process.platform === 'win32'
			? ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_WRITE]]
			: process.platform === 'darwin'
				? ['pbcopy', []]
				: ['sh', ['-c', 'wl-copy 2>/dev/null || xclip -selection clipboard 2>/dev/null || xsel -b -i']];
	return new Promise(resolve => {
		const child = spawn(command, args, {windowsHide: true, stdio: ['pipe', 'ignore', 'ignore']});
		child.on('error', () => resolve(false));
		child.on('close', code => resolve(code === 0));
		child.stdin.end(text, 'utf8');
	});
}
