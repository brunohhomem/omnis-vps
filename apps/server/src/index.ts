import { HealthOutputSchema } from '@omnis/shared';

const health = HealthOutputSchema.parse({
  status: 'ok',
  version: '0.0.0',
  uptimeSec: 0,
  rssBytes: 0,
});

console.log(health);
