import { describe, it, expect, vi, beforeEach } from 'vitest';
import { loadConfig } from '../src/utils/config.js';

describe('loadConfig', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('loads valid config from environment variables', () => {
    vi.stubEnv('PROTON_BRIDGE_IMAP_HOST', '127.0.0.1');
    vi.stubEnv('PROTON_BRIDGE_IMAP_PORT', '1143');
    vi.stubEnv('PROTON_BRIDGE_SMTP_HOST', '127.0.0.1');
    vi.stubEnv('PROTON_BRIDGE_SMTP_PORT', '1025');
    vi.stubEnv('PROTON_BRIDGE_USERNAME', 'test@proton.me');
    vi.stubEnv('PROTON_BRIDGE_PASSWORD', 'test-password');

    const config = loadConfig();
    expect(config.imap.host).toBe('127.0.0.1');
    expect(config.imap.port).toBe(1143);
    expect(config.smtp.host).toBe('127.0.0.1');
    expect(config.smtp.port).toBe(1025);
    expect(config.username).toBe('test@proton.me');
    expect(config.password).toBe('test-password');
  });

  it('throws on missing required variables', () => {
    vi.stubEnv('PROTON_BRIDGE_IMAP_HOST', '127.0.0.1');
    expect(() => loadConfig()).toThrow();
  });

  it('uses default host/port values when not set', () => {
    vi.stubEnv('PROTON_BRIDGE_USERNAME', 'test@proton.me');
    vi.stubEnv('PROTON_BRIDGE_PASSWORD', 'test-password');

    const config = loadConfig();
    expect(config.imap.host).toBe('127.0.0.1');
    expect(config.imap.port).toBe(1143);
    expect(config.smtp.host).toBe('127.0.0.1');
    expect(config.smtp.port).toBe(1025);
  });
});
