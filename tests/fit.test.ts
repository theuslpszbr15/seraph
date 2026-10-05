import assert from 'node:assert/strict';
import {test} from 'node:test';
import {formatElapsed, logoSizeFor, tailFit, visualRows} from '../src/ui/fit.ts';

test('visualRows: linhas longas quebram e linhas vazias contam', () => {
	assert.equal(visualRows('abc', 10), 1);
	assert.equal(visualRows('a'.repeat(25), 10), 3);
	assert.equal(visualRows('a\n\nb', 10), 3);
});

test('tailFit: mantém o fim do texto dentro do limite e conta o que ficou escondido', () => {
	const text = Array.from({length: 50}, (_, index) => `linha ${index}`).join('\n');
	const fit = tailFit(text, 80, 10);
	assert.equal(fit.text.split('\n').length, 10);
	assert.ok(fit.text.endsWith('linha 49'));
	assert.equal(fit.hidden, 40);
	assert.deepEqual(tailFit('curto', 80, 10), {text: 'curto', hidden: 0});
});

test('tailFit: uma linha enorme não estoura o limite de linhas visuais', () => {
	const fit = tailFit(`${'x'.repeat(500)}\nfim`, 20, 5);
	assert.ok(visualRows(fit.text, 20) <= 5);
	assert.ok(fit.text.endsWith('fim'));
});

test('logo: o tamanho acompanha a altura da janela', () => {
	assert.equal(logoSizeFor(50), 'full');
	assert.equal(logoSizeFor(30), 'name');
	assert.equal(logoSizeFor(20), 'mini');
});

test('tempo: segundos e minutos', () => {
	assert.equal(formatElapsed(7), '7s');
	assert.equal(formatElapsed(75), '1min 15s');
});
