import { readHarborFourArmTrialObservations } from './harbor-four-arm-trial-evidence.js';
import type { HarborFourArmTrialObservation } from '../domain/harbor-four-arm-evidence.js';

/** The two arms used by the real feedback-loop experiment. */
export type HarborFeedbackArm = 'native' | 'ace_optional';

export interface HarborFeedbackTrialObservation extends Omit<HarborFourArmTrialObservation,
'arm' | 'observedAceCalls' | 'successfulAceCalls'> {
  readonly arm: HarborFeedbackArm;
  /** Total user-facing ACE calls: ace_context + ace_expand. */
  readonly observedAceCalls: number;
  /** ace_context calls only; these are the calls that can carry provider request IDs. */
  readonly observedAceContextCalls: number;
  readonly successfulAceCalls: number;
}

/**
 * Read ordinary Harbor result.json trial directories without exposing the
 * historical four-arm names to the feedback-loop collector.
 */
export const readHarborFeedbackTrialObservations = async (
  arm: HarborFeedbackArm,
  aggregatePath: string,
): Promise<readonly HarborFeedbackTrialObservation[]> => {
  const observations = await readHarborFourArmTrialObservations(arm === 'native' ? 'native' : 'dense', aggregatePath);
  return observations.map((observation) => ({
    ...observation,
    arm,
    observedAceContextCalls: observation.observedAceCalls,
    observedAceCalls: observation.observedAceToolCalls ?? observation.observedAceCalls,
    successfulAceCalls: observation.successfulAceToolCalls ?? observation.successfulAceCalls,
  }));
};
