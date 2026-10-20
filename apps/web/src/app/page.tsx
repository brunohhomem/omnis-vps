import { ScopeSchema } from '@omnis/shared';

export default function Page() {
  return <main>{ScopeSchema.options.join(', ')}</main>;
}
