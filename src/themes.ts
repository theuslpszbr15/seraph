import {readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {seraphHome} from './store.js';

export type Theme = {
	id: string;
	label: string;
	/** Screen background; undefined keeps the terminal's own. */
	bg: string | undefined;
	/** Side panel and dialogs. */
	panel: string;
	/** Prompt box and user messages. */
	element: string;
	border: string;
	text: string;
	muted: string;
	/** Construir mode, selection, logo. */
	primary: string;
	/** Tool lines and links. */
	secondary: string;
	/** Planejar mode, inline code. */
	accent: string;
	ok: string;
	warn: string;
	bad: string;
};

type Colors = Omit<Theme, 'id' | 'label'>;

function theme(id: string, label: string, colors: Colors): Theme {
	return {id, label, ...colors};
}

const OPENCODE: Colors = {
	bg: '#0a0a0a',
	panel: '#141414',
	element: '#1e1e1e',
	border: '#484848',
	text: '#eeeeee',
	muted: '#808080',
	primary: '#fab283',
	secondary: '#5c9cf5',
	accent: '#9d7cd8',
	ok: '#7fd88f',
	warn: '#f5a742',
	bad: '#e06c75',
};

/** The company palettes keep their names; their `surface`/`accent` pairs map onto these tokens. */
function surface(id: string, label: string, s: [bg: string, panel: string, edge: string, ink: string, dim: string, bubble: string], a: [primary: string, bright: string, tool: string, ok: string, warn: string, danger: string]): Theme {
	return theme(id, label, {bg: s[0], panel: s[1], border: s[2], text: s[3], muted: s[4], element: s[5], primary: a[0], accent: a[1], secondary: a[2], ok: a[3], warn: a[4], bad: a[5]});
}

export const THEMES: Theme[] = [
	theme('seraph', 'Seraph (padrão)', OPENCODE),
	theme('terminal', 'Fundo do terminal', {...OPENCODE, bg: undefined}),
	theme('celestial', 'Celestial', {bg: '#0d1020', panel: '#11152a', element: '#1a2040', border: '#2a3358', text: '#edeff5', muted: '#7c8498', primary: '#f5d76e', secondary: '#9ad1ff', accent: '#c7b8ff', ok: '#7ee2a8', warn: '#f5b14c', bad: '#ff7a8a'}),
	theme('tokyonight', 'Tokyo Night', {bg: '#1a1b26', panel: '#16161e', element: '#292e42', border: '#3b4261', text: '#c0caf5', muted: '#565f89', primary: '#7aa2f7', secondary: '#7dcfff', accent: '#bb9af7', ok: '#9ece6a', warn: '#e0af68', bad: '#f7768e'}),
	theme('catppuccin', 'Catppuccin', {bg: '#1e1e2e', panel: '#181825', element: '#313244', border: '#45475a', text: '#cdd6f4', muted: '#7f849c', primary: '#89b4fa', secondary: '#94e2d5', accent: '#cba6f7', ok: '#a6e3a1', warn: '#f9e2af', bad: '#f38ba8'}),
	theme('dracula', 'Dracula', {bg: '#282a36', panel: '#21222c', element: '#44475a', border: '#6272a4', text: '#f8f8f2', muted: '#6272a4', primary: '#bd93f9', secondary: '#8be9fd', accent: '#ff79c6', ok: '#50fa7b', warn: '#f1fa8c', bad: '#ff5555'}),
	theme('gruvbox', 'Gruvbox', {bg: '#282828', panel: '#1d2021', element: '#3c3836', border: '#504945', text: '#ebdbb2', muted: '#928374', primary: '#fe8019', secondary: '#83a598', accent: '#d3869b', ok: '#b8bb26', warn: '#fabd2f', bad: '#fb4934'}),
	theme('nord', 'Nord', {bg: '#2e3440', panel: '#2b303b', element: '#3b4252', border: '#4c566a', text: '#eceff4', muted: '#7b88a1', primary: '#88c0d0', secondary: '#81a1c1', accent: '#b48ead', ok: '#a3be8c', warn: '#ebcb8b', bad: '#bf616a'}),
	theme('onedark', 'One Dark', {bg: '#282c34', panel: '#21252b', element: '#2c313a', border: '#3e4451', text: '#abb2bf', muted: '#5c6370', primary: '#61afef', secondary: '#56b6c2', accent: '#c678dd', ok: '#98c379', warn: '#e5c07b', bad: '#e06c75'}),
	surface('aco', 'Aço', ['#171c22', '#111519', '#2a323c', '#e5ecf3', '#95a3b3', '#2a323c'], ['#60a5fa', '#93c5fd', '#38bdf8', '#34d399', '#fbbf24', '#f87171']),
	surface('ambar', 'Âmbar', ['#1c1917', '#141110', '#332e29', '#f5f0e8', '#a8a29e', '#332e29'], ['#f59e0b', '#fbbf24', '#38bdf8', '#84cc16', '#facc15', '#f87171']),
	surface('ametista', 'Ametista', ['#171325', '#110e1c', '#2e2544', '#ebe4fb', '#a99cc9', '#2e2544'], ['#a78bfa', '#c4b5fd', '#67e8f9', '#6ee7b7', '#fcd34d', '#fb7185']),
	surface('areia', 'Areia', ['#1f1d19', '#171512', '#37332b', '#f0ebe0', '#b3ab98', '#37332b'], ['#d8b26e', '#ecd08f', '#8fc9c0', '#a7c957', '#e9c46a', '#d9776a']),
	surface('carvao', 'Carvão', ['#1a1a1a', '#121212', '#2b2b2b', '#eaeaea', '#9a9a9a', '#2b2b2b'], ['#d4d4d8', '#fafafa', '#a1a1aa', '#a3e635', '#fcd34d', '#fca5a5']),
	surface('cobre', 'Cobre', ['#1e1613', '#16100e', '#3a2a23', '#f4e9e2', '#b99b8c', '#3a2a23'], ['#e07a5f', '#f4a261', '#7dd3fc', '#a3e635', '#fbbf24', '#ef4444']),
	surface('ferrugem', 'Ferrugem', ['#1c1512', '#150f0d', '#35271f', '#f2e6df', '#b5978a', '#35271f'], ['#dc2626', '#f87171', '#fb923c', '#65a30d', '#f59e0b', '#ff4d4d']),
	surface('floresta', 'Floresta', ['#14201a', '#0e1813', '#26382e', '#e6f0e9', '#9db8a8', '#26382e'], ['#84cc16', '#a3e635', '#5eead4', '#84cc16', '#eab308', '#f97316']),
	surface('fosforo', 'Fósforo', ['#0a1008', '#060b05', '#173015', '#c8f7c0', '#7fbf76', '#173015'], ['#39ff14', '#7cff5e', '#3ef0c0', '#39ff14', '#e3ff3e', '#ff5f56']),
	surface('gelo', 'Gelo', ['#101820', '#0b1118', '#1f2d3a', '#e8f4fb', '#9bb4c6', '#1f2d3a'], ['#7dd3fc', '#bae6fd', '#a5f3fc', '#5eead4', '#fde68a', '#fda4af']),
	surface('indigo', 'Índigo', ['#1a1b26', '#12131c', '#2c2e41', '#e6e7f0', '#9aa0c0', '#2c2e41'], ['#818cf8', '#a5b4fc', '#22d3ee', '#34d399', '#fbbf24', '#fb7185']),
	surface('manga', 'Manga', ['#1d1710', '#15100b', '#38291a', '#f7ecd9', '#c0a482', '#38291a'], ['#fb923c', '#fdba74', '#facc15', '#a3e635', '#fde047', '#f87171']),
	surface('meia-noite', 'Meia-noite', ['#0b1020', '#070b17', '#1a2440', '#dfe7ff', '#8b9bc4', '#1a2440'], ['#7aa2f7', '#a9c1ff', '#7dcfff', '#9ece6a', '#e0af68', '#f7768e']),
	surface('neon', 'Neon', ['#12101c', '#0c0a14', '#292339', '#ece6ff', '#a79ec4', '#292339'], ['#c084fc', '#e879f9', '#22d3ee', '#4ade80', '#fde047', '#fb7185']),
	surface('oceano', 'Oceano', ['#0f1b24', '#0a141b', '#1e3441', '#e2eff5', '#8fadbd', '#1e3441'], ['#2dd4bf', '#5eead4', '#38bdf8', '#2dd4bf', '#fbbf24', '#fb7185']),
	surface('vinho', 'Vinho', ['#1d1418', '#150e12', '#3a2830', '#f2e8ec', '#b79aa5', '#3a2830'], ['#f472b6', '#f9a8d4', '#c084fc', '#4ade80', '#fbbf24', '#ef4444']),
];

const HEX = /^#[0-9a-f]{6}$/i;
const KEYS = ['bg', 'panel', 'element', 'border', 'text', 'muted', 'primary', 'secondary', 'accent', 'ok', 'warn', 'bad'] as const;

/** `~/.seraph/themes/<id>.json` with any of the colour keys; the rest comes from the default. */
export function customThemes(home = seraphHome()): Theme[] {
	const folder = join(home, 'themes');
	let files: string[];
	try {
		files = readdirSync(folder).filter(name => name.endsWith('.json'));
	} catch {
		return [];
	}
	const found: Theme[] = [];
	for (const file of files) {
		try {
			const raw = JSON.parse(readFileSync(join(folder, file), 'utf8')) as Record<string, unknown>;
			const colors: Colors = {...OPENCODE};
			for (const key of KEYS) {
				const value = raw[key];
				if (typeof value === 'string' && HEX.test(value)) colors[key] = value;
			}
			const id = file.slice(0, -5).toLowerCase();
			found.push(theme(id, typeof raw['label'] === 'string' ? raw['label'] : id, colors));
		} catch {
			// A broken file must not keep the app from starting.
		}
	}
	return found;
}

export function allThemes(): Theme[] {
	const custom = customThemes();
	return [...THEMES.filter(item => !custom.some(mine => mine.id === item.id)), ...custom];
}

export function themeById(id: string): Theme {
	return allThemes().find(item => item.id === id) ?? (THEMES[0] as Theme);
}
