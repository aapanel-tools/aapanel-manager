import {describe, it, expect} from 'vitest';
import {buildUpgradeCommand} from './upgrade-command';

describe('buildUpgradeCommand', () => {
  it('docker uses compose pull + up', () => {
    expect(buildUpgradeCommand('docker')).toBe('docker compose pull && docker compose up -d');
  });

  it('manual shows a generic build/migrate sequence (no orchestrator, no docker)', () => {
    const cmd = buildUpgradeCommand('manual');
    expect(cmd).toContain('npm run build');
    expect(cmd).toContain('npm run db:deploy');
    expect(cmd).not.toContain('docker');
  });

  it('systemd includes the service name and a restart', () => {
    const cmd = buildUpgradeCommand('systemd', {serviceName: 'aapanel'});
    expect(cmd).toContain('systemctl restart aapanel');
    expect(cmd).toContain('npm run db:deploy');
  });

  it('systemd uses a placeholder when no service name is set', () => {
    expect(buildUpgradeCommand('systemd')).toContain('<service>');
  });

  it('aapanel builds then expects a panel restart', () => {
    expect(buildUpgradeCommand('aapanel')).toContain('npm run build');
  });
});
