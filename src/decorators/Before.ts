import { Hook } from './Hook';

export const Before = (targetMethod: string) => Hook({ before: targetMethod });
