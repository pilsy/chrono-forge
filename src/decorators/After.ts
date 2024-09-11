import { Hook } from './Hook';

export const After = (targetMethod: string) => Hook({ after: targetMethod });
