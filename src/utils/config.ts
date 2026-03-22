import { z } from 'zod';
import type { BridgeConfig } from './types.js';

const configSchema = z.object({
  PROTON_BRIDGE_IMAP_HOST: z.string().default('127.0.0.1'),
  PROTON_BRIDGE_IMAP_PORT: z.coerce.number().default(1143),
  PROTON_BRIDGE_SMTP_HOST: z.string().default('127.0.0.1'),
  PROTON_BRIDGE_SMTP_PORT: z.coerce.number().default(1025),
  PROTON_BRIDGE_USERNAME: z.string().min(1, 'PROTON_BRIDGE_USERNAME is required'),
  PROTON_BRIDGE_PASSWORD: z.string().min(1, 'PROTON_BRIDGE_PASSWORD is required'),
});

export function loadConfig(): BridgeConfig {
  const parsed = configSchema.parse(process.env);
  return {
    imap: {
      host: parsed.PROTON_BRIDGE_IMAP_HOST,
      port: parsed.PROTON_BRIDGE_IMAP_PORT,
    },
    smtp: {
      host: parsed.PROTON_BRIDGE_SMTP_HOST,
      port: parsed.PROTON_BRIDGE_SMTP_PORT,
    },
    username: parsed.PROTON_BRIDGE_USERNAME,
    password: parsed.PROTON_BRIDGE_PASSWORD,
  };
}
