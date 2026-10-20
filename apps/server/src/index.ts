import { SHARED_SMOKE, SmokeSchema } from '@omnis/shared';

const result = SmokeSchema.parse({ message: SHARED_SMOKE });
console.log(result);
