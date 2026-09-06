import {describe, it, expect} from 'vitest';
import {updateSettingsSchema} from './update-settings';

describe('updateSettingsSchema', () => {
  it('parses a full valid input incl. self-restart', () => {
    const parsed = updateSettingsSchema.parse({
      deploymentMode: 'aapanel',
      githubOwner: 'acme',
      githubRepo: 'panel',
      githubToken: 'ghp_xxx',
      selfBaseUrl: 'https://127.0.0.1:8888',
      selfApiKey: 'sk_xxx',
      selfTlsMode: 'on',
      selfProject: 'aapanel-manager',
      serviceName: 'app',
    });
    expect(parsed.deploymentMode).toBe('aapanel');
    expect(parsed.githubOwner).toBe('acme');
    expect(parsed.githubToken).toBe('ghp_xxx');
    expect(parsed.serviceName).toBe('app');
    expect(parsed.selfBaseUrl).toBe('https://127.0.0.1:8888');
    expect(parsed.selfApiKey).toBe('sk_xxx');
    expect(parsed.selfTlsMode).toBe('PINNED');
    expect(parsed.selfProject).toBe('aapanel-manager');
  });

  it('treats a blank token / self-key as undefined (keep existing)', () => {
    const parsed = updateSettingsSchema.parse({deploymentMode: 'manual', githubToken: '   ', selfApiKey: '  '});
    expect(parsed.githubToken).toBeUndefined();
    expect(parsed.selfApiKey).toBeUndefined();
  });

  it('treats a missing self-restart checkbox as false, and blank URL/project as null', () => {
    const parsed = updateSettingsSchema.parse({deploymentMode: 'aapanel'});
    expect(parsed.selfTlsMode).toBe('VERIFY');
    expect(parsed.selfBaseUrl).toBeNull();
    expect(parsed.selfProject).toBeNull();
  });

  it('rejects a non-http self-restart URL', () => {
    expect(updateSettingsSchema.safeParse({deploymentMode: 'aapanel', selfBaseUrl: 'ftp://x'}).success).toBe(false);
  });

  it('defaults missing owner/repo to empty strings', () => {
    const parsed = updateSettingsSchema.parse({deploymentMode: 'manual'});
    expect(parsed.githubOwner).toBe('');
    expect(parsed.githubRepo).toBe('');
  });

  it('rejects an unknown deployment mode', () => {
    expect(updateSettingsSchema.safeParse({deploymentMode: 'kubernetes'}).success).toBe(false);
  });

  it('rejects an owner with illegal characters', () => {
    expect(updateSettingsSchema.safeParse({deploymentMode: 'docker', githubOwner: 'a/b'}).success).toBe(false);
  });
});
