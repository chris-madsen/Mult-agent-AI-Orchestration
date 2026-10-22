import { readHarborFourArmTrialObservations } from './harbor-four-arm-trial-evidence.js';
import type { HarborFourArmTrialObservation } from '../domain/harbor-four-arm-evidence.js';

/** The two arms used by the real feedback-loop experiment. */
export type HarborFeedbackArm = 'native' | 'ace_optional';

/**
 * Read ordinary Harbor result.json trial directories without exposing the
 * historical four-arm names to the feedback-loop collector.
 */
export const readHarborFeedbackTrialObservations = async (
  arm: HarborFeedbackArm,
  aggregatePath: string,
): Promise<readonly HarborFourArmTrialObservation[]> =>
  readHarborFourArmTrialObservations(arm === 'native' ? 'native' : 'dense', aggregatePath);
