import test from 'node:test';
import assert from 'node:assert/strict';
import { privateChartImageContentType, privateChartImagePath, validatePrivateChartImagePath } from '../src/lib/supabase/private-chart-image';

const userId = '550e8400-e29b-41d4-a716-446655440000';
const conversationId = '550e8400-e29b-41d4-a716-446655440001';
const imageId = '550e8400-e29b-41d4-a716-446655440002';

test('private chart image paths are user and conversation scoped with constrained extensions', () => {
  const path = privateChartImagePath(userId, conversationId, 'image/jpeg', imageId);
  assert.equal(path, `${userId}/${conversationId}/${imageId}.jpg`);
  assert.equal(validatePrivateChartImagePath(path, userId, conversationId), path);
  assert.equal(validatePrivateChartImagePath(path, '550e8400-e29b-41d4-a716-446655440099', conversationId), null);
  assert.equal(validatePrivateChartImagePath(path, userId, '550e8400-e29b-41d4-a716-446655440099'), null);
  assert.equal(validatePrivateChartImagePath(`${userId}/../${imageId}.png`, userId), null);
  assert.equal(validatePrivateChartImagePath(`${userId}/${conversationId}/${imageId}.svg`, userId), null);
});

test('private chart image response content types are allowlisted', () => {
  assert.equal(privateChartImageContentType('a/b/c.png'), 'image/png');
  assert.equal(privateChartImageContentType('a/b/c.jpg'), 'image/jpeg');
  assert.equal(privateChartImageContentType('a/b/c.webp'), 'image/webp');
  assert.equal(privateChartImageContentType('a/b/c.svg'), null);
});
