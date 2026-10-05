export type Command = {name: string; hint: string; aliases?: string[]};

export const COMMANDS: Command[] = [
	{name: 'connect', hint: 'conectar provedor ou colar uma chave de API'},
	{name: 'models', hint: 'escolher o modelo'},
	{name: 'sessions', hint: 'retomar uma conversa', aliases: ['resume']},
	{name: 'new', hint: 'começar uma conversa nova', aliases: ['clear']},
	{name: 'undo', hint: 'desfazer a última resposta e os arquivos que ela mudou'},
	{name: 'init', hint: 'criar ou atualizar o AGENTS.md deste projeto'},
	{name: 'auto', hint: 'aprovar tudo sem perguntar (liga/desliga)'},
	{name: 'themes', hint: 'trocar o tema', aliases: ['theme']},
	{name: 'thinking', hint: 'mostrar ou ocultar o raciocínio'},
	{name: 'details', hint: 'mostrar ou ocultar a saída dos comandos'},
	{name: 'compact', hint: 'resumir a conversa para liberar contexto', aliases: ['summarize']},
	{name: 'export', hint: 'salvar a conversa em Markdown'},
	{name: 'disconnect', hint: 'remover as credenciais de um provedor'},
	{name: 'help', hint: 'atalhos e comandos'},
	{name: 'exit', hint: 'sair', aliases: ['quit', 'q']},
];

export function findCommand(name: string, extra: Command[] = []): Command | undefined {
	const wanted = name.toLowerCase();
	return [...COMMANDS, ...extra].find(command => command.name === wanted || command.aliases?.includes(wanted));
}

/** Commands whose name starts with what was typed after the slash. */
export function suggest(input: string, extra: Command[] = []): Command[] {
	if (!input.startsWith('/') || /\s/.test(input)) return [];
	const typed = input.slice(1).toLowerCase();
	return [...COMMANDS, ...extra.filter(item => !COMMANDS.some(builtin => builtin.name === item.name))].filter(command => command.name.startsWith(typed));
}

export function parseCommand(input: string): {name: string; args: string} {
	const [head = '', ...rest] = input.slice(1).trim().split(/\s+/);
	return {name: head.toLowerCase(), args: rest.join(' ')};
}
