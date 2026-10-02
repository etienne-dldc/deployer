export type Unmount = () => void | Promise<void>;

export type TMountableFn<T, Args extends unknown[]> = (
  ...args: Args
) => Promise<TMountResult<T>> | TMountResult<T>;

export interface TMountable<T, Args extends unknown[]> {
  mount(...args: Args): Promise<Unmount>;
  get(): T;
  mountInternal: (...args: Args) => Promise<TMountResult<T>>;
}

export interface TMountResult<T> {
  unmount?: Unmount;
  value: T;
}

export function mountable<T, Args extends unknown[]>(
  mount: (...args: Args) => Promise<TMountResult<T>> | TMountResult<T>,
): TMountable<T, Args> {
  let mounted: null | { unmount?: Unmount; value: T } = null;

  function mountInternal(...args: Args): Promise<TMountResult<T>> {
    return Promise.resolve(mount(...args));
  }

  return {
    async mount(...args) {
      if (mounted !== null) {
        throw new Error("Already mounted");
      }
      mounted = await mountInternal(...args);
      return async () => {
        if (mounted === null) {
          throw new Error("Not mounted");
        }
        try {
          if (mounted.unmount) {
            await mounted.unmount();
          }
        } finally {
          mounted = null;
        }
      };
    },
    get() {
      if (mounted === null) {
        throw new Error("Not mounted");
      }
      return mounted.value;
    },
    mountInternal,
  };
}
