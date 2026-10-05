export type Theme = {
	id: string;
	label: string;
	/** Accent: the angel, the active bar, highlights. */
	accent: string;
	/** Second tone, for the wordmark gradient and the Plan mode. */
	soft: string;
	text: string;
	dim: string;
	ok: string;
	warn: string;
	bad: string;
};

export const THEMES: Theme[] = [
	{id: 'celestial', label: 'Celestial', accent: '#F5D76E', soft: '#9AD1FF', text: '#EDEFF5', dim: '#7C8498', ok: '#7EE2A8', warn: '#F5B14C', bad: '#FF7A8A'},
	{id: 'aurora', label: 'Aurora', accent: '#7EE2D2', soft: '#B79CFF', text: '#E8F3F1', dim: '#6F8A87', ok: '#8BE28B', warn: '#F0C05A', bad: '#FF8A80'},
	{id: 'brasa', label: 'Brasa', accent: '#FF8A4C', soft: '#FFD08A', text: '#F4E9E1', dim: '#8C7468', ok: '#9CD67A', warn: '#FFC85A', bad: '#FF6B6B'},
	{id: 'monolito', label: 'Monólito', accent: '#FFFFFF', soft: '#B8B8B8', text: '#E6E6E6', dim: '#777777', ok: '#BDBDBD', warn: '#D6D6D6', bad: '#F0F0F0'},
];

export function themeById(id: string): Theme {
	return THEMES.find(theme => theme.id === id) ?? (THEMES[0] as Theme);
}
