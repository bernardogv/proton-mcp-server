import { describe, it, expect } from 'vitest';
import { isLoopbackHost } from '../../src/utils/config.js';

describe('isLoopbackHost', () => {
  it('accepts loopback hosts', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('127.1.2.3')).toBe(true);
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
  });

  it('rejects non-loopback hosts', () => {
    expect(isLoopbackHost('192.168.1.10')).toBe(false);
    expect(isLoopbackHost('mail.example.com')).toBe(false);
    expect(isLoopbackHost('127.evil.com')).toBe(false);
  });
});
