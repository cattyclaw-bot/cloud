import {
  redactOpenclawConfig,
  restoreRedactedSecrets,
  REDACTED_PLACEHOLDER,
} from './config-redaction';

const FULL_CONFIG = {
  gateway: {
    port: 3001,
    mode: 'local',
    bind: 'loopback',
    auth: { token: 'super-secret-gateway-token' },
    controlUi: { allowedOrigins: ['https://app.kilo.ai'] },
  },
  channels: {
    telegram: { botToken: 'tg-bot-secret', enabled: true, dmPolicy: 'pairing' },
    discord: { token: 'discord-bot-secret', enabled: true },
    slack: { botToken: 'slack-bot-secret', appToken: 'slack-app-secret', enabled: true },
  },
  agents: { defaults: { model: { primary: 'kilocode/anthropic/claude-opus-4.6' } } },
  tools: { profile: 'full', exec: { host: 'gateway' } },
};

describe('redactOpenclawConfig', () => {
  it('replaces all secret fields with the redacted placeholder', () => {
    const redacted = redactOpenclawConfig(FULL_CONFIG);

    expect(redacted.gateway).toMatchObject({
      port: 3001,
      mode: 'local',
      auth: { token: REDACTED_PLACEHOLDER },
    });
    expect(redacted.channels).toMatchObject({
      telegram: { botToken: REDACTED_PLACEHOLDER, enabled: true },
      discord: { token: REDACTED_PLACEHOLDER, enabled: true },
      slack: {
        botToken: REDACTED_PLACEHOLDER,
        appToken: REDACTED_PLACEHOLDER,
        enabled: true,
      },
    });
  });

  it('preserves non-secret fields unchanged', () => {
    const redacted = redactOpenclawConfig(FULL_CONFIG);

    expect(redacted.agents).toEqual(FULL_CONFIG.agents);
    expect(redacted.tools).toEqual(FULL_CONFIG.tools);
    expect((redacted.gateway as Record<string, unknown>).port).toBe(3001);
    expect((redacted.gateway as Record<string, unknown>).controlUi).toEqual({
      allowedOrigins: ['https://app.kilo.ai'],
    });
  });

  it('does not mutate the original config', () => {
    const original = JSON.parse(JSON.stringify(FULL_CONFIG));
    redactOpenclawConfig(FULL_CONFIG);
    expect(FULL_CONFIG).toEqual(original);
  });

  it('handles config with no secrets present', () => {
    const minimal = { agents: { defaults: {} }, tools: { profile: 'full' } };
    const redacted = redactOpenclawConfig(minimal);
    expect(redacted).toEqual(minimal);
  });

  it('handles config with only some secrets present', () => {
    const partial = {
      gateway: { port: 3001, auth: { token: 'secret' } },
      channels: {},
    };
    const redacted = redactOpenclawConfig(partial);
    expect((redacted.gateway as Record<string, unknown>).auth).toEqual({
      token: REDACTED_PLACEHOLDER,
    });
    expect(redacted.channels).toEqual({});
  });

  it('does not redact empty string secrets', () => {
    const config = {
      gateway: { auth: { token: '' } },
    };
    const redacted = redactOpenclawConfig(config);
    expect((redacted.gateway as Record<string, unknown>).auth).toEqual({ token: '' });
  });
});

describe('restoreRedactedSecrets', () => {
  it('restores placeholder values from the current config', () => {
    const userConfig = redactOpenclawConfig(FULL_CONFIG);
    const merged = restoreRedactedSecrets(userConfig, FULL_CONFIG);

    expect(merged).toEqual(FULL_CONFIG);
  });

  it('keeps new values when the user changed a secret', () => {
    const userConfig = redactOpenclawConfig(FULL_CONFIG);
    ((userConfig.gateway as Record<string, unknown>).auth as Record<string, unknown>).token =
      'new-token';

    const merged = restoreRedactedSecrets(userConfig, FULL_CONFIG);
    expect(
      ((merged.gateway as Record<string, unknown>).auth as Record<string, unknown>).token
    ).toBe('new-token');
  });

  it('keeps field deleted when user removed a secret field', () => {
    const userConfig = redactOpenclawConfig(FULL_CONFIG);
    delete (userConfig.channels as Record<string, unknown>).telegram;

    const merged = restoreRedactedSecrets(userConfig, FULL_CONFIG);
    expect((merged.channels as Record<string, unknown>).telegram).toBeUndefined();
  });

  it('removes placeholder when original secret no longer exists', () => {
    const userConfig = {
      gateway: { auth: { token: REDACTED_PLACEHOLDER } },
    };
    const currentConfig = { gateway: { port: 3001 } };

    const merged = restoreRedactedSecrets(userConfig, currentConfig);
    expect(
      ((merged.gateway as Record<string, unknown>).auth as Record<string, unknown>).token
    ).toBeUndefined();
  });

  it('does not mutate the user config', () => {
    const userConfig = redactOpenclawConfig(FULL_CONFIG);
    const original = JSON.parse(JSON.stringify(userConfig));
    restoreRedactedSecrets(userConfig, FULL_CONFIG);
    expect(userConfig).toEqual(original);
  });

  it('handles empty configs gracefully', () => {
    const merged = restoreRedactedSecrets({}, {});
    expect(merged).toEqual({});
  });

  it('deletes placeholder when parent path is completely missing from current config', () => {
    const userConfig = {
      gateway: { auth: { token: REDACTED_PLACEHOLDER } },
    };
    const currentConfig = {};

    const merged = restoreRedactedSecrets(userConfig, currentConfig);
    // The placeholder should be deleted since there's no original secret to restore
    expect(
      ((merged.gateway as Record<string, unknown>).auth as Record<string, unknown>).token
    ).toBeUndefined();
  });

  it('handles mixed: some placeholders, some new values, some removed', () => {
    const userConfig = {
      gateway: { port: 3001, auth: { token: REDACTED_PLACEHOLDER } },
      channels: {
        telegram: { botToken: 'brand-new-telegram-token', enabled: true },
        slack: { botToken: REDACTED_PLACEHOLDER, appToken: REDACTED_PLACEHOLDER, enabled: true },
      },
    };

    const merged = restoreRedactedSecrets(userConfig, FULL_CONFIG);

    // Gateway token: restored from original
    expect(
      ((merged.gateway as Record<string, unknown>).auth as Record<string, unknown>).token
    ).toBe('super-secret-gateway-token');

    // Telegram: user set new value, kept as-is
    expect((merged.channels as Record<string, unknown>).telegram).toMatchObject({
      botToken: 'brand-new-telegram-token',
    });

    // Discord: user removed it, stays removed
    expect((merged.channels as Record<string, unknown>).discord).toBeUndefined();

    // Slack: both restored from original
    expect((merged.channels as Record<string, unknown>).slack).toMatchObject({
      botToken: 'slack-bot-secret',
      appToken: 'slack-app-secret',
    });
  });
});
