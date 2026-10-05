export type Options = {folder?: string; continue: boolean; session?: string; version: boolean; help: boolean; error?: string};

export function parseArgs(args: string[]): Options {
	const options: Options = {continue: false, version: false, help: false};
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index] ?? '';
		if (arg === '-v' || arg === '--version') options.version = true;
		else if (arg === '-h' || arg === '--help') options.help = true;
		else if (arg === '-c' || arg === '--continue') options.continue = true;
		else if (arg === '-s' || arg === '--session') {
			const id = args[index + 1];
			if (!id) options.error = 'Falta o id depois de --session.';
			else options.session = id;
			index += 1;
		} else if (arg.startsWith('-')) options.error = `Opção desconhecida: ${arg}`;
		else options.folder = arg;
	}
	return options;
}
