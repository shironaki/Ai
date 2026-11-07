/** Schema constructors are declarative: the stub only has to accept them. */
const field = () => ({ primaryKey: () => field(), notNull: () => field(), default: () => field() });
export const text = field;
export const integer = field;
export const index = () => ({ on: () => ({}) });
export const primaryKey = () => ({});
export const table = (name, columns, extra = () => ({})) => ({ name, columns, ...extra() });
