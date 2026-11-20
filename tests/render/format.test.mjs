import test from 'node:test';
import assert from 'node:assert/strict';
import { tokens, duration, modelName, family, clip, wrap, resetsIn, ageText } from '../../lib/format.mjs';

test('token counts are shortened to k and M, rounding up into the next unit', () => {
  assert.equal(tokens(0), '0');
  assert.equal(tokens(950), '950');
  assert.equal(tokens(1200), '1.2k');
  assert.equal(tokens(18000), '18k');
  assert.equal(tokens(184000), '184k');
  assert.equal(tokens(999600), '1M');
  assert.equal(tokens(1200000), '1.2M');
  assert.equal(tokens(1000000), '1M');
  assert.equal(tokens(6200000), '6.2M');
  assert.equal(tokens(NaN), '—');
});

test('a time span reads in its two largest units, and never below zero', () => {
  const m = 6e4, h = 60 * m;
  assert.equal(duration(-5), '0s');
  assert.equal(duration(40e3), '40s');
  assert.equal(duration(12 * m), '12m');
  assert.equal(duration(2 * h + 14 * m), '2h 14m');
  assert.equal(duration(3 * h + 2 * m), '3h 02m');
  assert.equal(duration(30 * h), '1d 6h');
  assert.equal(duration(51 * h), '2d 3h');
});

test('a model id of any known shape reads as family and version', () => {
  assert.equal(modelName('claude-sonnet-5-5'), 'Sonnet 5.5');
  assert.equal(modelName('claude-opus-4-1-20250805'), 'Opus 4.1');
  assert.equal(modelName('claude-3-5-haiku-20241022'), 'Haiku 3.5');
  assert.equal(modelName('claude-sonnet-5-5[1m]'), 'Sonnet 5.5');
  assert.equal(modelName('Fable 5.2'), 'Fable 5.2');
  assert.equal(modelName('opus'), 'Opus');
  assert.equal(modelName(undefined), '');
});

test('the model family is found in an id or a name, and is null for anything else', () => {
  assert.equal(family('Sonnet 5.5'), 'Sonnet');
  assert.equal(family('claude-haiku-5-5'), 'Haiku');
  assert.equal(family('fable'), 'Fable');
  assert.equal(family('gpt'), null);
  assert.equal(family(null), null);
});

test('text is cut with an ellipsis, wrapped at words, and a reset time read in its largest unit', () => {
  assert.equal(clip('abcdef', 4), 'abc…');
  assert.equal(clip('abc', 4), 'abc');
  assert.deepEqual(wrap('one two three four', 9), ['one two', 'three', 'four']);
  assert.equal(resetsIn(90.7), '3d');
  assert.equal(resetsIn(15.1), '15h');
  assert.equal(resetsIn(0.5), '30m');
});

test('an age reads in minutes under an hour, hours under 48 of them, else days, each rounded down', () => {
  const m = 6e4, h = 60 * m;
  assert.equal(ageText(0), '1 min');
  assert.equal(ageText(3 * m), '3 min');
  assert.equal(ageText(59 * m + 59e3), '59 min');
  assert.equal(ageText(60 * m), '1h');
  assert.equal(ageText(2 * h + 10 * m), '2h');
  assert.equal(ageText(47 * h + 59 * m), '47h');
  assert.equal(ageText(50 * h), '2d');
});
