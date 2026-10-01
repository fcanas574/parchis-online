const values = new Map<string, string>();

export const browserStorageMock = {
  get length() {
    return values.size;
  },
  clear() {
    values.clear();
  },
  getItem(key: string) {
    return values.get(key) ?? null;
  },
  key(index: number) {
    return [...values.keys()][index] ?? null;
  },
  removeItem(key: string) {
    values.delete(key);
  },
  setItem(key: string, value: string) {
    values.set(key, String(value));
  },
};

export function installBrowserStorageMock(): void {
  browserStorageMock.clear();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: browserStorageMock,
  });
}
