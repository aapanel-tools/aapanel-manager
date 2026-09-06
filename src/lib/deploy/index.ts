import 'server-only';
import type {DeploymentMode} from '@/lib/version/types';
import type {DeployAdapter} from './adapter';
import {AaPanelDeployAdapter} from './aapanel';

export type {
  DeployAdapter,
  PreflightResult,
  StageInput,
  StageResult,
  StageStep,
  ActivateInput,
  ActivateResult,
} from './adapter';

/**
 * Returns the staging adapter for a deployment mode, or null when staging isn't
 * implemented for that mode yet (docker/systemd land in later phases; manual has
 * no self-update). `releaseRoot` comes from APP_RELEASE_ROOT.
 */
export function getDeployAdapter(mode: DeploymentMode, releaseRoot: string | undefined): DeployAdapter | null {
  switch (mode) {
    case 'aapanel':
      return new AaPanelDeployAdapter(releaseRoot);
    default:
      return null;
  }
}
