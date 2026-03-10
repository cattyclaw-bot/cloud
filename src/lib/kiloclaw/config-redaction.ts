/**
 * Redaction utilities for openclaw.json config.
 *
 * The raw config editor sends the full openclaw.json to the browser for
 * editing.  Some fields contain plaintext secrets (gateway auth tokens,
 * channel bot/app tokens) that must never leave the server.  This module
 * replaces those values with a placeholder on read and restores the real
 * values on write.
 */

/**
 * Paths to secret values inside openclaw.json that must never reach the browser.
 * Each entry is an array of keys describing the path to the sensitive field.
 */
export const OPENCLAW_CONFIG_SECRET_PATHS: ReadonlyArray<readonly string[]> = [
  ['gateway', 'auth', 'token'],
  ['channels', 'telegram', 'botToken'],
  ['channels', 'discord', 'token'],
  ['channels', 'slack', 'botToken'],
  ['channels', 'slack', 'appToken'],
];

export const REDACTED_PLACEHOLDER = '__REDACTED__';

/**
 * Read a nested value from an object by key path.
 * Returns undefined if any intermediate key is missing or not an object.
 */
function getNestedValue(obj: Record<string, unknown>, keyPath: readonly string[]): unknown {
  let current: unknown = obj;
  for (const key of keyPath) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/**
 * Set a nested value in an object by key path.
 * Creates intermediate objects as needed.
 */
function setNestedValue(
  obj: Record<string, unknown>,
  keyPath: readonly string[],
  value: unknown
): void {
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < keyPath.length - 1; i++) {
    const key = keyPath[i];
    if (typeof current[key] !== 'object' || current[key] === null || Array.isArray(current[key])) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[keyPath[keyPath.length - 1]] = value;
}

/**
 * Delete a nested key from an object by key path.
 */
function deleteNestedValue(obj: Record<string, unknown>, keyPath: readonly string[]): void {
  let current: unknown = obj;
  for (let i = 0; i < keyPath.length - 1; i++) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) {
      return;
    }
    current = (current as Record<string, unknown>)[keyPath[i]];
  }
  if (typeof current === 'object' && current !== null && !Array.isArray(current)) {
    delete (current as Record<string, unknown>)[keyPath[keyPath.length - 1]];
  }
}

/**
 * Strip secret fields from an openclaw config before sending to the browser.
 * Replaces each secret value with a placeholder so the UI can show that a
 * secret is configured without revealing its value.
 */
export function redactOpenclawConfig(config: Record<string, unknown>): Record<string, unknown> {
  // Deep clone to avoid mutating the original
  const redacted = JSON.parse(JSON.stringify(config)) as Record<string, unknown>;

  for (const secretPath of OPENCLAW_CONFIG_SECRET_PATHS) {
    const value = getNestedValue(redacted, secretPath);
    if (value !== undefined && value !== null && typeof value === 'string' && value.length > 0) {
      setNestedValue(redacted, secretPath, REDACTED_PLACEHOLDER);
    }
  }

  return redacted;
}

/**
 * Restore redacted secret fields in a user-submitted config by merging
 * back the real values from the current on-disk config.
 *
 * If the user left the placeholder value, the original secret is restored.
 * If the user deleted the field entirely, it stays deleted.
 * If the user set a new (non-placeholder) value, the new value is kept.
 */
export function restoreRedactedSecrets(
  userConfig: Record<string, unknown>,
  currentConfig: Record<string, unknown>
): Record<string, unknown> {
  const merged = JSON.parse(JSON.stringify(userConfig)) as Record<string, unknown>;

  for (const secretPath of OPENCLAW_CONFIG_SECRET_PATHS) {
    const userValue = getNestedValue(merged, secretPath);
    if (userValue === REDACTED_PLACEHOLDER) {
      // User didn't change it — restore the real value from current config
      const realValue = getNestedValue(currentConfig, secretPath);
      if (realValue !== undefined && realValue !== null) {
        setNestedValue(merged, secretPath, realValue);
      } else {
        // Original secret no longer exists; remove the placeholder
        deleteNestedValue(merged, secretPath);
      }
    }
  }

  return merged;
}
