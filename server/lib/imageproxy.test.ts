import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { resolveAllowedImageUrl } from './imageproxy';

describe('resolveAllowedImageUrl', () => {
  const allowedOrigins = new Set(['https://image.example']);

  it('resolves relative image paths on the configured origin', () => {
    assert.strictEqual(
      resolveAllowedImageUrl({
        imagePath: '/poster/example.jpg',
        baseUrl: 'https://image.example',
        allowedOrigins,
      }),
      'https://image.example/poster/example.jpg'
    );
  });

  it('rejects absolute and scheme-relative origin overrides', () => {
    for (const imagePath of [
      'https://attacker.example/image.jpg',
      '//attacker.example/image.jpg',
      '\\\\attacker.example/image.jpg',
    ]) {
      assert.throws(() =>
        resolveAllowedImageUrl({
          imagePath,
          baseUrl: 'https://image.example',
          allowedOrigins,
        })
      );
    }
  });

  it('accepts explicitly allowlisted absolute avatar origins', () => {
    assert.strictEqual(
      resolveAllowedImageUrl({
        imagePath: 'https://image.example/avatar.png',
        allowedOrigins,
      }),
      'https://image.example/avatar.png'
    );
  });

  it('rejects URLs containing embedded credentials', () => {
    assert.throws(() =>
      resolveAllowedImageUrl({
        imagePath: 'https://user:password@image.example/avatar.png',
        allowedOrigins,
      })
    );
  });
});
